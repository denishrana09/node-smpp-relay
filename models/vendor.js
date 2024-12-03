const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vendor = sequelize.define('Vendor', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  systemId: DataTypes.STRING,
  password: DataTypes.STRING,
  host: DataTypes.STRING,
  port: DataTypes.INTEGER,
  messagePrice: DataTypes.FLOAT
});

module.exports = Vendor;
