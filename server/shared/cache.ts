type CacheEntry = {
  value: unknown;
  expiresAt: number;
  cachedAt: string;
};

export class TtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  get size() {
    this.prune();
    return this.entries.size;
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, value: unknown, ttlMs: number, cachedAt = new Date().toISOString()) {
    this.entries.set(key, {
      value,
      cachedAt,
      expiresAt: Date.now() + ttlMs
    });
  }

  private prune() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
