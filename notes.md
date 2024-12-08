# Notes

Let me explain both aspects:

1. How `selectHost` works:

```javascript
async selectHost(vendorId) {
    // Get all active sessions and sort by priority
    const activeSessions = Array.from(vendorSessions.entries())
      .filter(([_, info]) => info.status === 'active')
      .sort((a, b) => a[1].host.priority - b[1].host.priority);

    // Get round-robin state
    const rrState = this.roundRobinState.get(vendorId);

    if (!rrState) {
      // Priority mode: return highest priority host
      return activeSessions[0][0];
    }

    // Round-robin mode: rotate through active hosts
    const selectedIndex = rrState.currentHostIndex % rrState.activeHosts;
    rrState.currentHostIndex = (rrState.currentHostIndex + 1) % rrState.activeHosts;
```

2. Current Architecture vs Previous:

Previous Flow (in kafka-consumer):

```
Client -> SMPP Server -> Kafka -> Consumer -> selectVendor() -> SMPP Client
```

- `selectVendor` chose which vendor to use
- Each vendor had single connection
- Routing strategy (priority/round-robin) was applied at vendor level

New Flow:

```
Client -> SMPP Server -> Kafka -> Consumer -> SMPP Client -> selectHost()
```

- `selectVendor` still chooses the vendor
- But now each vendor has multiple hosts
- We need another level of routing for hosts within each vendor

We now have routing logic in two places:

1. `kafka-consumer.selectVendor`: Chooses which vendor to use
2. `smpp-client.selectHost`: Chooses which host to use within that vendor

This might seem redundant. We have two options to improve this:

1. Move all routing logic to kafka-consumer:

- Pros: Centralized routing logic
- Cons: Consumer needs to know about host-level details

2. Move all routing logic to smpp-client:

- Pros: Better separation of concerns
- Cons: Less control at the consumer level

What we have currently:

1. Vendor-level routing (in kafka-consumer):

- Handles client's routing strategy (priority/round-robin)
- Selects which vendor to use
- Maintains client-vendor relationship

2. Host-level routing (in smpp-client):

- Manages connections to multiple hosts per vendor
- Handles host failover
- Maintains session health

This separation provides:

- Clear responsibility boundaries
- Better error handling at each level
- Easier maintenance and testing

Benefits of redis-based caching approach:

1. Much faster message processing (no DB queries per message)
2. Reduced database load
3. Still maintains up-to-date vendor status (60s refresh)
4. Fallback to DB if Redis fails
5. Automatic cache expiration
