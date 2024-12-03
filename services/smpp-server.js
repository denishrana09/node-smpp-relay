const smpp = require('smpp');
const Client = require('../models/client');
const kafka = require('./kafka-producer');
const { v4: uuidv4 } = require('uuid');

class SmppServer {
  constructor() {
    this.server = smpp.createServer();
    this.clients = new Map(); // Map<clientId, Map<connectionId, session>>
    this.messageMap = new Map(); // Map<ourMessageId, { clientId, connectionId }>
  }

  start(port) {
    this.server.listen(port);
    this.server.on('session', this.handleSession.bind(this));
    console.log(`SMPP Server started on port ${port}`);
  }

  async handleSession(session) {
    // Handle session disconnect
    session.on('close', () => {
      this.handleSessionClose(session);
    });

    session.on('error', (error) => {
      console.error('Session error:', error);
      // Don't close the server, just handle the specific session error
    });

    session.on('bind_transceiver', async (pdu) => {
      try {
        const client = await Client.findOne({
          where: { systemId: pdu.system_id }
        });

        if (!client || client.password !== pdu.password) {
          session.send(pdu.response({ command_status: smpp.ESME_RBINDFAIL }));
          session.close();
          return;
        }

        // Generate unique connection ID for this session
        const connectionId = uuidv4();
        session.connectionId = connectionId;
        session.clientId = client.id;

        // Initialize client sessions map if not exists
        if (!this.clients.has(client.id)) {
          this.clients.set(client.id, new Map());
        }

        // Add session to client's sessions
        const clientSessions = this.clients.get(client.id);
        if (clientSessions.size >= client.maxConnections) {
          session.send(pdu.response({ command_status: smpp.ESME_RBINDFAIL }));
          session.close();
          return;
        }

        clientSessions.set(connectionId, session);
        session.send(pdu.response());

        session.on('submit_sm', async (pdu) => {
          const ourMessageId = uuidv4();
          
          // Send immediate response with our message ID
          session.send(pdu.response({ message_id: ourMessageId }));

          // Store message mapping
          this.messageMap.set(ourMessageId, {
            clientId: client.id,
            connectionId: connectionId
          });

          // Send to Kafka for processing
          await kafka.sendMessage('incoming-messages', {
            ourMessageId: ourMessageId,
            clientId: client.id,
            source: pdu.source_addr,
            destination: pdu.destination_addr,
            content: pdu.short_message.message,
            connectionId: connectionId
          });
        });

      } catch (error) {
        console.error('Error in bind_transceiver:', error);
        session.send(pdu.response({ command_status: smpp.ESME_RSYSERR }));
        session.close();
      }
    });
  }

  handleSessionClose(session) {
    if (session.clientId && session.connectionId) {
      const clientSessions = this.clients.get(session.clientId);
      if (clientSessions) {
        clientSessions.delete(session.connectionId);
        if (clientSessions.size === 0) {
          this.clients.delete(session.clientId);
        }
      }
    }
  }

  sendDeliveryReport(clientId, ourMessageId, status) {
    const messageDetails = this.messageMap.get(ourMessageId);
    if (!messageDetails) {
      console.error('Message details not found for ID:', ourMessageId);
      return;
    }

    const clientSessions = this.clients.get(clientId);
    if (!clientSessions) {
      console.error('No sessions found for client:', clientId);
      return;
    }

    // Try to use the original connection or any available connection
    const session = clientSessions.get(messageDetails.connectionId) || 
                   Array.from(clientSessions.values())[0];

    if (session) {
      const currentDate = new Date();
      const formattedDate = currentDate.toISOString()
        .replace(/[-T:.Z]/g, '')
        .slice(0, 12); // YYMMDDHHmmss

      session.deliver_sm({
        source_addr: 'GATEWAY',
        destination_addr: '',
        esm_class: 0x04, // This indicates this is a delivery receipt
        short_message: {
          message: `id:${ourMessageId} sub:001 dlvrd:001 submit date:${formattedDate} done date:${formattedDate} stat:${status} err:000 text:`
        }
      });

      // Clean up message mapping if final status
      if (['DELIVERED', 'EXPIRED', 'DELETED', 'UNDELIVERABLE', 'REJECTED'].includes(status)) {
        this.messageMap.delete(ourMessageId);
      }
    }
  }
}

module.exports = new SmppServer(); 