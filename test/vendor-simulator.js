const smpp = require('smpp');
const { v4: uuidv4 } = require('uuid');
const { initializeDatabase } = require('./helpers/db-init');

const { Vendor, VendorHost } = require('../models/vendor');

async function startVendorSimulators() {
  const vendors = await Vendor.findAll({
    include: [
      {
        model: VendorHost,
        as: 'hosts',
        where: { isActive: true }
      }
    ]
  });
  console.log('vendors', vendors.length);

  vendors.forEach((vendor) => {
    vendor.hosts.forEach((host) => {
      const server = smpp.createServer();

      server.listen(host.port);

      server.on('session', (session) => {
        session.on('bind_transceiver', (pdu) => {
          if (
            pdu.system_id === vendor.systemId &&
            pdu.password === vendor.password
          ) {
            session.send(pdu.response());
            console.log(
              `Vendor ${vendor.id} simulator bound on port ${host.port}`
            );
          } else {
            session.send(pdu.response({ command_status: smpp.ESME_RBINDFAIL }));
            console.log(`Vendor ${vendor.id} bind failed on port ${host.port}`);
          }
        });

        session.on('submit_sm', (pdu) => {
          // const messageId = `${vendor.id}_${host.id}_${Date.now()}`;
          const messageId = uuidv4();
          session.send(pdu.response({ message_id: messageId }));

          setTimeout(() => {
            session.deliver_sm({
              source_addr: pdu.destination_addr,
              destination_addr: pdu.source_addr,
              short_message: {
                message: `id:${messageId} sub:001 dlvrd:001 submit date:2403211200 done date:2403211201 stat:DELIVERED err:000`
              },
              receipted_message_id: messageId
            });
          }, 2000);
        });

        session.on('error', (error) => {
          console.log(
            `vendor error`,
            {
              vendorId: vendor.id,
              hostId: host.id
            },
            error
          );
        });

        session.on('close', () => {
          console.log(`Client disconnected`, {
            vendorId: vendor.id,
            hostId: host.id
          });
        });
      });

      console.log(`Vendor ${vendor.id} simulator started on port ${host.port}`);
    });
  });
}

initializeDatabase().then(() => {
  startVendorSimulators().catch(console.error);
});
