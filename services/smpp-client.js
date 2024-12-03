const smpp = require('smpp');
const Vendor = require('../models/vendor');
const Message = require('../models/message');
const kafka = require('./kafka-producer');
const smppServer = require('./smpp-server');

class SmppClient {
  constructor() {
    this.vendors = new Map(); // Map<vendorId, session>
    this.messageMap = new Map(); // Map<vendorMessageId, { ourMessageId, clientId }>
    this.reconnectAttempts = new Map(); // Map<vendorId, { interval, isConnecting }>
  }

  async connectToVendor(vendorId) {
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) return;

    // If already trying to connect, skip
    if (this.reconnectAttempts.get(vendorId)?.isConnecting) {
      return;
    }

    const session = new smpp.Session({
      host: vendor.host,
      port: vendor.port,
    });

    try {
      // Set up error and close handlers before binding
      this.setupSessionHandlers(session, vendorId, vendor);

      await new Promise((resolve, reject) => {
        session.bind_transceiver(
          {
            system_id: vendor.systemId,
            password: vendor.password,
          },
          (pdu) => {
            if (pdu.command_status === 0) {
              resolve();
            } else {
              reject(new Error('Bind failed'));
            }
          }
        );
      });

      this.vendors.set(vendorId, session);
      console.log(`Connected to vendor ${vendorId}`);

      // Clear reconnection state if successful
      this.reconnectAttempts.delete(vendorId);

    } catch (error) {
      console.error(`Failed to connect to vendor ${vendorId}:`, error);
      this.scheduleReconnect(vendorId, vendor);
    }
  }

  setupSessionHandlers(session, vendorId, vendor) {
    session.on('error', (error) => {
      console.error(`Vendor ${vendorId} session error:`, error);
    });

    session.on('close', () => {
      console.log(`Vendor ${vendorId} connection closed`);
      this.vendors.delete(vendorId);
      this.scheduleReconnect(vendorId, vendor);
    });

    session.on('deliver_sm', async (pdu) => {
      session.send(pdu.response());
      await this.handleDeliveryReport(vendorId, pdu);
    });
  }

  scheduleReconnect(vendorId, vendor) {
    const reconnectInfo = this.reconnectAttempts.get(vendorId) || {
      interval: 5000, // Start with 5 seconds
      isConnecting: false
    };

    if (!reconnectInfo.isConnecting) {
      reconnectInfo.isConnecting = true;
      this.reconnectAttempts.set(vendorId, reconnectInfo);

      setTimeout(async () => {
        console.log(`Attempting to reconnect to vendor ${vendorId}`);
        await this.connectToVendor(vendorId);
      }, reconnectInfo.interval);
    }
  }

  async sendMessage(vendorId, message) {
    const session = this.vendors.get(vendorId);
    if (!session) return false;

    try {
      const vendorMessageId = await new Promise((resolve, reject) => {
        session.submit_sm({
          source_addr: message.source,
          destination_addr: message.destination,
          short_message: message.content,
          registered_delivery: 1
        }, (pdu) => {
          if (pdu.command_status === 0) {
            resolve(pdu.message_id);
          } else {
            reject(new Error('Message send failed'));
          }
        });
      });

      // Store message in database with both IDs
      await Message.create({
        id: message.ourMessageId,
        clientId: message.clientId,
        vendorId: vendorId,
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
        clientId: message.clientId
      });

      return vendorMessageId;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async handleDeliveryReport(vendorId, pdu) {
    try {
      const deliveryReceipt = this.parseDeliveryReceipt(pdu.short_message.message);
      const vendorMessageId = deliveryReceipt.id;
      const status = deliveryReceipt.stat;

      // Get our message details from vendor message ID mapping
      const messageDetails = this.messageMap.get(vendorMessageId);
      if (!messageDetails) {
        console.error('Message details not found for vendor ID:', vendorMessageId);
        return;
      }

      // Update message status in database
      await Message.update(
        { status: status },
        {
          where: {
            id: messageDetails.ourMessageId,
            vendorId: vendorId
          }
        }
      );

      // Send delivery report to Kafka
      await kafka.sendMessage('delivery-reports', {
        ourMessageId: messageDetails.ourMessageId,
        vendorMessageId: vendorMessageId,
        clientId: messageDetails.clientId,
        vendorId: vendorId,
        status: status,
        timestamp: new Date().toISOString()
      });

      // Forward delivery report to client with our message ID
      smppServer.sendDeliveryReport(
        messageDetails.clientId,
        messageDetails.ourMessageId,
        status
      );

      // Clean up message mapping if final status
      if (['DELIVERED', 'EXPIRED', 'DELETED', 'UNDELIVERABLE', 'REJECTED'].includes(status)) {
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
