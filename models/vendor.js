const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// VendorHost model to store multiple hosts per vendor
const VendorHost = sequelize.define('VendorHost', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  vendorId: {
    type: DataTypes.STRING,
    references: {
      model: 'Vendors',
      key: 'id'
    }
  },
  host: DataTypes.STRING,
  port: DataTypes.INTEGER,
  priority: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

const Vendor = sequelize.define('Vendor', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  systemId: DataTypes.STRING,
  password: DataTypes.STRING,
  messagePrice: DataTypes.FLOAT
  // Remove host and port as they'll be in VendorHost
});

// Set up the relationship
Vendor.hasMany(VendorHost, {
  foreignKey: 'vendorId',
  as: 'hosts'
});
VendorHost.belongsTo(Vendor, {
  foreignKey: 'vendorId'
});

// Helper method to get active hosts
Vendor.prototype.getActiveHosts = async function () {
  return await VendorHost.findAll({
    where: {
      vendorId: this.id,
      isActive: true
    },
    order: [['priority', 'ASC']]
  });
};

module.exports = { Vendor, VendorHost };
