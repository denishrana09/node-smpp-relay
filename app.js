require('dotenv').config();
const express = require('express');
const sequelize = require('./config/database');
const smppServer = require('./services/smpp-server');
const smppClient = require('./services/smpp-client');
require('./services/kafka-consumer');
const { createTopics } = require('./services/kafka-admin');

const app = express();
app.use(express.json());

// Initialize database
sequelize.sync().then(() => {
  console.log('Database synchronized');
});

async function startServer() {
  try {
    // Initialize Kafka topics
    await createTopics();
    
    // Start SMPP server
    smppServer.start(process.env.SMPP_SERVER_PORT || 2775);

    // Connect to vendors
    const routes = require('./config/routes');
    Object.values(routes.clients).forEach(client => {
      client.vendors.forEach(vendor => {
        smppClient.connectToVendor(vendor.id);
      });
    });

    // Start Express server
    app.listen(process.env.PORT || 3000, () => {
      console.log(`REST API server started on port ${process.env.PORT || 3000}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer(); 