const assert = require('assert');
const { Vendor, VendorHost } = require('../models/vendor');
const Client = require('../models/client');
const Message = require('../models/message');
const smppClient = require('../services/smpp-client');
const vendorCache = require('../services/vendor-availability-cache');
const { v4: uuidv4 } = require('uuid');

describe('Routing Strategies with Multiple Hosts', () => {
  let vendor1, vendor2;
  let vendor1Host1, vendor1Host2, vendor2Host1, vendor2Host2;
  let priorityClient, roundRobinClient;

  before(async () => {
    // Create vendors
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

    // Create hosts for vendor1
    vendor1Host1 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor1.id,
      host: 'localhost',
      port: 2775,
      priority: 1,
      isActive: true
    });

    vendor1Host2 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor1.id,
      host: 'localhost',
      port: 2776,
      priority: 2,
      isActive: true
    });

    // Create hosts for vendor2
    vendor2Host1 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor2.id,
      host: 'localhost',
      port: 2777,
      priority: 1,
      isActive: true
    });

    vendor2Host2 = await VendorHost.create({
      id: uuidv4(),
      vendorId: vendor2.id,
      host: 'localhost',
      port: 2778,
      priority: 2,
      isActive: true
    });

    // Create clients with different routing strategies
    priorityClient = await Client.create({
      id: 'priority-client',
      systemId: 'priority',
      password: 'password1',
      maxConnections: 2,
      routingStrategy: 'priority'
    });

    roundRobinClient = await Client.create({
      id: 'roundrobin-client',
      systemId: 'roundrobin',
      password: 'password2',
      maxConnections: 2,
      routingStrategy: 'round-robin'
    });

    // Wait for vendor cache to update
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  describe('Priority Routing Tests', () => {
    it('should use highest priority host of highest priority vendor', async () => {
      const message = createTestMessage(priorityClient.id);
      await smppClient.sendMessage(vendor1.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, vendor1Host1.id);
    });

    it('should failover to second priority host when first fails', async () => {
      // Disable primary host
      await VendorHost.update(
        { isActive: false },
        { where: { id: vendor1Host1.id } }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const message = createTestMessage(priorityClient.id);
      await smppClient.sendMessage(vendor1.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, vendor1Host2.id);
    });

    it('should failover to second vendor when all hosts of first vendor fail', async () => {
      // Disable all hosts of vendor1
      await VendorHost.update(
        { isActive: false },
        { where: { id: vendor1Host2.id } }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const message = createTestMessage(priorityClient.id);
      await smppClient.sendMessage(vendor2.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, vendor2Host1.id);
    });

    it('should return to primary host when it becomes available', async () => {
      // Reactivate primary host
      await VendorHost.update(
        { isActive: true },
        { where: { id: vendor1Host1.id } }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const message = createTestMessage(priorityClient.id);
      await smppClient.sendMessage(vendor1.id, message);

      const sentMessage = await Message.findOne({
        where: { id: message.ourMessageId }
      });

      assert.strictEqual(sentMessage.hostId, vendor1Host1.id);
    });
  });

  describe('Round-Robin Routing Tests', () => {
    before(async () => {
      // Ensure all hosts are active
      await VendorHost.update({ isActive: true }, { where: {} });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    it('should distribute messages across all hosts of a vendor', async () => {
      const messages = [];
      const hostIds = new Set();

      // Send multiple messages
      for (let i = 0; i < 4; i++) {
        const message = createTestMessage(roundRobinClient.id);
        await smppClient.sendMessage(vendor1.id, message);
        messages.push(message.ourMessageId);
      }

      // Check distribution
      for (const messageId of messages) {
        const sentMessage = await Message.findOne({
          where: { id: messageId }
        });
        hostIds.add(sentMessage.hostId);
      }

      // Should have used both hosts
      assert.strictEqual(hostIds.size, 2);
    });

    it('should skip failed hosts in round-robin rotation', async () => {
      // Disable one host
      await VendorHost.update(
        { isActive: false },
        { where: { id: vendor1Host2.id } }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const messages = [];
      const hostIds = new Set();

      // Send multiple messages
      for (let i = 0; i < 3; i++) {
        const message = createTestMessage(roundRobinClient.id);
        await smppClient.sendMessage(vendor1.id, message);
        messages.push(message.ourMessageId);
      }

      // Check all messages went through the active host
      for (const messageId of messages) {
        const sentMessage = await Message.findOne({
          where: { id: messageId }
        });
        assert.strictEqual(sentMessage.hostId, vendor1Host1.id);
      }
    });

    it('should reintegrate recovered host into rotation', async () => {
      // Reactivate the disabled host
      await VendorHost.update(
        { isActive: true },
        { where: { id: vendor1Host2.id } }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const messages = [];
      const hostIds = new Set();

      // Send multiple messages
      for (let i = 0; i < 4; i++) {
        const message = createTestMessage(roundRobinClient.id);
        await smppClient.sendMessage(vendor1.id, message);
        messages.push(message.ourMessageId);
      }

      // Should have used both hosts again
      for (const messageId of messages) {
        const sentMessage = await Message.findOne({
          where: { id: messageId }
        });
        hostIds.add(sentMessage.hostId);
      }

      assert.strictEqual(hostIds.size, 2);
    });
  });

  // Helper function to create test messages
  function createTestMessage(clientId) {
    return {
      clientId,
      ourMessageId: uuidv4(),
      source: 'TEST',
      destination: '1234567890',
      content: 'Test Message'
    };
  }

  after(async () => {
    await VendorHost.destroy({ where: {} });
    await Vendor.destroy({ where: {} });
    await Client.destroy({ where: {} });
    await Message.destroy({ where: {} });
  });
});
