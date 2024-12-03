const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './db1.sqlite',
  logging: false
});

module.exports = sequelize; 