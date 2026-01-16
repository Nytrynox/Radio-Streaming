export type RealWifiNetwork = {
  ssid: string;
  bssid: string;
  rssi: number; // dBm
  channel?: string;
  noise?: number; // dBm
  snr?: number; // dB
  security?: string;
};

export type RealScanResult = {
  timestamp: number;
  interface?: string;
  currentNetwork: RealWifiNetwork | null;
  nearbyNetworks: RealWifiNetwork[];
};

export type DetectedObject = {
  id: string;
  type: 'signal_change';
  confidence: number; // 0..1
  sourceNetwork: string;
  distance: number;
  deltaDb?: number;
  rssi?: number;
};

export class RealWifiScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  public start(onScan: (result: RealScanResult) => void, intervalMs = 2000) {
    if (this.isRunning) return;
    this.isRunning = true;

    const tick = async () => {
      try {
        const res = await fetch('/api/wifi/scan', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`WiFi scan failed (${res.status})`);
        }
        const json = (await res.json()) as RealScanResult;
        onScan(json);
      } catch (err) {
        console.warn(err);
      }
    };

    void tick();
    this.timer = setInterval(() => void tick(), intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

type CalibrationState = {
  isCalibrated: boolean;
  progress: number;
  samples: number;
};

export class RealWifiAnalyzer {
  private readonly calibrationTargetSamples = 10; // More samples before alerting
  private readonly movementThresholdDb = 6.0; // MUCH higher threshold (was 3.5)
  private readonly minCorrelatedAPs = 2; // Require multiple APs to show change
  private readonly maxPlausibleDeltaDb = 15;
  private readonly placeholderRssiDbm = -85;
  private readonly history: number[] = [];
  private prevRssiByKey: Map<string, number> = new Map();
  private recentDeltas: Map<string, number[]> = new Map(); // Track delta history

  private calibration: CalibrationState = {
    isCalibrated: false,
    progress: 0,
    samples: 0,
  };

  public reset() {
    this.history.length = 0;
    this.prevRssiByKey.clear();
    this.recentDeltas.clear();
    this.calibration = {
      isCalibrated: false,
      progress: 0,
      samples: 0,
    };
  }

  public getCalibrationStatus() {
    return this.calibration;
  }

  public processScan(scan: RealScanResult): {
    objects: DetectedObject[];
    signalQuality: number;
    movementDetected: boolean;
    avgRSSI: number;
    isCalibrated: boolean;
    calibrationProgress: number;
  } {
    const networks = scan.currentNetwork
      ? [scan.currentNetwork, ...scan.nearbyNetworks]
      : scan.nearbyNetworks;

    const rssiValues = networks.map(n => n.rssi).filter(v => Number.isFinite(v));
    const avgRSSI = rssiValues.length ? rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length : -90;

    if (scan.currentNetwork && Number.isFinite(scan.currentNetwork.rssi)) {
      this.history.push(scan.currentNetwork.rssi);
      if (this.history.length > 60) this.history.shift();
    }

    // Calibration - don't report anything during calibration
    if (!this.calibration.isCalibrated) {
      this.calibration.samples += 1;
      this.calibration.progress = Math.min(100, (this.calibration.samples / this.calibrationTargetSamples) * 100);
      if (this.calibration.samples >= this.calibrationTargetSamples) {
        this.calibration.isCalibrated = true;
        this.calibration.progress = 100;
      }
      
      // Just build baseline during calibration, no detections
      for (const n of networks) {
        const key = n.bssid || n.ssid;
        if (key && Number.isFinite(n.rssi)) {
          this.prevRssiByKey.set(key, n.rssi);
        }
      }
      
      return {
        objects: [],
        signalQuality: 0,
        movementDetected: false,
        avgRSSI,
        isCalibrated: false,
        calibrationProgress: this.calibration.progress
      };
    }

    // Post-calibration: Look for real significant changes
    const candidates: { key: string; delta: number; network: RealWifiNetwork }[] = [];
    
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const isPlaceholderRssi = (rssi: number) => Number.isFinite(rssi) && rssi <= this.placeholderRssiDbm;
    const rssiToRadius = (rssi: number) => {
      const c = clamp(rssi, -90, -30);
      const t = 1 - (c + 90) / 60;
      return 1 + t * 9;
    };

    for (const n of networks) {
      const key = n.bssid || n.ssid;
      if (!key) continue;
      
      const prev = this.prevRssiByKey.get(key);
      
      if (prev !== undefined) {
        if (!Number.isFinite(n.rssi) || !Number.isFinite(prev)) {
          this.prevRssiByKey.set(key, n.rssi);
          continue;
        }
        if (isPlaceholderRssi(n.rssi) || isPlaceholderRssi(prev)) {
          this.prevRssiByKey.set(key, n.rssi);
          continue;
        }
        // Require good SNR
        if (typeof n.snr === 'number' && Number.isFinite(n.snr) && n.snr < 10) {
          this.prevRssiByKey.set(key, n.rssi);
          continue;
        }

        const delta = n.rssi - prev;
        const absDelta = Math.abs(delta);

        if (absDelta > this.maxPlausibleDeltaDb) {
          this.prevRssiByKey.set(key, n.rssi);
          continue;
        }

        // Track delta history for this AP
        const deltaHistory = this.recentDeltas.get(key) || [];
        deltaHistory.push(absDelta);
        if (deltaHistory.length > 5) deltaHistory.shift();
        this.recentDeltas.set(key, deltaHistory);

        // Only consider if this AP shows CONSISTENT significant change
        const avgDelta = deltaHistory.reduce((a, b) => a + b, 0) / deltaHistory.length;
        
        if (avgDelta >= this.movementThresholdDb) {
          candidates.push({ key, delta, network: n });
        }
      }
      
      this.prevRssiByKey.set(key, n.rssi);
    }

    // CRITICAL: Only report if multiple APs show correlated changes
    // This filters out single-AP noise
    const objects: DetectedObject[] = [];
    
    if (candidates.length >= this.minCorrelatedAPs) {
      // Check if changes are in same direction (correlated)
      const positiveChanges = candidates.filter(c => c.delta > 0).length;
      const negativeChanges = candidates.filter(c => c.delta < 0).length;
      const dominant = Math.max(positiveChanges, negativeChanges);
      
      // Require at least half of candidates to agree on direction
      if (dominant >= candidates.length * 0.5) {
        // These are likely real detections
        for (const c of candidates.slice(0, 3)) { // Max 3 objects
          const confidence = Math.min(1, Math.abs(c.delta) / 12);
          objects.push({
            id: `wifi-signal-${c.key}-${scan.timestamp}`,
            type: 'signal_change',
            confidence,
            sourceNetwork: c.network.ssid || c.network.bssid || 'wifi',
            distance: rssiToRadius(c.network.rssi),
            deltaDb: c.delta,
            rssi: c.network.rssi,
          });
        }
      }
    }

    const movementDetected = objects.length > 0;

    const signalQuality = (() => {
      const rssi = scan.currentNetwork?.rssi;
      if (rssi === undefined || !Number.isFinite(rssi)) return 0;
      const clamped = Math.max(-90, Math.min(-30, rssi));
      return ((clamped + 90) / 60) * 100;
    })();

    return { 
      objects, 
      signalQuality, 
      movementDetected, 
      avgRSSI,
      isCalibrated: this.calibration.isCalibrated,
      calibrationProgress: this.calibration.progress
    };
  }
}
