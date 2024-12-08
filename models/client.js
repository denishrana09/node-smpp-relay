const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  systemId: {
    type: DataTypes.STRING,
    unique: true
  },
  password: DataTypes.STRING,
  maxConnections: DataTypes.INTEGER,
  routingStrategy: {
    type: DataTypes.ENUM('priority', 'round-robin'),
    defaultValue: 'priority'
  },
  messagePrice: DataTypes.FLOAT
});

module.exports = Client;
