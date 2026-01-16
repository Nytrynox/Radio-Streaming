// ============================================================================
// NETWORK TRAFFIC ANALYSIS
// Monitors ARP table and network activity for device presence detection
// ============================================================================

import type { NetworkDevice, NetworkAnalysis } from './types';

export class NetworkAnalyzer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private deviceHistory: Map<string, NetworkDevice & { 
    seenCount: number; 
    rssiHistory: number[];
    lastActivityTime: number;
  }> = new Map();
  private recentActivity: { device: string; action: string; time: number }[] = [];

  public start(onAnalysis: (analysis: NetworkAnalysis) => void, intervalMs = 10000) {
    if (this.isRunning) return;
    this.isRunning = true;

    const tick = async () => {
      try {
        const res = await fetch('/api/network/analyze', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Network analysis failed (${res.status})`);
        const json = (await res.json()) as NetworkAnalysis;
        
        // Process devices
        this.processDevices(json.devices);
        
        // Add any new activity
        json.recentActivity?.forEach(activity => {
          if (!this.recentActivity.find(a => 
            a.device === activity.device && 
            a.action === activity.action && 
            Math.abs(a.time - activity.time) < 1000
          )) {
            this.recentActivity.push(activity);
            if (this.recentActivity.length > 100) this.recentActivity.shift();
          }
        });

        onAnalysis({
          ...json,
          recentActivity: this.recentActivity.slice(-20),
        });
      } catch (err) {
        console.warn('Network analysis error:', err);
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

  private processDevices(devices: NetworkDevice[]) {
    const now = Date.now();
    const currentMacs = new Set(devices.map(d => d.mac));

    // Update existing and track new
    for (const device of devices) {
      const existing = this.deviceHistory.get(device.mac);
      if (existing) {
        existing.lastActive = now;
        existing.seenCount++;
        existing.isOnline = true;
        existing.hostname = device.hostname || existing.hostname;
        
        if (device.activityScore > 0.5 && existing.activityScore <= 0.5) {
          this.recentActivity.push({
            device: device.hostname || device.mac,
            action: 'became_active',
            time: now,
          });
        }
        existing.activityScore = device.activityScore;
        existing.lastActivityTime = now;
      } else {
        this.deviceHistory.set(device.mac, {
          ...device,
          seenCount: 1,
          rssiHistory: [],
          lastActivityTime: now,
        });
        this.recentActivity.push({
          device: device.hostname || device.mac,
          action: 'joined',
          time: now,
        });
      }
    }

    // Mark offline devices
    for (const [mac, data] of this.deviceHistory) {
      if (!currentMacs.has(mac) && data.isOnline) {
        data.isOnline = false;
        this.recentActivity.push({
          device: data.hostname || mac,
          action: 'left',
          time: now,
        });
      }
    }
  }

  public getOnlineDevices(): NetworkDevice[] {
    return Array.from(this.deviceHistory.values())
      .filter(d => d.isOnline)
      .map(({ seenCount, rssiHistory, lastActivityTime, ...device }) => device);
  }

  public getAllDevices(): NetworkDevice[] {
    return Array.from(this.deviceHistory.values())
      .map(({ seenCount, rssiHistory, lastActivityTime, ...device }) => device);
  }

  public getDeviceStats(mac: string): { 
    seenCount: number; 
    uptime: number; 
    activityScore: number 
  } | null {
    const data = this.deviceHistory.get(mac);
    if (!data) return null;

    return {
      seenCount: data.seenCount,
      uptime: data.isOnline ? Date.now() - data.lastActive : 0,
      activityScore: data.activityScore,
    };
  }

  public getRecentActivity(): { device: string; action: string; time: number }[] {
    return this.recentActivity.slice(-20);
  }

  public clear() {
    this.deviceHistory.clear();
    this.recentActivity = [];
  }
}

// ============================================================================
// PRESENCE INFERENCER
// Uses network activity to infer human presence
// ============================================================================

export class NetworkPresenceInferencer {
  private knownDevices: Map<string, {
    type: 'phone' | 'laptop' | 'tablet' | 'iot' | 'unknown';
    owner?: string;
    isPersonal: boolean;
  }> = new Map();

  public registerDevice(mac: string, info: {
    type: 'phone' | 'laptop' | 'tablet' | 'iot' | 'unknown';
    owner?: string;
    isPersonal: boolean;
  }) {
    this.knownDevices.set(mac, info);
  }

  public inferPresence(devices: NetworkDevice[]): {
    personsPresent: number;
    knownPersons: string[];
    unknownDevices: number;
    confidence: number;
  } {
    const activeDevices = devices.filter(d => d.isOnline && d.activityScore > 0.3);
    const personalDevices = activeDevices.filter(d => {
      const known = this.knownDevices.get(d.mac);
      return known?.isPersonal;
    });

    const knownPersons = [...new Set(
      personalDevices
        .map(d => this.knownDevices.get(d.mac)?.owner)
        .filter(Boolean) as string[]
    )];

    const unknownDevices = activeDevices.filter(d => !this.knownDevices.has(d.mac)).length;

    // Estimate persons based on device patterns
    const phonesAndLaptop = activeDevices.filter(d => {
      const known = this.knownDevices.get(d.mac);
      return known?.type === 'phone' || known?.type === 'laptop';
    });

    // Rough estimate: 1 person per 1-2 personal devices
    const personsPresent = Math.max(
      knownPersons.length,
      Math.ceil(phonesAndLaptop.length / 2)
    );

    // Confidence based on how many devices we know about
    const knownRatio = personalDevices.length / (activeDevices.length || 1);
    const confidence = Math.min(1, knownRatio + 0.3);

    return { personsPresent, knownPersons, unknownDevices, confidence };
  }

  public guessDeviceType(hostname?: string, mac?: string): 'phone' | 'laptop' | 'tablet' | 'iot' | 'unknown' {
    const name = (hostname || '').toLowerCase();
    
    if (name.includes('iphone') || name.includes('android') || name.includes('phone') || name.includes('galaxy')) {
      return 'phone';
    }
    if (name.includes('macbook') || name.includes('laptop') || name.includes('-pc') || name.includes('desktop')) {
      return 'laptop';
    }
    if (name.includes('ipad') || name.includes('tablet') || name.includes('fire')) {
      return 'tablet';
    }
    if (name.includes('alexa') || name.includes('echo') || name.includes('nest') || 
        name.includes('hue') || name.includes('ring') || name.includes('camera')) {
      return 'iot';
    }

    // Check MAC prefix for manufacturer hints
    if (mac) {
      const prefix = mac.toLowerCase().slice(0, 8);
      // Apple devices
      if (['00:1c:b3', '00:03:93', 'a4:5e:60', 'ac:bc:32'].some(p => prefix.startsWith(p.replace(/:/g, '')))) {
        return 'phone'; // Could be phone or laptop
      }
    }

    return 'unknown';
  }
}
