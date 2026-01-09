import { base44 } from "@/api/base44Client";

export const suppliersService = {
  async list(activeOnly = false, limit = 500) {
    const filter = activeOnly ? { is_active: true } : {};
    return await base44.entities.Suppliers.filter(filter, '-created_date', limit);
  },
  toMap(list) {
    const map = {};
    (list || []).forEach((s) => { map[s.id] = s; });
    return map;
  },
  async getMap(activeOnly = false, limit = 500) {
    const list = await this.list(activeOnly, limit);
    return this.toMap(list);
  },
  async create(data) {
    return await base44.entities.Suppliers.create(data);
  },
  async update(id, data) {
    return await base44.entities.Suppliers.update(id, data);
  },
  async remove(id) {
    return await base44.entities.Suppliers.delete(id);
  },
  async search(query, limit = 50) {
    const q = (query || '').toLowerCase();
    if (!q) return [];
    const list = await this.list(false, 1000);
    return list
      .filter((s) => [s.name, s.vat_id, s.aliases].some((v) => (v || '').toLowerCase().includes(q)))
      .slice(0, limit);
  },
};