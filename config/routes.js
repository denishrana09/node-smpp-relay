module.exports = {
  clients: {
    client1: {
      vendors: [
        {
          id: 'vendor1',
          priority: 1
        },
        {
          id: 'vendor2',
          priority: 2
        }
      ],
      routingStrategy: 'priority'
    },
    client2: {
      vendors: [
        {
          id: 'vendor1',
          priority: 1
        },
        {
          id: 'vendor3',
          priority: 2
        },
        {
          id: 'vendor2',
          priority: 3
        }
      ],
      routingStrategy: 'priority'
    },
    client3: {
      vendors: [
        {
          id: 'vendor1',
          priority: 1
        },
        {
          id: 'vendor2',
          priority: 1
        },
        {
          id: 'vendor3',
          priority: 1
        }
      ],
      routingStrategy: 'round-robin'
    }
  }
};
