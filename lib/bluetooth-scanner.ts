// ============================================================================
// BLUETOOTH PRESENCE DETECTION
// Uses macOS blueutil CLI tool for Bluetooth scanning
// ============================================================================

import type { BluetoothDevice, BluetoothScanResult } from './types';

export class BluetoothScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private deviceHistory: Map<string, BluetoothDevice> = new Map();

  public start(onScan: (result: BluetoothScanResult) => void, intervalMs = 5000) {
    if (this.isRunning) return;
    this.isRunning = true;

    const tick = async () => {
      try {
        const res = await fetch('/api/bluetooth/scan', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Bluetooth scan failed (${res.status})`);
        const json = (await res.json()) as BluetoothScanResult;
        
        // Track device history
        json.devices.forEach(device => {
          const existing = this.deviceHistory.get(device.address);
          if (existing) {
            device.lastSeen = Date.now();
          }
          this.deviceHistory.set(device.address, device);
        });
        
        onScan(json);
      } catch (err) {
        console.warn('Bluetooth scan error:', err);
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

  public getDeviceHistory(): BluetoothDevice[] {
    return Array.from(this.deviceHistory.values());
  }

  public clearHistory() {
    this.deviceHistory.clear();
  }
}

// ============================================================================
// BLUETOOTH ANALYZER
// ============================================================================

export class BluetoothAnalyzer {
  private prevDevicesByAddress: Map<string, BluetoothDevice> = new Map();
  private readonly proximityThresholdDb = 5;

  public analyzeScan(scan: BluetoothScanResult): {
    newDevices: BluetoothDevice[];
    lostDevices: BluetoothDevice[];
    proximityChanges: { device: BluetoothDevice; change: number }[];
    nearbyCount: number;
  } {
    const currentAddresses = new Set(scan.devices.map(d => d.address));
    const prevAddresses = new Set(this.prevDevicesByAddress.keys());

    // Find new devices
    const newDevices = scan.devices.filter(d => !prevAddresses.has(d.address));

    // Find lost devices
    const lostDevices: BluetoothDevice[] = [];
    for (const addr of prevAddresses) {
      if (!currentAddresses.has(addr)) {
        const device = this.prevDevicesByAddress.get(addr);
        if (device) lostDevices.push(device);
      }
    }

    // Find proximity changes
    const proximityChanges: { device: BluetoothDevice; change: number }[] = [];
    for (const device of scan.devices) {
      const prev = this.prevDevicesByAddress.get(device.address);
      if (prev) {
        const change = device.rssi - prev.rssi;
        if (Math.abs(change) >= this.proximityThresholdDb) {
          proximityChanges.push({ device, change });
        }
      }
    }

    // Count nearby devices (strong signal)
    const nearbyCount = scan.devices.filter(d => d.rssi > -60).length;

    // Update history
    this.prevDevicesByAddress.clear();
    scan.devices.forEach(d => this.prevDevicesByAddress.set(d.address, d));

    return { newDevices, lostDevices, proximityChanges, nearbyCount };
  }

  public estimateDeviceType(name: string): BluetoothDevice['deviceType'] {
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('iphone') || lowerName.includes('android') || lowerName.includes('phone') || lowerName.includes('galaxy')) {
      return 'phone';
    }
    if (lowerName.includes('macbook') || lowerName.includes('laptop') || lowerName.includes('pro') || lowerName.includes('air')) {
      return 'laptop';
    }
    if (lowerName.includes('airpod') || lowerName.includes('headphone') || lowerName.includes('buds') || lowerName.includes('sony wh')) {
      return 'headphones';
    }
    if (lowerName.includes('watch') || lowerName.includes('band') || lowerName.includes('fitbit')) {
      return 'watch';
    }
    if (lowerName.includes('speaker') || lowerName.includes('homepod') || lowerName.includes('echo') || lowerName.includes('sonos')) {
      return 'speaker';
    }
    
    return 'unknown';
  }

  public reset() {
    this.prevDevicesByAddress.clear();
  }
}

// ============================================================================
// PRESENCE TRACKER
// Combines Bluetooth data over time to track device presence
// ============================================================================

export class PresenceTracker {
  private devices: Map<string, {
    device: BluetoothDevice;
    firstSeen: number;
    lastSeen: number;
    rssiHistory: number[];
    isPresent: boolean;
  }> = new Map();

  private readonly absenceThresholdMs = 30000; // 30 seconds

  public update(scan: BluetoothScanResult) {
    const now = Date.now();

    // Update existing and add new
    for (const device of scan.devices) {
      const existing = this.devices.get(device.address);
      if (existing) {
        existing.lastSeen = now;
        existing.rssiHistory.push(device.rssi);
        if (existing.rssiHistory.length > 20) existing.rssiHistory.shift();
        existing.isPresent = true;
        existing.device = device;
      } else {
        this.devices.set(device.address, {
          device,
          firstSeen: now,
          lastSeen: now,
          rssiHistory: [device.rssi],
          isPresent: true,
        });
      }
    }

    // Mark absent devices
    for (const [addr, data] of this.devices) {
      if (now - data.lastSeen > this.absenceThresholdMs) {
        data.isPresent = false;
      }
    }
  }

  public getPresentDevices(): BluetoothDevice[] {
    return Array.from(this.devices.values())
      .filter(d => d.isPresent)
      .map(d => d.device);
  }

  public getAllTrackedDevices(): BluetoothDevice[] {
    return Array.from(this.devices.values()).map(d => d.device);
  }

  public getDeviceStats(address: string): {
    dwellTime: number;
    avgRssi: number;
    isPresent: boolean;
  } | null {
    const data = this.devices.get(address);
    if (!data) return null;

    const avgRssi = data.rssiHistory.reduce((a, b) => a + b, 0) / data.rssiHistory.length;
    const dwellTime = data.lastSeen - data.firstSeen;

    return { dwellTime, avgRssi, isPresent: data.isPresent };
  }

  public clear() {
    this.devices.clear();
  }
}
