const smpp = require('smpp');
const { Vendor, VendorHost } = require('../models/vendor');
const Message = require('../models/message');
const kafka = require('./kafka-producer');
const smppServer = require('./smpp-server');

class SmppClient {
  constructor() {
    // Map structure: vendorId -> Map<hostId, { session, status, lastConnected, failureCount }>
    this.vendors = new Map();

    // Track message routing: vendorMessageId -> { ourMessageId, clientId, vendorId, hostId }
    this.messageMap = new Map();

    // Track round-robin state per vendor: vendorId -> { currentHostIndex, activeHosts }
    this.roundRobinState = new Map();
  }

  async connectToVendor(vendorId) {
    const rawVendor = await Vendor.findByPk(vendorId, {
      include: [
        {
          model: VendorHost,
          as: 'hosts',
          where: { isActive: true },
          order: [['priority', 'ASC']]
        }
      ]
    });
    const vendor = rawVendor.get({ plain: true });

    if (!vendor || !vendor.hosts.length) return;

    // Initialize vendor sessions map if not exists
    if (!this.vendors.has(vendorId)) {
      this.vendors.set(vendorId, new Map());
    }

    // Initialize round-robin state
    this.roundRobinState.set(vendorId, {
      currentHostIndex: 0,
      activeHosts: vendor.hosts.length
    });

    // Connect to all active hosts for this vendor
    for (const hostDetail of vendor.hosts) {
      this.connectToHost(vendor, hostDetail);
    }
  }

  async connectToHost(vendor, hostDetail) {
    const vendorSessions = this.vendors.get(vendor.id);

    // Skip if already connecting or connected
    if (vendorSessions.get(hostDetail.id)?.status === 'connecting') return;

    const session = new smpp.Session({
      host: hostDetail.host,
      port: hostDetail.port
    });

    // Update session status
    vendorSessions.set(hostDetail.id, {
      session,
      status: 'connecting',
      lastConnected: null,
      failureCount: 0,
      hostDetail: hostDetail
    });

    try {
      await this.bindSession(session, vendor, hostDetail);

      // Update session status on successful connection
      vendorSessions.set(hostDetail.id, {
        session,
        status: 'active',
        lastConnected: new Date(),
        failureCount: 0,
        hostDetail: hostDetail
      });

      console.log(
        `Connected to vendor ${vendor.id} hostDetail ${hostDetail.host}:${hostDetail.port}`
      );
    } catch (error) {
      console.error(
        `Failed to connect to vendor ${vendor.id} hostDetail ${hostDetail.host}:${hostDetail.port}:`,
        error
      );
      this.handleConnectionFailure(vendor.id, hostDetail.id);
    }
  }

  async bindSession(session, vendor, hostDetail) {
    // Set up session handlers before binding
    this.setupSessionHandlers(session, vendor.id, hostDetail.id);

    return new Promise((resolve, reject) => {
      session.bind_transceiver(
        {
          system_id: vendor.systemId,
          password: vendor.password
        },
        (pdu) => {
          if (pdu.command_status === 0) {
            resolve();
          } else {
            console.log('bind failed', hostDetail, pdu);
            reject(new Error('Bind failed'));
          }
        }
      );
    });
  }

  setupSessionHandlers(session, vendorId, hostId) {
    session.on('error', (error) => {
      console.error(`Vendor ${vendorId} host ${hostId} session error:`, error);
    });

    session.on('close', () => {
      console.log(`Vendor ${vendorId} host ${hostId} connection closed`);
      this.vendors.get(vendorId).delete(hostId);
      this.handleConnectionFailure(vendorId, hostId);
    });

    session.on('deliver_sm', async (pdu) => {
      session.send(pdu.response());
      await this.handleDeliveryReport(vendorId, hostId, pdu);
    });
  }

  handleConnectionFailure(vendorId, hostId) {
    const vendorSessions = this.vendors.get(vendorId);
    const sessionInfo = vendorSessions.get(hostId);

    if (sessionInfo) {
      sessionInfo.failureCount++;

      if (sessionInfo.failureCount >= 3) {
        // Mark host as failed
        sessionInfo.status = 'failed';
        console.log(`Vendor ${vendorId} host ${hostId} failed`);
      } else {
        // Schedule reconnection
        setTimeout(() => {
          this.connectToHost(sessionInfo.hostDetail, hostId);
        }, 2000);
      }
    }
  }

  async sendMessage(vendorId, message) {
    const vendorSessions = this.vendors.get(vendorId);
    if (!vendorSessions || vendorSessions.size === 0) {
      throw new Error(`No active sessions for vendor ${vendorId}`);
    }

    // Get the appropriate host based on routing strategy
    const hostId = await this.selectHost(vendorId);
    if (!hostId) {
      throw new Error(`No available hosts for vendor ${vendorId}`);
    }

    const sessionInfo = vendorSessions.get(hostId);
    if (!sessionInfo || sessionInfo.status !== 'active') {
      throw new Error(`Selected host ${hostId} is not active`);
    }

    try {
      const vendorMessageId = await this.submitMessage(
        sessionInfo.session,
        message
      );

      // Store message in database with both IDs
      await Message.create({
        id: message.ourMessageId,
        clientId: message.clientId,
        vendorId: vendorId,
        hostId: hostId,
        messageId: message.ourMessageId,
        vendorMessageId: vendorMessageId,
        source: message.source,
        destination: message.destination,
        content: message.content,
        status: 'SENT',
        direction: 'MT'
      });

      // Store mapping between vendor message ID and our message ID
      this.messageMap.set(vendorMessageId, {
        ourMessageId: message.ourMessageId,
        clientId: message.clientId,
        vendorId: vendorId,
        hostId: hostId
      });

      return vendorMessageId;
    } catch (error) {
      console.error(`Error sending message through host ${hostId}:`, error);

      // Mark this host as failed and try another one
      this.handleConnectionFailure(vendorId, hostId);

      // Recursive retry with remaining hosts
      return this.sendMessage(vendorId, message);
    }
  }

  async submitMessage(session, message) {
    return new Promise((resolve, reject) => {
      session.submit_sm(
        {
          source_addr: message.source,
          destination_addr: message.destination,
          short_message: message.content,
          registered_delivery: 1
        },
        (pdu) => {
          if (pdu.command_status === 0) {
            resolve(pdu.message_id);
          } else {
            reject(
              new Error(
                `Message send failed with status: ${pdu.command_status}`
              )
            );
          }
        }
      );
    });
  }

  async selectHost(vendorId) {
    const vendorSessions = this.vendors.get(vendorId);
    const activeSessions = Array.from(vendorSessions.entries())
      .filter(([_, info]) => info.status === 'active')
      .sort((a, b) => a[1].hostDetail.priority - b[1].hostDetail.priority);

    if (activeSessions.length === 0) return null;

    // Get round-robin state for this vendor
    const rrState = this.roundRobinState.get(vendorId);

    if (!rrState) {
      // If no round-robin state, return highest priority host
      return activeSessions[0][0];
    }

    // Update active hosts count
    rrState.activeHosts = activeSessions.length;

    // Use round-robin selection
    const selectedIndex = rrState.currentHostIndex % rrState.activeHosts;
    rrState.currentHostIndex =
      (rrState.currentHostIndex + 1) % rrState.activeHosts;

    return activeSessions[selectedIndex][0];
  }

  async handleDeliveryReport(vendorId, hostId, pdu) {
    try {
      const deliveryReceipt = this.parseDeliveryReceipt(
        pdu.short_message.message
      );
      const vendorMessageId = pdu.receipted_message_id || deliveryReceipt.id;
      const status = deliveryReceipt.stat;

      // Get our message details from vendor message ID mapping
      const messageDetails = this.messageMap.get(vendorMessageId);
      if (!messageDetails) {
        console.error(
          'Message details not found for vendor ID:',
          vendorMessageId
        );
        return;
      }

      // Update message status in database
      await Message.update(
        { status: status },
        {
          where: {
            id: messageDetails.ourMessageId,
            vendorId: vendorId,
            hostId: hostId
          }
        }
      );

      // Send delivery report to Kafka
      await kafka.sendMessage('delivery-reports', {
        ourMessageId: messageDetails.ourMessageId,
        vendorMessageId: vendorMessageId,
        clientId: messageDetails.clientId,
        vendorId: vendorId,
        hostId: hostId,
        status: status,
        timestamp: new Date().toISOString()
      });

      // Forward delivery report to client
      smppServer.sendDeliveryReport(
        messageDetails.clientId,
        messageDetails.ourMessageId,
        status
      );

      // Clean up message mapping if final status
      if (
        [
          'DELIVERED',
          'EXPIRED',
          'DELETED',
          'UNDELIVERABLE',
          'REJECTED'
        ].includes(status)
      ) {
        this.messageMap.delete(vendorMessageId);
      }
    } catch (error) {
      console.error('Error handling delivery report:', error);
    }
  }

  parseDeliveryReceipt(message) {
    // Basic delivery receipt parser
    // Format: id:IIIIIIIIII sub:SSS dlvrd:DDD submit date:YYMMDDhhmm done date:YYMMDDhhmm stat:DDDDDDD err:E text:..........
    const receipt = {};
    message.split(' ').forEach((part) => {
      const [key, value] = part.split(':');
      if (key && value) {
        receipt[key] = value;
      }
    });
    return receipt;
  }
}

module.exports = new SmppClient();
