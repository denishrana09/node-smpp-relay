const sequelize = require('../../config/database');
const Message = require('../../models/message');
const Client = require('../../models/client');
const Vendor = require('../../models/vendor');

async function initializeDatabase() {
  try {
    // Sync all models
    await sequelize.sync({ force: true }); // Use force: true to recreate tables

    // Clear existing data
    await Message.destroy({ truncate: true });
    await Client.destroy({ truncate: true });
    await Vendor.destroy({ truncate: true });

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

module.exports = {
  initializeDatabase,
  sequelize
}; 