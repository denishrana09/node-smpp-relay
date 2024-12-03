const smpp = require('smpp');
const Message = require('../models/message');
const sequelize = require('../config/database');

async function testCompleteFlow() {
  // First ensure database is connected and synced
  await sequelize.sync();
  console.log('Database synchronized for test');

  // Create client session
  const session = new smpp.Session({
    host: 'localhost',
    port: process.env.SMPP_SERVER_PORT || 2775
  });

  try {
    // Bind as transceiver
    await new Promise((resolve, reject) => {
      session.bind_transceiver(
        {
          system_id: 'client1',
          password: 'password1'
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

    console.log('Successfully bound to server');

    // Set up delivery report handler
    session.on('deliver_sm', (pdu) => {
      console.log('Received delivery report:', pdu.short_message);
      session.send(pdu.response());
    });

    // Send test messages
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => {
        session.submit_sm(
          {
            source_addr: 'TEST',
            destination_addr: `1234567${i}`,
            short_message: `Test message ${i}`,
            registered_delivery: 1
          },
          (pdu) => {
            console.log(`Message ${i} sent:`, pdu);
            resolve();
          }
        );
      });

      // Wait a bit between messages
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Wait for delivery reports
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check database for messages with error handling and debugging
    try {
      const messages = await Message.findAll({
        raw: true // Get plain objects instead of Sequelize instances
      });
      console.log('Query completed. Number of messages:', messages.length);
      if (messages.length === 0) {
        console.log('No messages found. Checking connection...');
        // Verify the connection and table
        const count = await Message.count();
        console.log('Total message count in database:', count);
      } else {
        console.log('Messages in database:', messages);
      }
    } catch (dbError) {
      console.error('Database query failed:', dbError);
    }
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    session.unbind();
  }
}

// Ensure we handle the promise rejection
testCompleteFlow()
  .catch(console.error)
  .finally(async () => {
    // Close database connection when done
    await sequelize.close();
  });
