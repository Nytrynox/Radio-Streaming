// ============================================================================
// MULTI-NETWORK TRIANGULATION
// Uses RSSI from multiple access points to estimate position
// ============================================================================

import type { Position2D, TriangulationResult } from './types';
import type { RealWifiNetwork } from './real-wifi-scanner';

interface APLocation {
  ssid: string;
  bssid: string;
  x: number; // 0-1 normalized position
  y: number; // 0-1 normalized position
  txPower?: number; // Reference RSSI at 1 meter
}

export class Triangulator {
  private apLocations: Map<string, APLocation> = new Map();
  private readonly heatmapResolution = 20; // 20x20 grid
  private readonly pathLossExponent = 2.5; // Environment-dependent (2-4)
  private readonly refDistance = 1; // meters
  private readonly refTxPower = -40; // dBm at 1 meter

  public registerAP(ap: APLocation) {
    this.apLocations.set(ap.bssid || ap.ssid, ap);
  }

  public autoRegisterAPs(networks: RealWifiNetwork[]) {
    // Auto-place APs in a reasonable pattern if not manually registered
    const unregistered = networks.filter(n => !this.apLocations.has(n.bssid || n.ssid));
    
    unregistered.forEach((network, index) => {
      const angle = (index / unregistered.length) * Math.PI * 2;
      const radius = 0.3 + Math.random() * 0.2;
      
      this.apLocations.set(network.bssid || network.ssid, {
        ssid: network.ssid,
        bssid: network.bssid,
        x: 0.5 + Math.cos(angle) * radius,
        y: 0.5 + Math.sin(angle) * radius,
        txPower: this.refTxPower,
      });
    });
  }

  public estimate(networks: RealWifiNetwork[]): TriangulationResult {
    if (networks.length === 0) {
      return this.emptyResult();
    }

    // Filter to only networks with known locations
    const knownNetworks = networks.filter(n => 
      this.apLocations.has(n.bssid) || this.apLocations.has(n.ssid)
    );

    if (knownNetworks.length < 2) {
      // Can't triangulate with less than 2 APs
      return this.fallbackEstimate(networks);
    }

    // Calculate distances from RSSI
    const measurements: { x: number; y: number; distance: number; weight: number }[] = [];
    
    for (const network of knownNetworks) {
      const ap = this.apLocations.get(network.bssid) || this.apLocations.get(network.ssid);
      if (!ap) continue;

      const txPower = ap.txPower || this.refTxPower;
      const distance = this.rssiToDistance(network.rssi, txPower);
      const weight = Math.max(0.1, 1 - (distance / 20)); // Higher weight for closer APs

      measurements.push({
        x: ap.x,
        y: ap.y,
        distance,
        weight,
      });
    }

    // Generate heatmap of likely positions
    const heatmap: number[][] = [];
    let maxProbability = 0;
    let bestPosition: Position2D = { x: 0.5, y: 0.5 };

    for (let gy = 0; gy < this.heatmapResolution; gy++) {
      heatmap[gy] = [];
      for (let gx = 0; gx < this.heatmapResolution; gx++) {
        const px = gx / (this.heatmapResolution - 1);
        const py = gy / (this.heatmapResolution - 1);

        // Calculate probability based on distance matching
        let totalScore = 0;
        let totalWeight = 0;

        for (const m of measurements) {
          const actualDistance = Math.sqrt((px - m.x) ** 2 + (py - m.y) ** 2) * 10; // Scale to meters
          const difference = Math.abs(actualDistance - m.distance);
          const score = Math.exp(-difference / 3) * m.weight; // Gaussian-like falloff
          
          totalScore += score;
          totalWeight += m.weight;
        }

        const probability = totalWeight > 0 ? totalScore / totalWeight : 0;
        heatmap[gy][gx] = probability;

        if (probability > maxProbability) {
          maxProbability = probability;
          bestPosition = { x: px, y: py };
        }
      }
    }

    // Normalize heatmap
    if (maxProbability > 0) {
      for (let gy = 0; gy < this.heatmapResolution; gy++) {
        for (let gx = 0; gx < this.heatmapResolution; gx++) {
          heatmap[gy][gx] /= maxProbability;
        }
      }
    }

    return {
      timestamp: Date.now(),
      position: bestPosition,
      confidence: maxProbability,
      heatmap,
      usedNetworks: knownNetworks.map(n => n.ssid || n.bssid),
    };
  }

  private rssiToDistance(rssi: number, txPower: number): number {
    // Log-distance path loss model
    if (rssi >= txPower) return this.refDistance;
    
    const ratio = (txPower - rssi) / (10 * this.pathLossExponent);
    return this.refDistance * Math.pow(10, ratio);
  }

  private fallbackEstimate(networks: RealWifiNetwork[]): TriangulationResult {
    // Simple estimate based on strongest signal
    const strongest = networks.reduce((best, n) => 
      n.rssi > best.rssi ? n : best, networks[0]);

    const ap = this.apLocations.get(strongest?.bssid) || this.apLocations.get(strongest?.ssid);
    const position = ap ? { x: ap.x, y: ap.y } : { x: 0.5, y: 0.5 };

    return {
      timestamp: Date.now(),
      position,
      confidence: 0.3,
      heatmap: this.generateSimpleHeatmap(position),
      usedNetworks: strongest ? [strongest.ssid || strongest.bssid] : [],
    };
  }

  private generateSimpleHeatmap(center: Position2D): number[][] {
    const heatmap: number[][] = [];
    
    for (let gy = 0; gy < this.heatmapResolution; gy++) {
      heatmap[gy] = [];
      for (let gx = 0; gx < this.heatmapResolution; gx++) {
        const px = gx / (this.heatmapResolution - 1);
        const py = gy / (this.heatmapResolution - 1);
        const distance = Math.sqrt((px - center.x) ** 2 + (py - center.y) ** 2);
        heatmap[gy][gx] = Math.exp(-distance * 5);
      }
    }
    
    return heatmap;
  }

  private emptyResult(): TriangulationResult {
    return {
      timestamp: Date.now(),
      position: { x: 0.5, y: 0.5 },
      confidence: 0,
      heatmap: Array(this.heatmapResolution).fill(null).map(() => 
        Array(this.heatmapResolution).fill(0)
      ),
      usedNetworks: [],
    };
  }

  public getAPLocations(): APLocation[] {
    return Array.from(this.apLocations.values());
  }

  public clearAPLocations() {
    this.apLocations.clear();
  }

  public setPathLossExponent(value: number) {
    // Can be calibrated based on environment
    // 2 = free space, 3 = office, 4 = dense building
    (this as any).pathLossExponent = Math.max(2, Math.min(5, value));
  }
}

// ============================================================================
// MOVEMENT TRACKER
// Tracks position changes over time
// ============================================================================

export class MovementTracker {
  private history: { position: Position2D; timestamp: number }[] = [];
  private readonly maxHistory = 100;

  public addPosition(position: Position2D) {
    this.history.push({ position, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  public getVelocity(): { vx: number; vy: number; speed: number } {
    if (this.history.length < 2) {
      return { vx: 0, vy: 0, speed: 0 };
    }

    const recent = this.history.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];
    
    const dt = (last.timestamp - first.timestamp) / 1000; // seconds
    if (dt <= 0) return { vx: 0, vy: 0, speed: 0 };

    const vx = (last.position.x - first.position.x) / dt;
    const vy = (last.position.y - first.position.y) / dt;
    const speed = Math.sqrt(vx * vx + vy * vy);

    return { vx, vy, speed };
  }

  public getDirection(): 'approaching' | 'departing' | 'lateral' | 'stationary' {
    const { vx, vy, speed } = this.getVelocity();
    
    if (speed < 0.01) return 'stationary';

    // Assume center (0.5, 0.5) is the device
    const lastPos = this.history[this.history.length - 1]?.position;
    if (!lastPos) return 'stationary';

    // Vector from position to center
    const toCenterX = 0.5 - lastPos.x;
    const toCenterY = 0.5 - lastPos.y;
    const toCenterLen = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

    if (toCenterLen < 0.01) return 'stationary';

    // Normalize
    const normX = toCenterX / toCenterLen;
    const normY = toCenterY / toCenterLen;

    // Dot product with velocity
    const dot = vx * normX + vy * normY;

    if (dot > 0.03) return 'approaching';
    if (dot < -0.03) return 'departing';
    return 'lateral';
  }

  public getTrail(): Position2D[] {
    return this.history.map(h => h.position);
  }

  public clear() {
    this.history = [];
  }
}
