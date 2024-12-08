module.exports = {
  clients: {
    client1: {
      id: 'client1',
      routingStrategy: 'priority',
      vendors: [
        {
          id: 'vendor1',
          priority: 1
        },
        {
          id: 'vendor2',
          priority: 2
        }
      ]
    },
    client2: {
      id: 'client2',
      routingStrategy: 'round-robin',
      vendors: [
        {
          id: 'vendor1'
        },
        {
          id: 'vendor2'
        }
      ]
    }
  }
};
