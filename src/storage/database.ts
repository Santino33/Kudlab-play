export const STORES = ['executions', 'trials', 'incidents', 'outbox', 'credentials', 'leases', 'receipts'] as const;
export type Store = typeof STORES[number];
export interface Row { key: string }
export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
export class Database {
  private constructor(readonly raw: IDBDatabase) {
    raw.onversionchange = () => raw.close();
  }
  static open(name = 'kudlab-play-runtime', version = 2): Promise<Database> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(new Database(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('STORAGE_UPGRADE_BLOCKED'));
    });
  }
  async transaction<T>(stores: Store[], action: (tx: IDBTransaction) => Promise<T>, mode: IDBTransactionMode = 'readwrite'): Promise<T> {
    const tx = this.raw.transaction(stores, mode, { durability: 'strict' });
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('STORAGE_FAILURE'));
    });
    try {
      const result = await action(tx);
      await done;
      return result;
    } catch (e) {
      try { tx.abort(); } catch { /* already completed */ }
      await done.catch(() => undefined);
      throw e;
    }
  }
  get<T>(store: Store, key: string): Promise<T | undefined> {
    return this.transaction([store], tx => request(tx.objectStore(store).get(key)), 'readonly');
  }
  all<T>(store: Store): Promise<T[]> {
    return this.transaction([store], tx => request(tx.objectStore(store).getAll()), 'readonly');
  }
  async put<T extends Row>(store: Store, row: T): Promise<void> {
    await this.transaction([store], async tx => { await request(tx.objectStore(store).put(row)); });
  }
  async remove(store: Store, key: string): Promise<void> {
    await this.transaction([store], async tx => { await request(tx.objectStore(store).delete(key)); });
  }
  async lease(key: string, owner: string, now = Date.now(), ttl = 10000): Promise<boolean> {
    return this.transaction(['leases'], async tx => {
      const s = tx.objectStore('leases');
      const current = await request<{ owner: string; until: number } | undefined>(s.get(key));
      if (current && current.owner !== owner && current.until > now) return false;
      await request(s.put({ key, owner, until: now + ttl }));
      return true;
    });
  }
  async release(key: string, owner: string): Promise<void> {
    await this.transaction(['leases'], async tx => {
      const s = tx.objectStore('leases');
      const lease = await request<{ owner: string } | undefined>(s.get(key));
      if (lease?.owner === owner) await request(s.delete(key));
    });
  }
  async preflight(): Promise<{ persistent: boolean }> {
    const key = `probe:${crypto.randomUUID()}`;
    await this.put('leases', { key, value: key });
    const row = await this.get<{ value: string }>('leases', key);
    if (row?.value !== key) throw new Error('STORAGE_UNAVAILABLE');
    await this.remove('leases', key);
    const estimate = await navigator.storage?.estimate();
    if (estimate?.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < 4 * 1048576) throw new Error('STORAGE_QUOTA');
    let persistent = false;
    try { persistent = (await navigator.storage?.persisted()) || (await navigator.storage?.persist()) || false; } catch { /* request can be denied */ }
    return { persistent };
  }
}
