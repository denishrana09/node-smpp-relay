const { Kafka } = require('kafkajs');
require('dotenv').config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'smpp-gateway-admin',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const admin = kafka.admin();

const topics = [
  {
    topic: 'incoming-messages',
    numPartitions: parseInt(process.env.KAFKA_PARTITIONS || '3'),
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || '1')
  },
  {
    topic: 'delivery-reports',
    numPartitions: parseInt(process.env.KAFKA_PARTITIONS || '3'),
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || '1')
  }
];

async function createTopics() {
  try {
    await admin.connect();
    
    // Check if topics exist
    const existingTopics = await admin.listTopics();
    
    const topicsToCreate = topics.filter(
      topic => !existingTopics.includes(topic.topic)
    );

    if (topicsToCreate.length > 0) {
      await admin.createTopics({
        topics: topicsToCreate,
        waitForLeaders: true
      });
      console.log('Kafka topics created successfully');
    }

  } catch (error) {
    console.error('Error creating Kafka topics:', error);
    throw error;
  } finally {
    await admin.disconnect();
  }
}

module.exports = { createTopics }; 