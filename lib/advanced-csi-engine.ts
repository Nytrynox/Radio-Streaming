// ============================================================================
// ADVANCED CSI ANALYSIS ENGINE
// Sophisticated signal processing for through-wall human detection
// ============================================================================

import type { RealWifiNetwork, RealScanResult, DetectedObject } from './real-wifi-scanner';

// ============================================================================
// TYPES
// ============================================================================

export interface CSIConfig {
  // Detection thresholds
  movementThresholdDb: number;        // Min RSSI change to trigger detection
  varianceWindowSize: number;          // Samples for variance calculation
  correlationThreshold: number;        // Min correlation for multi-AP validation
  
  // Frequency analysis
  sampleRate: number;                  // Expected samples per second
  movementFreqMin: number;             // Min Hz for human movement (walking ~0.5Hz)
  movementFreqMax: number;             // Max Hz for human movement (running ~3Hz)
  
  // Sensitivity
  sensitivityLevel: 'low' | 'medium' | 'high' | 'ultra';
  adaptiveThreshold: boolean;
}

export interface CSIAnalysisResult {
  timestamp: number;
  
  // Detection results
  movementDetected: boolean;
  movementIntensity: number;          // 0-1 normalized
  movementType: 'none' | 'micro' | 'slow' | 'normal' | 'fast';
  
  // Position estimation
  presenceZones: PresenceZone[];

  
  // Signal quality
  signalQuality: number;              // 0-100
  noiseLevel: number;                 // dB
  
  // Detected objects (signal change events)
  objects: EnhancedDetectedObject[];
  
  // Direction
  direction: 'approaching' | 'departing' | 'lateral' | 'stationary' | 'unknown';
  
  // Raw metrics
  avgVariance: number;
  correlationScore: number;
  frequencyPeak: number;              // Dominant frequency in Hz
}

export interface PresenceZone {
  id: string;
  name: string;
  confidence: number;                 // 0-1
  intensity: number;                  // 0-1
  lastActivity: number;               // timestamp
}

export interface EnhancedDetectedObject extends DetectedObject {
  // Movement characteristics
  movementSpeed: 'stationary' | 'slow' | 'medium' | 'fast';
  movementPattern: 'periodic' | 'random' | 'continuous' | 'unknown';
  
  // Multi-AP validation
  correlatedAPs: string[];
  validationScore: number;            // 0-1, higher = more confident
  
  // Temporal info
  duration: number;                   // ms since first detection
  isNew: boolean;
}

export interface SignalFingerprint {
  networkKey: string;
  rssiMean: number;
  rssiVariance: number;
  changeFrequency: number;
  lastUpdated: number;
}

// ============================================================================
// ADVANCED CSI ENGINE
// ============================================================================

export class AdvancedCSIEngine {
  private config: CSIConfig;
  
  // Historical data for analysis
  private rssiHistory: Map<string, number[]> = new Map();
  private varianceHistory: Map<string, number[]> = new Map();
  private timestampHistory: number[] = [];
  
  // Fingerprints for known signal patterns
  private fingerprints: Map<string, SignalFingerprint> = new Map();
  
  // Calibration state
  private baselineRSSI: Map<string, number> = new Map();
  private baselineVariance: Map<string, number> = new Map();
  private isCalibrated = false;
  private calibrationSamples = 0;
  private readonly calibrationTarget = 20;
  
  // Detection state
  private activeDetections: Map<string, { start: number; lastSeen: number }> = new Map();
  private lastCorrelationResult: Map<string, number> = new Map();
  
  constructor(config?: Partial<CSIConfig>) {
    this.config = {
      movementThresholdDb: 6.0, // Increased from 3.0
      varianceWindowSize: 10,
      correlationThreshold: 0.7, // Increased from 0.6
      sampleRate: 0.5,
      movementFreqMin: 0.3,
      movementFreqMax: 4.0,
      sensitivityLevel: 'medium',
      adaptiveThreshold: true,
      ...config
    };
  }
  
  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  
  public setSensitivity(level: CSIConfig['sensitivityLevel']) {
    this.config.sensitivityLevel = level;
    
    // Adjust thresholds based on sensitivity - all higher now
    const thresholds: Record<CSIConfig['sensitivityLevel'], number> = {
      low: 8.0,    // was 5.0
      medium: 6.0, // was 3.0
      high: 4.0,   // was 2.0
      ultra: 2.0   // was 1.0
    };
    
    this.config.movementThresholdDb = thresholds[level];
  }
  
  public getConfig(): CSIConfig {
    return { ...this.config };
  }
  
  // ============================================================================
  // MAIN ANALYSIS
  // ============================================================================
  
  public analyze(scan: RealScanResult): CSIAnalysisResult {
    const now = scan.timestamp;
    this.timestampHistory.push(now);
    if (this.timestampHistory.length > 100) this.timestampHistory.shift();
    
    const networks = this.getAllNetworks(scan);
    
    // Update history for each network
    this.updateHistory(networks, now);
    
    // Handle calibration phase
    if (!this.isCalibrated) {
      this.updateCalibration(networks);
    }
    
    // Calculate variance for each AP
    const variances = this.calculateVariances();
    
    // Perform multi-AP correlation
    const correlationScore = this.calculateCorrelation(networks);
    
    // Detect movement based on combined analysis
    const { movementDetected, intensity, type } = this.detectMovement(variances, correlationScore);
    
    // Generate detected objects
    const objects = this.generateDetectedObjects(networks, now);
    
    // Estimate presence zones
    const presenceZones = this.estimatePresenceZones(objects, intensity);
    
    // Determine movement direction from RSSI trends
    const dominantDirection = this.determineDirection(networks);
    
    // Calculate signal quality
    const signalQuality = this.calculateSignalQuality(networks);
    const noiseLevel = this.calculateNoiseLevel(networks);
    
    // Simple frequency analysis (pseudo-FFT)
    const frequencyPeak = this.estimateFrequency();
    
    return {
      timestamp: now,
      movementDetected,
      movementIntensity: intensity,
      movementType: type,
      presenceZones,
      direction: dominantDirection,
      signalQuality,
      noiseLevel,
      objects,
      avgVariance: this.calculateAvgVariance(variances),
      correlationScore,
      frequencyPeak
    };
  }
  
  // ============================================================================
  // HISTORY MANAGEMENT
  // ============================================================================
  
  private getAllNetworks(scan: RealScanResult): RealWifiNetwork[] {
    return scan.currentNetwork 
      ? [scan.currentNetwork, ...scan.nearbyNetworks]
      : scan.nearbyNetworks;
  }
  
  private updateHistory(networks: RealWifiNetwork[], now: number) {
    const windowSize = this.config.varianceWindowSize;
    
    for (const network of networks) {
      const key = network.bssid || network.ssid;
      if (!key || !Number.isFinite(network.rssi)) continue;
      
      // Update RSSI history
      const history = this.rssiHistory.get(key) || [];
      history.push(network.rssi);
      if (history.length > windowSize * 2) history.shift();
      this.rssiHistory.set(key, history);
    }
  }
  
  // ============================================================================
  // CALIBRATION
  // ============================================================================
  
  private updateCalibration(networks: RealWifiNetwork[]) {
    this.calibrationSamples++;
    
    for (const network of networks) {
      const key = network.bssid || network.ssid;
      if (!key || !Number.isFinite(network.rssi)) continue;
      
      // Running average for baseline
      const currentBaseline = this.baselineRSSI.get(key) || network.rssi;
      const alpha = 0.1;
      this.baselineRSSI.set(key, currentBaseline * (1 - alpha) + network.rssi * alpha);
    }
    
    if (this.calibrationSamples >= this.calibrationTarget) {
      this.isCalibrated = true;
      
      // Calculate baseline variances
      for (const [key, history] of this.rssiHistory) {
        if (history.length >= 5) {
          this.baselineVariance.set(key, this.calculateVariance(history));
        }
      }
    }
  }
  
  public getCalibrationProgress(): { isCalibrated: boolean; progress: number } {
    return {
      isCalibrated: this.isCalibrated,
      progress: Math.min(100, (this.calibrationSamples / this.calibrationTarget) * 100)
    };
  }
  
  public resetCalibration() {
    this.isCalibrated = false;
    this.calibrationSamples = 0;
    this.baselineRSSI.clear();
    this.baselineVariance.clear();
    this.rssiHistory.clear();
    this.varianceHistory.clear();
    this.fingerprints.clear();
    this.activeDetections.clear();
  }
  
  // ============================================================================
  // VARIANCE ANALYSIS
  // ============================================================================
  
  private calculateVariances(): Map<string, number> {
    const variances = new Map<string, number>();
    const windowSize = this.config.varianceWindowSize;
    
    for (const [key, history] of this.rssiHistory) {
      if (history.length < 3) continue;
      
      const recentHistory = history.slice(-windowSize);
      const variance = this.calculateVariance(recentHistory);
      variances.set(key, variance);
      
      // Update variance history for trend analysis
      const varHistory = this.varianceHistory.get(key) || [];
      varHistory.push(variance);
      if (varHistory.length > 30) varHistory.shift();
      this.varianceHistory.set(key, varHistory);
    }
    
    return variances;
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
  
  private calculateAvgVariance(variances: Map<string, number>): number {
    if (variances.size === 0) return 0;
    let sum = 0;
    for (const v of variances.values()) sum += v;
    return sum / variances.size;
  }
  
  // ============================================================================
  // MULTI-AP CORRELATION
  // ============================================================================
  
  private calculateCorrelation(networks: RealWifiNetwork[]): number {
    if (networks.length < 2) return 0;
    
    // Get RSSI changes for each network
    const changes: Map<string, number> = new Map();
    
    for (const network of networks) {
      const key = network.bssid || network.ssid;
      if (!key) continue;
      
      const history = this.rssiHistory.get(key);
      if (!history || history.length < 2) continue;
      
      const delta = history[history.length - 1] - history[history.length - 2];
      changes.set(key, delta);
    }
    
    if (changes.size < 2) return 0;
    
    // Calculate correlation: how many APs show similar change direction
    const deltas = Array.from(changes.values());
    const significantDeltas = deltas.filter(d => Math.abs(d) > 1);
    
    if (significantDeltas.length < 2) return 0;
    
    // Check if changes are correlated (same direction)
    const positive = significantDeltas.filter(d => d > 0).length;
    const negative = significantDeltas.filter(d => d < 0).length;
    const dominant = Math.max(positive, negative);
    
    const correlation = dominant / significantDeltas.length;
    
    // Store for validation
    for (const [key, delta] of changes) {
      this.lastCorrelationResult.set(key, delta);
    }
    
    return correlation;
  }
  
  // ============================================================================
  // MOVEMENT DETECTION
  // ============================================================================
  
  private detectMovement(
    variances: Map<string, number>, 
    correlationScore: number
  ): { movementDetected: boolean; intensity: number; type: CSIAnalysisResult['movementType'] } {
    
    const avgVariance = this.calculateAvgVariance(variances);
    
    // Get adaptive threshold
    let threshold = this.config.movementThresholdDb;
    if (this.config.adaptiveThreshold && this.isCalibrated) {
      const baselineAvg = this.calculateAvgVariance(this.baselineVariance);
      threshold = Math.max(threshold, baselineAvg * 2);
    }
    
    // Calculate intensity (0-1)
    const intensity = Math.min(1, Math.sqrt(avgVariance) / 10);
    
    // Determine movement type based on intensity and correlation
    let type: CSIAnalysisResult['movementType'] = 'none';
    let detected = false;
    
    if (avgVariance > threshold) {
      detected = true;
      
      // Require correlation for high-confidence detection
      if (correlationScore < this.config.correlationThreshold && this.rssiHistory.size > 2) {
        // Low correlation might be noise, reduce confidence
        type = 'micro';
      } else if (intensity < 0.3) {
        type = 'slow';
      } else if (intensity < 0.6) {
        type = 'normal';
      } else {
        type = 'fast';
      }
    } else if (avgVariance > threshold * 0.5) {
      type = 'micro';
      detected = correlationScore > this.config.correlationThreshold;
    }
    
    return { movementDetected: detected, intensity, type };
  }
  
  // ============================================================================
  // DETECTED OBJECTS GENERATION
  // ============================================================================
  
  private generateDetectedObjects(networks: RealWifiNetwork[], now: number): EnhancedDetectedObject[] {
    const objects: EnhancedDetectedObject[] = [];
    const threshold = this.config.movementThresholdDb;
    
    for (const network of networks) {
      const key = network.bssid || network.ssid;
      if (!key) continue;
      
      const history = this.rssiHistory.get(key);
      if (!history || history.length < 2) continue;
      
      const delta = history[history.length - 1] - history[history.length - 2];
      const absDelta = Math.abs(delta);
      
      if (absDelta < threshold) continue;
      
      // Check if this is a new or ongoing detection
      const existing = this.activeDetections.get(key);
      const isNew = !existing || (now - existing.lastSeen > 5000);
      
      if (isNew) {
        this.activeDetections.set(key, { start: now, lastSeen: now });
      } else {
        existing.lastSeen = now;
      }
      
      const duration = existing ? now - existing.start : 0;
      
      // Get correlated APs
      const correlatedAPs: string[] = [];
      for (const [k, d] of this.lastCorrelationResult) {
        if (k !== key && Math.sign(d) === Math.sign(delta) && Math.abs(d) > 1) {
          correlatedAPs.push(k);
        }
      }
      
      // Determine movement characteristics
      const variance = this.varianceHistory.get(key);
      const avgVariance = variance ? this.calculateVariance(variance) : 0;
      
      let movementSpeed: EnhancedDetectedObject['movementSpeed'] = 'stationary';
      if (absDelta > 8) movementSpeed = 'fast';
      else if (absDelta > 5) movementSpeed = 'medium';
      else if (absDelta > threshold) movementSpeed = 'slow';
      
      let movementPattern: EnhancedDetectedObject['movementPattern'] = 'unknown';
      if (variance && variance.length >= 5) {
        const varianceOfVariance = this.calculateVariance(variance);
        if (varianceOfVariance < 1) movementPattern = 'continuous';
        else if (varianceOfVariance < 5) movementPattern = 'periodic';
        else movementPattern = 'random';
      }
      
      // Calculate validation score
      const validationScore = Math.min(1, (correlatedAPs.length + 1) / 3);
      
      objects.push({
        id: `csi-${key}-${now}`,
        type: 'signal_change',
        confidence: Math.min(1, absDelta / 10) * validationScore,
        sourceNetwork: network.ssid || network.bssid || 'unknown',
        distance: this.rssiToDistance(network.rssi),
        deltaDb: delta,
        rssi: network.rssi,
        movementSpeed,
        movementPattern,
        correlatedAPs,
        validationScore,
        duration,
        isNew
      });
    }
    
    // Sort by confidence
    objects.sort((a, b) => b.confidence - a.confidence);
    
    // Cleanup old detections
    for (const [key, data] of this.activeDetections) {
      if (now - data.lastSeen > 10000) {
        this.activeDetections.delete(key);
      }
    }
    
    return objects.slice(0, 10); // Limit to top 10
  }
  
  private rssiToDistance(rssi: number): number {
    // Simple path loss model: d = 10^((txPower - rssi) / (10 * n))
    // Using typical values: txPower = -40 dBm, n = 2.5
    const txPower = -40;
    const n = 2.5;
    const distance = Math.pow(10, (txPower - rssi) / (10 * n));
    return Math.min(20, Math.max(0.5, distance));
  }
  
  // ============================================================================
  // PRESENCE ZONES
  // ============================================================================
  
  private estimatePresenceZones(objects: EnhancedDetectedObject[], intensity: number): PresenceZone[] {
    // Simple zone estimation based on signal characteristics
    // In a real system, this would use calibrated AP positions
    
    const zones: PresenceZone[] = [];
    const now = Date.now();
    
    if (objects.length === 0 || intensity < 0.1) {
      return [{
        id: 'zone-main',
        name: 'Main Area',
        confidence: 0.1,
        intensity: 0,
        lastActivity: now
      }];
    }
    
    // Group objects by approximate distance
    const near = objects.filter(o => o.distance < 5);
    const mid = objects.filter(o => o.distance >= 5 && o.distance < 10);
    const far = objects.filter(o => o.distance >= 10);
    
    if (near.length > 0) {
      zones.push({
        id: 'zone-near',
        name: 'Near Zone (0-5m)',
        confidence: Math.min(1, near.reduce((s, o) => s + o.confidence, 0) / near.length),
        intensity: intensity * 1.5,
        lastActivity: now
      });
    }
    
    if (mid.length > 0) {
      zones.push({
        id: 'zone-mid',
        name: 'Mid Zone (5-10m)',
        confidence: Math.min(1, mid.reduce((s, o) => s + o.confidence, 0) / mid.length),
        intensity: intensity,
        lastActivity: now
      });
    }
    
    if (far.length > 0) {
      zones.push({
        id: 'zone-far',
        name: 'Far Zone (10m+)',
        confidence: Math.min(1, far.reduce((s, o) => s + o.confidence, 0) / far.length),
        intensity: intensity * 0.5,
        lastActivity: now
      });
    }
    
    return zones.length > 0 ? zones : [{
      id: 'zone-main',
      name: 'Main Area',
      confidence: 0.5,
      intensity,
      lastActivity: now
    }];
  }
  
  // ============================================================================
  // DIRECTION ANALYSIS
  // ============================================================================
  
  private determineDirection(networks: RealWifiNetwork[]): CSIAnalysisResult['direction'] {
    if (networks.length === 0) return 'unknown';
    
    // Analyze RSSI trends across networks
    let approaching = 0;
    let departing = 0;
    let stable = 0;
    
    for (const network of networks) {
      const key = network.bssid || network.ssid;
      if (!key) continue;
      
      const history = this.rssiHistory.get(key);
      if (!history || history.length < 3) {
        stable++;
        continue;
      }
      
      // Calculate trend over last few samples
      const recent = history.slice(-5);
      if (recent.length < 3) {
        stable++;
        continue;
      }
      
      const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
      const secondHalf = recent.slice(Math.floor(recent.length / 2));
      
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const trend = secondAvg - firstAvg;
      
      if (trend > 1.5) approaching++; // RSSI increasing = getting closer
      else if (trend < -1.5) departing++;
      else stable++;
    }
    
    const total = approaching + departing + stable;
    if (total === 0) return 'unknown';
    
    if (approaching > departing && approaching > stable * 0.5) return 'approaching';
    if (departing > approaching && departing > stable * 0.5) return 'departing';
    if (stable > (approaching + departing)) return 'stationary';
    
    return 'lateral';
  }
  
  // ============================================================================
  // SIGNAL QUALITY
  // ============================================================================
  
  private calculateSignalQuality(networks: RealWifiNetwork[]): number {
    if (networks.length === 0) return 0;
    
    const rssiValues = networks
      .map(n => n.rssi)
      .filter(r => Number.isFinite(r));
    
    if (rssiValues.length === 0) return 0;
    
    // Best RSSI determines quality
    const bestRSSI = Math.max(...rssiValues);
    
    // Map -90 to -30 dBm to 0-100%
    const quality = Math.max(0, Math.min(100, ((bestRSSI + 90) / 60) * 100));
    
    return quality;
  }
  
  private calculateNoiseLevel(networks: RealWifiNetwork[]): number {
    // Estimate noise from SNR or variance
    const snrValues = networks
      .map(n => n.snr)
      .filter((s): s is number => s !== undefined && Number.isFinite(s));
    
    if (snrValues.length === 0) return -90; // Default noise floor
    
    // Lower SNR = higher noise
    const avgSNR = snrValues.reduce((a, b) => a + b, 0) / snrValues.length;
    const avgRSSI = networks.reduce((s, n) => s + (n.rssi || -90), 0) / networks.length;
    
    return avgRSSI - avgSNR;
  }
  
  // ============================================================================
  // FREQUENCY ANALYSIS
  // ============================================================================
  
  private estimateFrequency(): number {
    // Simple frequency estimation from variance history
    // A full implementation would use FFT
    
    if (this.timestampHistory.length < 10) return 0;
    
    // Count "peaks" in variance
    let peakCount = 0;
    let lastPeakTime = 0;
    const intervals: number[] = [];
    
    for (const [, varHistory] of this.varianceHistory) {
      if (varHistory.length < 5) continue;
      
      for (let i = 2; i < varHistory.length - 2; i++) {
        const prev = varHistory[i - 1];
        const curr = varHistory[i];
        const next = varHistory[i + 1];
        
        // Simple peak detection
        if (curr > prev && curr > next && curr > 2) {
          peakCount++;
          const currentTime = this.timestampHistory[Math.min(i, this.timestampHistory.length - 1)];
          if (lastPeakTime > 0) {
            intervals.push(currentTime - lastPeakTime);
          }
          lastPeakTime = currentTime;
        }
      }
    }
    
    if (intervals.length === 0) return 0;
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgInterval <= 0) return 0;
    
    // Convert to frequency (Hz)
    const frequency = 1000 / avgInterval;
    
    // Clamp to human movement range
    return Math.max(0, Math.min(5, frequency));
  }
  
  // ============================================================================
  // FINGERPRINTING
  // ============================================================================
  
  public updateFingerprint(networkKey: string) {
    const history = this.rssiHistory.get(networkKey);
    if (!history || history.length < 5) return;
    
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = this.calculateVariance(history);
    
    const varHistory = this.varianceHistory.get(networkKey);
    const changeFrequency = varHistory 
      ? varHistory.filter(v => v > this.config.movementThresholdDb).length / varHistory.length
      : 0;
    
    this.fingerprints.set(networkKey, {
      networkKey,
      rssiMean: mean,
      rssiVariance: variance,
      changeFrequency,
      lastUpdated: Date.now()
    });
  }
  
  public getFingerprints(): SignalFingerprint[] {
    return Array.from(this.fingerprints.values());
  }
  
  // ============================================================================
  // STATE
  // ============================================================================
  
  public getState() {
    return {
      isCalibrated: this.isCalibrated,
      calibrationProgress: (this.calibrationSamples / this.calibrationTarget) * 100,
      trackedNetworks: this.rssiHistory.size,
      activeDetections: this.activeDetections.size,
      config: this.config
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let engineInstance: AdvancedCSIEngine | null = null;

export function getCSIEngine(config?: Partial<CSIConfig>): AdvancedCSIEngine {
  if (!engineInstance) {
    engineInstance = new AdvancedCSIEngine(config);
  }
  return engineInstance;
}

export function resetCSIEngine() {
  if (engineInstance) {
    engineInstance.resetCalibration();
  }
  engineInstance = null;
}
