const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  clientId: DataTypes.STRING,
  vendorId: DataTypes.STRING,
  messageId: DataTypes.STRING,
  vendorMessageId: DataTypes.STRING,
  source: DataTypes.STRING,
  destination: DataTypes.STRING,
  content: DataTypes.TEXT,
  status: DataTypes.STRING,
  direction: DataTypes.ENUM('MO', 'MT')
});

module.exports = Message; 