const Redis = require('ioredis');
const { Vendor } = require('../models/vendor');

class VendorAvailabilityCache {
  constructor() {
    // Feature flag for Redis usage
    this.USE_REDIS = false;
    
    // Initialize Redis only if needed
    if (this.USE_REDIS) {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      });
      console.log('Using Redis for vendor cache');
    } else {
      console.log('Using local memory for vendor cache');
    }

    // Key for storing vendor data (used only with Redis)
    this.VENDORS_CACHE_KEY = 'smpp:vendors:active';
    
    // Cache expiry time (1 hour)
    this.CACHE_EXPIRY = 60 * 60; // in seconds
    
    // Check interval (60 seconds)
    this.UPDATE_INTERVAL = 60 * 1000;
    
    // In-memory cache for comparison and local caching
    this.lastVendorsData = null;

    // Start periodic updates
    this.startPeriodicUpdate();
  }

  async startPeriodicUpdate() {
    // Initial update
    await this.updateVendorsCache();

    // Schedule periodic updates
    setInterval(async () => {
      await this.updateVendorsCache();
    }, this.UPDATE_INTERVAL);
  }

  hasDataChanged(newData, oldData) {
    if (!oldData) return true;
    if (newData.length !== oldData.length) return true;

    const oldMap = new Map(oldData.map(v => [v.id, v]));
    
    return newData.some(newVendor => {
      const oldVendor = oldMap.get(newVendor.id);
      if (!oldVendor) return true;
      
      return (
        newVendor.systemId !== oldVendor.systemId ||
        newVendor.activeHosts !== oldVendor.activeHosts ||
        newVendor.messagePrice !== oldVendor.messagePrice
      );
    });
  }

  async updateVendorsCache() {
    try {
      const vendors = await Vendor.findAll({
        include: ['hosts']
      });

      const vendorsData = vendors.map(vendor => ({
        id: vendor.id,
        systemId: vendor.systemId,
        activeHosts: vendor.hosts.filter(h => h.isActive).length,
        messagePrice: vendor.messagePrice
      }));

      // Check if data has changed
      if (this.hasDataChanged(vendorsData, this.lastVendorsData)) {
        // Always update in-memory cache
        this.lastVendorsData = vendorsData;

        // Update Redis only if enabled
        if (this.USE_REDIS) {
          await this.redis.set(
            this.VENDORS_CACHE_KEY,
            JSON.stringify(vendorsData),
            'EX',
            this.CACHE_EXPIRY
          );
          console.log('Vendors cache updated in Redis due to data changes');
        } else {
          console.log('Vendors cache updated in local memory due to data changes');
        }
      } else {
        // Refresh Redis expiry if enabled
        if (this.USE_REDIS) {
          await this.redis.expire(this.VENDORS_CACHE_KEY, this.CACHE_EXPIRY);
          console.log('Redis cache expiry refreshed');
        }
        console.log('Vendors cache unchanged');
      }
    } catch (error) {
      console.error('Failed to update vendors cache:', error);
    }
  }

  async getActiveVendors() {
    try {
      if (this.USE_REDIS) {
        // Try Redis first when enabled
        const cachedData = await this.redis.get(this.VENDORS_CACHE_KEY);
        if (cachedData) {
          return JSON.parse(cachedData);
        }
      }

      // Use in-memory cache if Redis is disabled or Redis cache miss
      if (this.lastVendorsData) {
        return this.lastVendorsData;
      }

      // Force update if no cache available
      await this.updateVendorsCache();
      return this.lastVendorsData;
      
    } catch (error) {
      console.error('Cache access failed:', error);
      
      // Always fallback to in-memory cache first
      if (this.lastVendorsData) {
        console.log('Using in-memory cache as fallback');
        return this.lastVendorsData;
      }

      // Last resort: query database
      console.log('Falling back to database query');
      const vendors = await Vendor.findAll({ include: ['hosts'] });
      return vendors.map(vendor => ({
        id: vendor.id,
        systemId: vendor.systemId,
        activeHosts: vendor.hosts.filter(h => h.isActive).length,
        messagePrice: vendor.messagePrice
      }));
    }
  }
}

module.exports = new VendorAvailabilityCache();
