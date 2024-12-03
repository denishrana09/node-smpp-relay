const smpp = require('smpp');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class TestClient {
  constructor(systemId, password, port = 2775) {
    this.systemId = systemId;
    this.password = password;
    this.port = port;
    this.sessions = new Map();
    this.messagesSent = 0;
    this.deliveryReports = new Map();
  }

  async connect(numConnections = 1) {
    for (let i = 0; i < numConnections; i++) {
      const sessionId = uuidv4();
      const session = new smpp.Session({
        host: 'localhost',
        port: this.port
      });

      // Set up delivery report handler
      session.on('deliver_sm', (pdu) => {
        console.log(`[${this.systemId}] Received delivery report:`, pdu.short_message.message);
        this.deliveryReports.set(this.parseMessageId(pdu.short_message.message), pdu.short_message.message);
        session.send(pdu.response());
      });

      try {
        await new Promise((resolve, reject) => {
          session.bind_transceiver({
            system_id: this.systemId,
            password: this.password
          }, (pdu) => {
            if (pdu.command_status === 0) {
              resolve();
            } else {
              reject(new Error(`Bind failed for ${this.systemId}`));
            }
          });
        });

        this.sessions.set(sessionId, session);
        console.log(`[${this.systemId}] Connection ${i + 1} established`);
      } catch (error) {
        console.error(`[${this.systemId}] Connection ${i + 1} failed:`, error);
      }
    }
  }

  async sendMessage(text, destination) {
    const sessions = Array.from(this.sessions.values());
    if (sessions.length === 0) {
      throw new Error('No active sessions');
    }

    // Round-robin between sessions
    const session = sessions[this.messagesSent % sessions.length];
    this.messagesSent++;

    return new Promise((resolve, reject) => {
      session.submit_sm({
        source_addr: this.systemId,
        destination_addr: destination,
        short_message: text,
        registered_delivery: 1
      }, (pdu) => {
        if (pdu.command_status === 0) {
          console.log(`[${this.systemId}] Message sent, ID:`, pdu.message_id);
          resolve(pdu.message_id);
        } else {
          reject(new Error('Message send failed'));
        }
      });
    });
  }

  parseMessageId(deliveryReceipt) {
    const match = deliveryReceipt.match(/id:([^ ]+)/);
    return match ? match[1] : null;
  }

  async close() {
    for (const [sessionId, session] of this.sessions) {
      await new Promise(resolve => {
        session.unbind();
        session.on('close', resolve);
      });
    }
    this.sessions.clear();
  }
}

async function runTest() {
  try {
    // Create test clients
    const client1 = new TestClient('client1', 'password1');
    const client2 = new TestClient('client2', 'password2');

    // Test multiple connections
    console.log('\nTesting multiple connections...');
    await client1.connect(3); // Try to create 3 connections
    await client2.connect(2); // Try to create 2 connections

    // Wait a bit for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send test messages from both clients
    console.log('\nSending test messages...');
    const destinations = ['1234567890', '9876543210', '5555555555'];
    const messages = [
      'Test message 1',
      'Hello, World!',
      'Testing routing',
      'Multiple connections',
      'Delivery report test'
    ];

    // Send messages from both clients
    for (let i = 0; i < 10; i++) {
      const destination = destinations[i % destinations.length];
      const message = messages[i % messages.length];

      try {
        await client1.sendMessage(`C1-${message}-${i}`, destination);
        await client2.sendMessage(`C2-${message}-${i}`, destination);
        
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }

    // Wait for delivery reports
    console.log('\nWaiting for delivery reports...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Print delivery report statistics
    console.log('\nDelivery Report Statistics:');
    console.log('Client 1 delivery reports:', client1.deliveryReports.size);
    console.log('Client 2 delivery reports:', client2.deliveryReports.size);

    // Close connections
    await client1.close();
    await client2.close();

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
console.log('Starting comprehensive test...');
runTest().then(() => {
  console.log('Test completed');
}).catch(console.error); 