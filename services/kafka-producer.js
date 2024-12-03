const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'smpp-gateway',
  brokers: ['localhost:9092']
});

const producer = kafka.producer();

async function init() {
  await producer.connect();
}

async function sendMessage(topic, message) {
  await producer.send({
    topic,
    messages: [{ value: JSON.stringify(message) }]
  });
}

init().catch(console.error);

module.exports = { sendMessage }; 