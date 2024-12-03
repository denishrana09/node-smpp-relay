const { Kafka } = require('kafkajs');
const smppClient = require('./smpp-client');
const routes = require('../config/routes');

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'smpp-gateway',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'smpp-gateway-group' });

// Keep track of round-robin counters for each client
const roundRobinCounters = new Map();

function selectVendor(clientConfig) {
  if (clientConfig.routingStrategy === 'priority') {
    // Sort vendors by priority and return the highest priority available vendor
    return clientConfig.vendors.sort((a, b) => a.priority - b.priority)[0];
  } else if (clientConfig.routingStrategy === 'round-robin') {
    // Initialize counter if not exists
    if (!roundRobinCounters.has(clientConfig.id)) {
      roundRobinCounters.set(clientConfig.id, 0);
    }

    const counter = roundRobinCounters.get(clientConfig.id);
    const vendor = clientConfig.vendors[counter % clientConfig.vendors.length];
    
    // Update counter
    roundRobinCounters.set(clientConfig.id, (counter + 1) % clientConfig.vendors.length);
    
    return vendor;
  }
}

async function init() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'incoming-messages' });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value.toString());
      const clientConfig = routes.clients[data.clientId];
      
      if (!clientConfig) {
        console.error('No routing configuration found for client:', data.clientId);
        return;
      }

      const selectedVendor = selectVendor(clientConfig);
      if (!selectedVendor) {
        console.error('No vendor selected for client:', data.clientId);
        return;
      }

      try {
        await smppClient.sendMessage(selectedVendor.id, {
          ...data,
          ourMessageId: data.ourMessageId
        });
      } catch (error) {
        console.error('Failed to send message:', error);
        // Here you could implement retry logic or failover to next vendor
      }
    }
  });
}

init().catch(console.error); 