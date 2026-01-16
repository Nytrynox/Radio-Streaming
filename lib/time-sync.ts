// ============================================================================
// TIME SYNC - NTP-like time synchronization for precise event logging
// ============================================================================

export class TimeSync {
  private offset = 0;
  private lastSync = 0;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  public async sync(): Promise<number> {
    try {
      const start = Date.now();
      const res = await fetch('https://worldtimeapi.org/api/ip', { cache: 'no-store' });
      const roundTrip = Date.now() - start;
      
      if (res.ok) {
        const data = await res.json();
        const serverTime = new Date(data.datetime).getTime();
        const localTime = Date.now();
        
        // Adjust for network latency (assume symmetric)
        this.offset = serverTime - localTime + (roundTrip / 2);
        this.lastSync = Date.now();
        
        console.log('Time synced. Offset:', this.offset, 'ms');
      }
    } catch (err) {
      console.warn('Time sync failed:', err);
    }
    return this.offset;
  }

  public startAutoSync(intervalMs = 3600000) { // 1 hour default
    this.sync();
    this.syncInterval = setInterval(() => this.sync(), intervalMs);
  }

  public stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  public now(): number {
    return Date.now() + this.offset;
  }

  public toISO(): string {
    return new Date(this.now()).toISOString();
  }

  public getOffset(): number {
    return this.offset;
  }

  public getLastSyncTime(): number {
    return this.lastSync;
  }

  public isSynced(): boolean {
    return this.lastSync > 0;
  }
}

export const globalTimeSync = new TimeSync();
