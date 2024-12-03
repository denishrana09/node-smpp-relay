const smpp = require('smpp');
const server = smpp.createServer();

const port = process.env.VENDOR_PORT || 2776;
const systemId = process.env.VENDOR_ID || 'vendor1';

server.listen(port);

server.on('session', (session) => {
  session.on('bind_transceiver', (pdu) => {
    session.send(pdu.response());
    console.log('Vendor simulator bound');
  });

  session.on('submit_sm', (pdu) => {
    // Send immediate response with message ID
    const messageId = `TEST_${Date.now()}`;
    session.send(pdu.response({ message_id: messageId }));

    // Simulate delivery report after 2 seconds
    setTimeout(() => {
      session.deliver_sm({
        source_addr: pdu.destination_addr,
        destination_addr: pdu.source_addr,
        short_message: {
          message: `id:${messageId} sub:001 dlvrd:001 submit date:2403211200 done date:2403211201 stat:DELIVERED err:000`
        }
      });
    }, 2000);
  });
});

console.log(`Vendor simulator started on port ${port}`);
