// The atlas draws 256 px thumbnails, which is right at rest and wrong once
// the map is zoomed: a thumbnail blown past its own size is the blur the
// third field report describes. Past a zoom threshold the visible cells ask
// for the stored full scan instead.
//
// A map can hold hundreds of panels, so the full scans live in a BOUNDED
// pool: at most FULL_SCAN_LIMIT of them are resident, the least recently
// asked for is evicted, and its object URL is revoked at that moment. A cell
// whose scan was evicted hears about it and falls back to its thumbnail, so
// no image element is ever left pointing at a revoked URL.

// Below this zoom a 256 px thumbnail still covers the cell on a dense
// phone screen; above it the thumbnail starts being stretched.
export const FULL_SCAN_ZOOM = 1.5;

// The memory ceiling. Twelve scans of the size testers actually store
// (about 890 x 1065) is roughly 45 MB of decoded pixels in the worst case,
// and about 4 MB of compressed blobs. It does not grow with the map: a
// 280 panel world still holds twelve.
export const FULL_SCAN_LIMIT = 12;

export interface PoolHooks {
  load: (id: string) => Promise<Blob | undefined>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

export class FullScanPool {
  private urls = new Map<string, string>(); // insertion order is recency
  private inflight = new Map<string, Promise<string | undefined>>();
  private listeners = new Set<(id: string) => void>();

  constructor(
    private hooks: PoolHooks,
    private limit: number = FULL_SCAN_LIMIT,
  ) {}

  get size(): number {
    return this.urls.size;
  }

  peek(id: string): string | undefined {
    return this.urls.get(id);
  }

  // Told when a scan leaves the pool, so a cell can go back to its thumb.
  onEvicted(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async request(id: string): Promise<string | undefined> {
    const resident = this.urls.get(id);
    if (resident) {
      this.touch(id);
      return resident;
    }
    const flying = this.inflight.get(id);
    if (flying) return flying;

    const job = (async () => {
      const blob = await this.hooks.load(id);
      if (!blob) return undefined;
      // it may have arrived while we waited
      const already = this.urls.get(id);
      if (already) return already;
      const url = this.hooks.createUrl(blob);
      this.urls.set(id, url);
      this.evict();
      return url;
    })();
    this.inflight.set(id, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(id);
    }
  }

  clear(): void {
    for (const [id, url] of [...this.urls]) {
      this.hooks.revokeUrl(url);
      this.urls.delete(id);
      this.announce(id);
    }
  }

  private touch(id: string): void {
    const url = this.urls.get(id);
    if (url === undefined) return;
    this.urls.delete(id);
    this.urls.set(id, url);
  }

  private evict(): void {
    while (this.urls.size > this.limit) {
      const oldest = this.urls.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      const url = this.urls.get(oldest)!;
      this.urls.delete(oldest);
      this.hooks.revokeUrl(url);
      this.announce(oldest);
    }
  }

  private announce(id: string): void {
    for (const fn of this.listeners) fn(id);
  }
}
