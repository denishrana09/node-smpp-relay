const smpp = require('smpp');

// Create test client
const session = new smpp.Session({
  host: 'localhost',
  port: 2775
});

// Bind as transceiver
session.bind_transceiver({
  system_id: 'client1',
  password: 'password1'
}, (pdu) => {
  if (pdu.command_status === 0) {
    console.log('Successfully bound');
    
    // Send test message
    session.submit_sm({
      source_addr: 'TEST',
      destination_addr: '1234567890',
      short_message: 'Hello, World!'
    }, (pdu) => {
      console.log('Message sent:', pdu);
    });
  }
}); 