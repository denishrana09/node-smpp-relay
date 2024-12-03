const Client = require('../models/client');
const Vendor = require('../models/vendor');
const sequelize = require('../config/database');

async function seed() {
  await sequelize.sync({ force: true });

  await Client.bulkCreate([
    {
      id: 'client1',
      systemId: 'client1',
      password: 'password1',
      ip: '127.0.0.1',
      port: 2775,
      maxConnections: 5,
      messagePrice: 1.0
    },
    {
      id: 'client2',
      systemId: 'client2',
      password: 'password2',
      ip: '127.0.0.1',
      port: 2775,
      maxConnections: 5,
      messagePrice: 1.2
    },
    {
      id: 'client3',
      systemId: 'client3',
      password: 'password3',
      ip: '127.0.0.1',
      port: 2775,
      maxConnections: 5,
      messagePrice: 1.1
    }
  ]);

  await Vendor.bulkCreate([
    {
      id: 'vendor1',
      systemId: 'vendor1',
      password: 'password1',
      host: 'localhost',
      port: 2776,
      messagePrice: 0.5
    },
    {
      id: 'vendor2',
      systemId: 'vendor2',
      password: 'password2',
      host: 'localhost',
      port: 2777,
      messagePrice: 0.6
    },
    {
      id: 'vendor3',
      systemId: 'vendor3',
      password: 'password3',
      host: 'localhost',
      port: 2778,
      messagePrice: 0.7
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
  seed().catch(console.error);
}

// For programmatic use
module.exports = { seed };
