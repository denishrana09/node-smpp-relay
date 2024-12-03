const smpp = require('smpp');
const { v4: uuidv4 } = require('uuid');
const Message = require('../models/message');
const { initializeDatabase, sequelize } = require('./helpers/db-init');
const { seed } = require('../seeders/initial-data');
const { Op } = require('sequelize');
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

async function testPriorityRouting() {
  try {
    // Initialize database and seed data
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('Running seeder...');
    await seed();
    console.log('Database ready');

    const client1 = new TestClient('client1', 'password1');
    const client2 = new TestClient('client2', 'password2');

    try {
      await client1.connect();
      await client2.connect();
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('\nPhase 1: Testing with all vendors available...');
      // Send messages from both clients
      for (let i = 0; i < 5; i++) {
        await client1.sendMessage(`C1-Priority-Test-1-${i}`, '1234567890');
        await client2.sendMessage(`C2-Priority-Test-1-${i}`, '9876543210');
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('\nPhase 2: Simulating primary vendor (vendor1) downtime...');
      console.log('Please stop vendor1 (port 2776) now and press Enter to continue...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('\nSending messages while primary vendor is down...');
      for (let i = 0; i < 5; i++) {
        await client1.sendMessage(`C1-Priority-Test-2-${i}`, '1234567890');
        await client2.sendMessage(`C2-Priority-Test-2-${i}`, '9876543210');
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('\nPhase 3: Simulating secondary vendor downtime...');
      console.log('For client1: Please stop vendor2 (port 2777)');
      console.log('For client2: Please stop vendor3 (port 2778)');
      console.log('Press Enter to continue...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('\nSending messages while primary and secondary vendors are down...');
      for (let i = 0; i < 5; i++) {
        await client1.sendMessage(`C1-Priority-Test-3-${i}`, '1234567890');
        await client2.sendMessage(`C2-Priority-Test-3-${i}`, '9876543210');
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('\nPhase 4: Restoring all vendors...');
      console.log('Please start all vendors again and press Enter to continue...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('\nSending final batch of messages...');
      for (let i = 0; i < 5; i++) {
        await client1.sendMessage(`C1-Priority-Test-4-${i}`, '1234567890');
        await client2.sendMessage(`C2-Priority-Test-4-${i}`, '9876543210');
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Wait longer for delivery reports and database updates
      console.log('\nWaiting for delivery reports and database updates...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Analyze message distribution
      const messages = await Message.findAll({
        where: {
          clientId: ['client1', 'client2'],
          content: {
            [Op.like]: '%Priority-Test%'
          }
        },
        attributes: ['clientId', 'vendorId', 'content'],
        raw: true
      });

      console.log('\nTotal messages found:', messages.length);

      console.log('\nMessage Distribution Analysis:');
      console.log('----------------------------');

      ['client1', 'client2'].forEach(clientId => {
        const clientMessages = messages.filter(m => m.clientId === clientId);
        
        console.log(`\n${clientId.toUpperCase()} Analysis:`);
        console.log(`Total messages: ${clientMessages.length}`);
        
        // Phase 1 - All vendors available
        const phase1 = clientMessages.filter(m => m.content.includes('Test-1'));
        console.log('\nPhase 1 (All vendors available):');
        logVendorDistribution(phase1);

        // Phase 2 - Primary vendor down
        const phase2 = clientMessages.filter(m => m.content.includes('Test-2'));
        console.log('\nPhase 2 (Primary vendor down):');
        logVendorDistribution(phase2);

        // Phase 3 - Primary and secondary vendors down
        const phase3 = clientMessages.filter(m => m.content.includes('Test-3'));
        console.log('\nPhase 3 (Primary and secondary vendors down):');
        logVendorDistribution(phase3);

        // Phase 4 - All vendors restored
        const phase4 = clientMessages.filter(m => m.content.includes('Test-4'));
        console.log('\nPhase 4 (All vendors restored):');
        logVendorDistribution(phase4);
      });

    } catch (error) {
      console.error('Test execution failed:', error);
    } finally {
      await client1.close();
      await client2.close();
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Close database connection
    await sequelize.close();
  }
}

function logVendorDistribution(messages) {
  const distribution = messages.reduce((acc, msg) => {
    acc[msg.vendorId] = (acc[msg.vendorId] || 0) + 1;
    return acc;
  }, {});

  Object.entries(distribution).forEach(([vendorId, count]) => {
    console.log(`${vendorId}: ${count} messages`);
  });
}

// Run the test
console.log('Starting priority routing test...');
testPriorityRouting().then(() => {
  console.log('\nPriority routing test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
}); 