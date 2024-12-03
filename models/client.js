const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  systemId: {
    type: DataTypes.STRING,
    unique: true,
  },
  password: DataTypes.STRING,
  ip: DataTypes.STRING,
  port: DataTypes.INTEGER,
  maxConnections: DataTypes.INTEGER,
  messagePrice: DataTypes.FLOAT,
});

module.exports = Client;
