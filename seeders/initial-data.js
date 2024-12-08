const { v4: uuidv4 } = require('uuid');
const { Vendor, VendorHost } = require('../models/vendor');
const Client = require('../models/client');
const sequelize = require('../config/database');

async function seedData() {
  await sequelize.sync({ force: true });
  // Create vendors
  const vendor1 = await Vendor.create({
    id: 'vendor1',
    systemId: 'vendor1',
    password: 'password1',
    messagePrice: 1.0
  });

  const vendor2 = await Vendor.create({
    id: 'vendor2',
    systemId: 'vendor2',
    password: 'password2',
    messagePrice: 1.5
  });

  // Create multiple hosts for each vendor
  await VendorHost.bulkCreate([
    {
      id: uuidv4(),
      vendorId: 'vendor1',
      host: 'localhost',
      port: 2776,
      priority: 1,
      isActive: true
    },
    {
      id: uuidv4(),
      vendorId: 'vendor1',
      host: 'localhost',
      port: 2777,
      priority: 2,
      isActive: true
    },
    {
      id: uuidv4(),
      vendorId: 'vendor2',
      host: 'localhost',
      port: 2778,
      priority: 1,
      isActive: true
    },
    {
      id: uuidv4(),
      vendorId: 'vendor2',
      host: 'localhost',
      port: 2770,
      priority: 2,
      isActive: true
    }
  ]);

  // Create clients with different routing strategies
  await Client.bulkCreate([
    {
      id: 'client1',
      systemId: 'client1',
      password: 'password1',
      maxConnections: 2,
      routingStrategy: 'priority'
    },
    {
      id: 'client2',
      systemId: 'client2',
      password: 'password2',
      maxConnections: 2,
      routingStrategy: 'round-robin'
    }
  ]);
  console.log('Seeding completed');

  // Only exit if running directly
  if (require.main === module) {
    process.exit(0);
  }
}

// For command line execution
if (require.main === module) {
  seedData().catch(console.error);
}

module.exports = seedData;
