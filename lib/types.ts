// ============================================================================
// SHARED TYPES FOR ALL ADVANCED FEATURES
// ============================================================================

// Existing WiFi types (re-export for convenience)
export type { RealWifiNetwork, RealScanResult, DetectedObject } from './real-wifi-scanner';

// ============================================================================
// BLUETOOTH TYPES
// ============================================================================

export interface BluetoothDevice {
  address: string;
  name: string;
  rssi: number;
  isConnected: boolean;
  lastSeen: number;
  deviceType: 'phone' | 'laptop' | 'headphones' | 'watch' | 'speaker' | 'unknown';
}

export interface BluetoothScanResult {
  timestamp: number;
  devices: BluetoothDevice[];
  connectedDevice: BluetoothDevice | null;
}

// ============================================================================
// AUDIO SONAR TYPES
// ============================================================================

export interface SonarReading {
  timestamp: number;
  frequency: number; // Hz
  amplitude: number; // 0-1
  echoDelay: number; // ms
  movementScore: number; // 0-1
  distanceEstimate: number; // meters (rough)
}

export interface AudioEvent {
  timestamp: number;
  type: 'footstep' | 'door' | 'voice' | 'impact' | 'unknown';
  confidence: number;
  volume: number; // dB
}

export interface SonarState {
  isActive: boolean;
  readings: SonarReading[];
  events: AudioEvent[];
  lastMovement: number;
  ambientNoise: number;
}

// ============================================================================
// AMBIENT LIGHT TYPES
// ============================================================================

export interface LightReading {
  timestamp: number;
  lux: number;
  change: number; // delta from baseline
  shadowDetected: boolean;
}

export interface LightSensorState {
  isActive: boolean;
  baseline: number;
  current: number;
  history: LightReading[];
}

// ============================================================================
// NETWORK ANALYSIS TYPES
// ============================================================================

export interface NetworkDevice {
  ip: string;
  mac: string;
  hostname?: string;
  lastActive: number;
  isOnline: boolean;
  activityScore: number; // 0-1
}

export interface NetworkAnalysis {
  timestamp: number;
  devices: NetworkDevice[];
  activeConnections: number;
  recentActivity: { device: string; action: string; time: number }[];
}

// ============================================================================
// ML CLASSIFICATION TYPES
// ============================================================================

export type MotionClass = 
  | 'idle'
  | 'walking'
  | 'running'
  | 'standing'
  | 'multiple_people'
  | 'approaching'
  | 'departing'
  | 'unknown';

export interface MLPrediction {
  timestamp: number;
  class: MotionClass;
  confidence: number;
  probabilities: Record<MotionClass, number>;
  features: number[];
}

export interface MLModelState {
  isLoaded: boolean;
  isTraining: boolean;
  accuracy: number;
  lastPrediction: MLPrediction | null;
  trainingProgress: number;
}

// ============================================================================
// TRIANGULATION TYPES
// ============================================================================

export interface Position2D {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

export interface TriangulationResult {
  timestamp: number;
  position: Position2D;
  confidence: number;
  heatmap: number[][]; // 2D grid of probabilities
  usedNetworks: string[];
}

// ============================================================================
// PATTERN ANALYSIS TYPES
// ============================================================================

export interface ActivityPattern {
  hour: number; // 0-23
  dayOfWeek: number; // 0-6
  averageIntensity: number;
  eventCount: number;
}

export interface AnomalyAlert {
  timestamp: number;
  type: 'unusual_time' | 'unusual_intensity' | 'new_device' | 'signal_drop';
  severity: 'low' | 'medium' | 'high';
  message: string;
  data: any;
}

export interface PatternAnalysis {
  patterns: ActivityPattern[];
  anomalies: AnomalyAlert[];
  hourlyHeatmap: number[]; // 24 values
  weeklyHeatmap: number[]; // 7 values
  trends: { direction: 'increasing' | 'decreasing' | 'stable'; period: string }[];
}

// ============================================================================
// SESSION & RECORDING TYPES
// ============================================================================

export interface SessionEvent {
  timestamp: number;
  type: 'wifi' | 'bluetooth' | 'sonar' | 'light' | 'network' | 'ml' | 'alert' | 'sensor_fusion';
  data: any;
}

export interface RecordedSession {
  id: string;
  name: string;
  startTime: number;
  endTime: number | null;
  events: SessionEvent[];
  metadata: {
    totalWifiScans: number;
    totalBluetoothScans: number;
    totalMovementEvents: number;
    totalAlerts: number;
  };
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type ExportFormat = 'csv' | 'json' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  includeWifi: boolean;
  includeBluetooth: boolean;
  includeSonar: boolean;
  includeLight: boolean;
  includeNetwork: boolean;
  includeMl: boolean;
  dateRange: { start: number; end: number } | null;
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

export interface FeatureSettings {
  wifi: { enabled: boolean; scanInterval: number };
  bluetooth: { enabled: boolean; scanInterval: number };
  sonar: { enabled: boolean; frequency: number; sensitivity: number };
  light: { enabled: boolean; threshold: number };
  network: { enabled: boolean; scanInterval: number };
  ml: { enabled: boolean; autoClassify: boolean };
  triangulation: { enabled: boolean };
  recording: { autoStart: boolean; maxDuration: number };
  powerSaving: { enabled: boolean; reducedInterval: number };
}

// ============================================================================
// UNIFIED SENSOR STATE
// ============================================================================

export interface SensorFusion {
  timestamp: number;
  wifi: { intensity: number; networks: number; movement: boolean };
  bluetooth: { devices: number; nearby: number };
  sonar: { movement: number; distance: number };
  light: { level: number; shadow: boolean };
  network: { active: number; recent: number };
  ml: { class: MotionClass; confidence: number };
  combined: {
    presenceScore: number; // 0-1
    movementScore: number; // 0-1
    alertLevel: 'none' | 'low' | 'medium' | 'high';
  };
}
