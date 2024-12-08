const { Kafka } = require('kafkajs');
const smppClient = require('./smpp-client');
const routes = require('../config/routes');
const vendorCache = require('./vendor-availability-cache');

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'smpp-gateway',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({
  groupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'smpp-gateway-group'
});

// Keep track of round-robin counters for each client
const roundRobinCounters = new Map();

async function selectVendor(clientConfig) {
  // Get cached vendor data
  const vendorsData = await vendorCache.getActiveVendors();

  // Merge cached data with client config
  const vendors = clientConfig.vendors.map((v) => {
    const cachedVendor = vendorsData.find((cv) => cv.id === v.id);
    return { ...v, ...cachedVendor };
  });

  // Filter out vendors with no active hosts
  const availableVendors = vendors.filter((v) => v.activeHosts > 0);

  if (availableVendors.length === 0) {
    throw new Error('No vendors available with active hosts');
  }

  if (clientConfig.routingStrategy === 'priority') {
    // Sort vendors by priority and return the highest priority available vendor
    return availableVendors.sort((a, b) => a.priority - b.priority)[0];
  } else if (clientConfig.routingStrategy === 'round-robin') {
    // Initialize counter if not exists
    if (!roundRobinCounters.has(clientConfig.id)) {
      roundRobinCounters.set(clientConfig.id, 0);
    }

    const counter = roundRobinCounters.get(clientConfig.id);
    const vendor = availableVendors[counter % availableVendors.length];

    // Update counter
    roundRobinCounters.set(
      clientConfig.id,
      (counter + 1) % availableVendors.length
    );

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
        console.error(
          'No routing configuration found for client:',
          data.clientId
        );
        return;
      }

      try {
        const selectedVendor = await selectVendor(clientConfig);
        if (!selectedVendor) {
          console.error('No vendor selected for client:', data.clientId);
          return;
        }

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
