type CacheRecord = {
  expiresAt: number;
  cachedAt: string;
  value: unknown;
};

export class TtlCache {
  private records = new Map<string, CacheRecord>();

  get(key: string) {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.records.delete(key);
      return null;
    }
    return record;
  }

  set(key: string, value: unknown, ttlMs: number, cachedAt = new Date().toISOString()) {
    this.records.set(key, {
      value,
      cachedAt,
      expiresAt: Date.now() + ttlMs
    });
  }

  get size() {
    return this.records.size;
  }
}
