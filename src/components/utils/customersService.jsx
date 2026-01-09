import { base44 } from "@/api/base44Client";

export const customersService = {
  async list(limit = 500) {
    return await base44.entities.Client.filter({}, '-created_date', limit);
  },
  toMap(list) {
    const map = {};
    (list || []).forEach((c) => { map[c.id] = c; });
    return map;
  },
  async getMap(limit = 500) {
    const list = await this.list(limit);
    return this.toMap(list);
  },
  async getByIds(ids = []) {
    if (!ids || ids.length === 0) return [];
    return await base44.entities.Client.filter({ id: { $in: ids } });
  },
  async search({ query, phone, email }, limit = 50) {
    const list = await this.list(1000);
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
  async update(id, data) { return await base44.entities.Client.update(id, data); },
  async create(data) { return await base44.entities.Client.create(data); },
  async findByPhone(phone) {
    if (!phone) return null;
    const list = await base44.entities.Client.filter({ phone });
    return (list || [])[0] || null;
  },
};