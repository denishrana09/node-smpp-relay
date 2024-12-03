const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
  dialect: process.env.DB_DIALECT || 'sqlite',
  storage: process.env.DB_STORAGE || './db1.sqlite',
  logging: Boolean(process.env.DB_LOGGING) || false
});

module.exports = sequelize;
