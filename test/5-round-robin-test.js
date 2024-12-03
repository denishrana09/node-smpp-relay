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
      console.log(
        `[${this.systemId}] Received delivery report:`,
        pdu.short_message.message
      );
      this.deliveryReports.set(
        this.parseMessageId(pdu.short_message.message),
        pdu.short_message.message
      );
      this.session.send(pdu.response());
    });

    return new Promise((resolve, reject) => {
      this.session.bind_transceiver(
        {
          system_id: this.systemId,
          password: this.password
        },
        (pdu) => {
          if (pdu.command_status === 0) {
            console.log(`[${this.systemId}] Connected successfully`);
            resolve();
          } else {
            reject(new Error(`Bind failed for ${this.systemId}`));
          }
        }
      );
    });
  }

  async sendMessage(text, destination) {
    return new Promise((resolve, reject) => {
      this.session.submit_sm(
        {
          source_addr: this.systemId,
          destination_addr: destination,
          short_message: text,
          registered_delivery: 1
        },
        (pdu) => {
          if (pdu.command_status === 0) {
            console.log(`[${this.systemId}] Message sent, ID:`, pdu.message_id);
            resolve(pdu.message_id);
          } else {
            reject(new Error('Message send failed'));
          }
        }
      );
    });
  }

  parseMessageId(deliveryReceipt) {
    const match = deliveryReceipt.match(/id:([^ ]+)/);
    return match ? match[1] : null;
  }

  async close() {
    if (this.session) {
      await new Promise((resolve) => {
        this.session.unbind();
        this.session.on('close', resolve);
      });
    }
  }
}

async function testRoundRobin() {
  const client3 = new TestClient('client3', 'password3');

  try {
    await client3.connect();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\nPhase 1: Testing round-robin distribution...');
    // Send messages in batches to see clear round-robin pattern
    for (let batch = 0; batch < 3; batch++) {
      console.log(`\nBatch ${batch + 1}:`);
      for (let i = 0; i < 3; i++) {
        await client3.sendMessage(
          `RR-Test-B${batch + 1}-${i + 1}`,
          '1234567890'
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    console.log('\nPhase 2: Testing with vendor downtime...');
    console.log(
      'Please stop vendor2 (port 2777) now and press Enter to continue...'
    );
    await new Promise((resolve) => process.stdin.once('data', resolve));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('\nSending messages with one vendor down...');
    for (let i = 0; i < 6; i++) {
      await client3.sendMessage(`RR-Test-Down-${i + 1}`, '1234567890');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log('\nPhase 3: Restoring vendor...');
    console.log('Please start vendor2 again and press Enter to continue...');
    await new Promise((resolve) => process.stdin.once('data', resolve));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('\nSending final batch of messages...');
    for (let i = 0; i < 6; i++) {
      await client3.sendMessage(`RR-Test-Final-${i + 1}`, '1234567890');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Wait for delivery reports
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Analyze message distribution
    const messages = await Message.findAll({
      where: { clientId: 'client3' },
      attributes: ['vendorId', 'content'],
      raw: true
    });

    console.log('\nMessage Distribution Analysis:');
    console.log('----------------------------');

    // Analyze initial round-robin distribution
    const phase1Messages = messages.filter((m) =>
      m.content.includes('RR-Test-B')
    );
    console.log('\nPhase 1 (Initial round-robin):');
    analyzeDistribution(phase1Messages);

    // Analyze distribution during vendor downtime
    const phase2Messages = messages.filter((m) =>
      m.content.includes('RR-Test-Down')
    );
    console.log('\nPhase 2 (One vendor down):');
    analyzeDistribution(phase2Messages);

    // Analyze distribution after vendor restoration
    const phase3Messages = messages.filter((m) =>
      m.content.includes('RR-Test-Final')
    );
    console.log('\nPhase 3 (All vendors restored):');
    analyzeDistribution(phase3Messages);

    await client3.close();
  } catch (error) {
    console.error('Test failed:', error);
  }
}

function analyzeDistribution(messages) {
  const distribution = messages.reduce((acc, msg) => {
    acc[msg.vendorId] = (acc[msg.vendorId] || 0) + 1;
    return acc;
  }, {});

  Object.entries(distribution).forEach(([vendorId, count]) => {
    const percentage = ((count / messages.length) * 100).toFixed(2);
    console.log(`${vendorId}: ${count} messages (${percentage}%)`);
  });
}

// Run the test
console.log('Starting round-robin routing test...');
testRoundRobin()
  .then(() => {
    console.log('\nRound-robin routing test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
