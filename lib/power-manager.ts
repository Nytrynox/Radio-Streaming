// ============================================================================
// POWER MANAGER - Battery-efficient scanning with adaptive intervals
// ============================================================================

export class PowerManager {
  private isLowPowerMode = false;
  private lastActivityTime = Date.now();
  private idleThresholdMs = 60000;
  private reducedIntervalMultiplier = 3;
  private onModeChange: ((isLowPower: boolean) => void) | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  public start(onModeChange?: (isLowPower: boolean) => void) {
    this.onModeChange = onModeChange || null;
    this.checkInterval = setInterval(() => this.checkIdleState(), 10000);
  }

  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public recordActivity() {
    this.lastActivityTime = Date.now();
    if (this.isLowPowerMode) {
      this.isLowPowerMode = false;
      this.onModeChange?.(false);
    }
  }

  private checkIdleState() {
    if (Date.now() - this.lastActivityTime > this.idleThresholdMs && !this.isLowPowerMode) {
      this.isLowPowerMode = true;
      this.onModeChange?.(true);
    }
  }

  public getRecommendedInterval(baseInterval: number): number {
    return this.isLowPowerMode ? baseInterval * this.reducedIntervalMultiplier : baseInterval;
  }

  public isLowPower(): boolean { return this.isLowPowerMode; }
  public getIdleTime(): number { return Date.now() - this.lastActivityTime; }
  public forceNormalMode() { this.lastActivityTime = Date.now(); this.isLowPowerMode = false; }
}

export class AdaptiveScanner {
  private baseInterval: number;
  private currentInterval: number;
  private activityHistory: number[] = [];
  private powerManager: PowerManager;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scanCallback: (() => Promise<void>) | null = null;

  constructor(baseInterval = 2000, powerManager?: PowerManager) {
    this.baseInterval = baseInterval;
    this.currentInterval = baseInterval;
    this.powerManager = powerManager || new PowerManager();
  }

  public start(scanCallback: () => Promise<void>) {
    this.scanCallback = scanCallback;
    this.scheduleNextScan();
  }

  public stop() {
    if (this.timer) clearTimeout(this.timer);
    this.scanCallback = null;
  }

  private scheduleNextScan() {
    this.timer = setTimeout(async () => {
      if (this.scanCallback) await this.scanCallback().catch(() => {});
      this.updateInterval();
      this.scheduleNextScan();
    }, this.currentInterval);
  }

  public recordActivityLevel(level: number) {
    this.activityHistory.push(level);
    if (this.activityHistory.length > 20) this.activityHistory.shift();
    if (level > 0.5) this.powerManager.recordActivity();
  }

  private updateInterval() {
    const avg = this.activityHistory.length > 0
      ? this.activityHistory.reduce((a, b) => a + b, 0) / this.activityHistory.length : 0;
    let target = this.baseInterval;
    if (avg > 0.7) target *= 0.5;
    else if (avg < 0.2) target *= 2;
    target = this.powerManager.getRecommendedInterval(target);
    this.currentInterval = Math.max(500, Math.min(30000, this.currentInterval * 0.7 + target * 0.3));
  }

  public getCurrentInterval(): number { return this.currentInterval; }
  public getPowerManager(): PowerManager { return this.powerManager; }
}

export class BatteryMonitor {
  private battery: any = null;
  private onLowBattery: (() => void) | null = null;

  public async initialize(onLowBattery?: () => void) {
    this.onLowBattery = onLowBattery || null;
    if ('getBattery' in navigator) {
      try {
        this.battery = await (navigator as any).getBattery();
        this.battery.addEventListener('levelchange', () => this.checkBatteryLevel());
      } catch {}
    }
  }

  private checkBatteryLevel() {
    if (this.battery && !this.battery.charging && this.battery.level < 0.2) {
      this.onLowBattery?.();
    }
  }

  public getLevel(): number | null { return this.battery?.level ?? null; }
  public isCharging(): boolean | null { return this.battery?.charging ?? null; }
  public shouldReducePower(): boolean {
    return this.battery ? !this.battery.charging && this.battery.level < 0.2 : false;
  }
}
