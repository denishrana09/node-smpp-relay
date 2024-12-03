const smpp = require('smpp');
const { v4: uuidv4 } = require('uuid');
const Message = require('../models/message');
require('dotenv').config();

class TestClient {
  constructor(systemId, password, port = 2775) {
    this.systemId = systemId;
    this.password = password;
    this.port = port;
    this.session = null;
    this.deliveryReports = new Map();
  }

  async connect() {
    this.session = new smpp.Session({
      host: 'localhost',
      port: this.port
    });

    // Set up delivery report handler
    this.session.on('deliver_sm', (pdu) => {
      console.log(`[${this.systemId}] Received delivery report:`, pdu.short_message.message);
      this.deliveryReports.set(this.parseMessageId(pdu.short_message.message), pdu.short_message.message);
      this.session.send(pdu.response());
    });

    return new Promise((resolve, reject) => {
      this.session.bind_transceiver({
        system_id: this.systemId,
        password: this.password
      }, (pdu) => {
        if (pdu.command_status === 0) {
          console.log(`[${this.systemId}] Connected successfully`);
          resolve();
        } else {
          reject(new Error(`Bind failed for ${this.systemId}`));
        }
      });
    });
  }

  async sendMessage(text, destination) {
    return new Promise((resolve, reject) => {
      this.session.submit_sm({
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
    if (this.session) {
      await new Promise(resolve => {
        this.session.unbind();
        this.session.on('close', resolve);
      });
    }
  }
}

async function testRouting() {
  const client1 = new TestClient('client1', 'password1'); // Priority-based routing
  const client2 = new TestClient('client2', 'password2'); // Round-robin routing

  try {
    await client1.connect();
    await client2.connect();

    // Wait for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\nTesting Priority-based routing (client1)...');
    // Send 10 messages from client1 (should mostly go to vendor1 due to priority)
    for (let i = 0; i < 10; i++) {
      await client1.sendMessage(`Priority-Test-${i}`, '1234567890');
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\nTesting Round-robin routing (client2)...');
    // Send 15 messages from client2 (should be distributed among vendor1 and vendor3)
    for (let i = 0; i < 15; i++) {
      await client2.sendMessage(`RoundRobin-Test-${i}`, '9876543210');
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Wait for delivery reports
    console.log('\nWaiting for delivery reports...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check message distribution in database
    const messages = await Message.findAll({
      attributes: ['clientId', 'vendorId'],
      raw: true
    });

    // Analyze routing distribution
    const distribution = messages.reduce((acc, msg) => {
      const key = `${msg.clientId}-${msg.vendorId}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    console.log('\nRouting Distribution:');
    console.log('---------------------');
    Object.entries(distribution).forEach(([key, count]) => {
      const [clientId, vendorId] = key.split('-');
      console.log(`${clientId} -> ${vendorId}: ${count} messages`);
    });

    // Verify priority-based routing for client1
    const client1Messages = messages.filter(msg => msg.clientId === 'client1');
    const client1Primary = client1Messages.filter(msg => msg.vendorId === 'vendor1').length;
    const client1Secondary = client1Messages.filter(msg => msg.vendorId === 'vendor2').length;
    
    console.log('\nPriority Routing Analysis (client1):');
    console.log(`Primary vendor (vendor1): ${client1Primary} messages`);
    console.log(`Secondary vendor (vendor2): ${client1Secondary} messages`);
    console.log(`Priority ratio: ${(client1Primary / client1Messages.length * 100).toFixed(2)}% to primary vendor`);

    // Verify round-robin for client2
    const client2Messages = messages.filter(msg => msg.clientId === 'client2');
    const vendorDistribution = client2Messages.reduce((acc, msg) => {
      acc[msg.vendorId] = (acc[msg.vendorId] || 0) + 1;
      return acc;
    }, {});

    console.log('\nRound-Robin Analysis (client2):');
    Object.entries(vendorDistribution).forEach(([vendorId, count]) => {
      console.log(`${vendorId}: ${count} messages (${(count / client2Messages.length * 100).toFixed(2)}%)`);
    });

    await client1.close();
    await client2.close();

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
console.log('Starting routing test...');
testRouting().then(() => {
  console.log('\nRouting test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
}); 