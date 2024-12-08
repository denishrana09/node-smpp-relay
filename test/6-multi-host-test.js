const assert = require('assert');
const { Vendor, VendorHost } = require('../models/vendor');
const Client = require('../models/client');
const Message = require('../models/message');
const smppServer = require('../services/smpp-server');
const smppClient = require('../services/smpp-client');
const vendorCache = require('../services/vendor-availability-cache');
const { v4: uuidv4 } = require('uuid');

describe('Multi-Host SMPP Tests', () => {
  let vendor1, vendor2, host1, host2, host3, client;

  before(async () => {
    // Create test vendors
    vendor1 = await Vendor.create({
      id: 'test-vendor1',
      systemId: 'vendor1',
      password: 'password1',
      messagePrice: 1.0
    });

    vendor2 = await Vendor.create({
      id: 'test-vendor2',
      systemId: 'vendor2',
      password: 'password2',
      messagePrice: 1.5
    });

    // Create multiple hosts for vendors
    host1 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor1.id,
      host: 'localhost',
      port: 2775,
      priority: 1,
      isActive: true
    });

    host2 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor1.id,
      host: 'localhost',
      port: 2776,
      priority: 2,
      isActive: true
    });

    host3 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor2.id,
      host: 'localhost',
      port: 2777,
      priority: 1,
      isActive: true
    });

    // Create test client
    client = await Client.create({
      id: 'test-client1',
      systemId: 'client1',
      password: 'password1',
      maxConnections: 2,
      routingStrategy: 'priority'
    });

    // Wait for vendor cache to update
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  describe('Host Failover Tests', () => {
    it('should connect to all active hosts', async () => {
      await smppClient.connectToVendor(vendor1.id);
      const vendorSessions = smppClient.vendors.get(vendor1.id);
      assert.strictEqual(vendorSessions.size, 2);
    });

    it('should failover to secondary host when primary fails', async () => {
      // Simulate primary host failure
      await VendorHost.update({ isActive: false }, { where: { id: host1.id } });

      // Wait for cache to update
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const message = {
        clientId: client.id,
        ourMessageId: uuidv4(),
        source: 'TEST',
        destination: '1234567890',
        content: 'Test Message'
      };

      await smppClient.sendMessage(vendor1.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, host2.id);
    });
  });

  describe('Host Priority Tests', () => {
    it('should prefer highest priority host when available', async () => {
      // Reactivate primary host
      await VendorHost.update({ isActive: true }, { where: { id: host1.id } });

      // Wait for cache to update
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const message = {
        clientId: client.id,
        ourMessageId: uuidv4(),
        source: 'TEST',
        destination: '1234567890',
        content: 'Test Message'
      };

      await smppClient.sendMessage(vendor1.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, host1.id);
    });
  });

  after(async () => {
    await VendorHost.destroy({ where: {} });
    await Vendor.destroy({ where: {} });
    await Client.destroy({ where: {} });
    await Message.destroy({ where: {} });
  });
});
