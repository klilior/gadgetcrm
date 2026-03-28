import { base44 } from "@/api/base44Client";

// Module-level cache with TTL
let _cache = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isCacheValid() {
  return _cache && (Date.now() - _cacheTimestamp) < CACHE_TTL;
}

export const customersService = {
  async list() {
    // Return cached data if still valid
    if (isCacheValid()) {
      console.log('⏱️ customersService.list() — cache hit');
      return _cache;
    }

    console.log('🔄 customersService.list() — fetching from server...');
    const start = Date.now();
    let allClients = [];
    let skip = 0;
    const batchSize = 500;
    while (true) {
      const batch = await base44.entities.Client.list('-created_date', batchSize, skip);
      allClients = allClients.concat(batch);
      if (batch.length < batchSize) break;
      skip += batchSize;
    }

    // Store in cache
    _cache = allClients;
    _cacheTimestamp = Date.now();
    console.log(`✅ customersService.list() — ${allClients.length} clients loaded in ${Date.now() - start}ms`);
    return allClients;
  },

  invalidateCache() {
    _cache = null;
    _cacheTimestamp = 0;
  },

  toMap(list) {
    const map = {};
    (list || []).forEach((c) => { map[c.id] = c; });
    return map;
  },

  async getMap() {
    const list = await this.list();
    return this.toMap(list);
  },

  async getByIds(ids = []) {
    if (!ids || ids.length === 0) return [];
    // Try cache first
    if (isCacheValid()) {
      const idSet = new Set(ids);
      return _cache.filter(c => idSet.has(c.id));
    }
    return await base44.entities.Client.filter({ id: { $in: ids } });
  },

  async search({ query, phone, email }, limit = 50) {
    // Use server-side filter for phone/email when possible
    if (phone && !query && !email) {
      return await base44.entities.Client.filter({ phone: { $regex: phone } }, null, limit).catch(() => []);
    }
    if (email && !query && !phone) {
      return await base44.entities.Client.filter({ email: { $regex: email } }, null, limit).catch(() => []);
    }
    // Fallback to cached full list for complex searches
    const list = await this.list();
    const q = (query || '').toLowerCase();
    return list
      .filter((c) => {
        const byPhone = phone ? (c.phone || '').includes(phone) : true;
        const byEmail = email ? (c.email || '').toLowerCase().includes(email.toLowerCase()) : true;
        const byQuery = q ? [c.name, c.full_name, c.email, c.phone, c.id_number]
          .some((v) => (v || '').toLowerCase().includes(q)) : true;
        return byPhone && byEmail && byQuery;
      })
      .slice(0, limit);
  },

  async get(id) { return await base44.entities.Client.get(id); },
  async update(id, data) {
    this.invalidateCache();
    return await base44.entities.Client.update(id, data);
  },
  async create(data) {
    this.invalidateCache();
    return await base44.entities.Client.create(data);
  },
  async findByPhone(phone) {
    if (!phone) return null;
    const list = await base44.entities.Client.filter({ phone });
    return (list || [])[0] || null;
  },
};