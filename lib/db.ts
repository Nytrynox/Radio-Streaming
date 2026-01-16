// ============================================================================
// IndexedDB PERSISTENCE LAYER
// ============================================================================

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { 
  RecordedSession, 
  SessionEvent, 
  ActivityPattern,
  AnomalyAlert,
  SensorFusion 
} from './types';

interface RadarDBSchema extends DBSchema {
  sessions: {
    key: string;
    value: RecordedSession;
    indexes: { 'by-start': number };
  };
  events: {
    key: number;
    value: SessionEvent & { sessionId: string };
    indexes: { 'by-session': string; 'by-time': number; 'by-type': string };
  };
  patterns: {
    key: string;
    value: ActivityPattern;
  };
  anomalies: {
    key: number;
    value: AnomalyAlert;
    indexes: { 'by-time': number; 'by-severity': string };
  };
  sensorHistory: {
    key: number;
    value: SensorFusion;
    indexes: { 'by-time': number };
  };
  settings: {
    key: string;
    value: any;
  };
  mlTrainingData: {
    key: number;
    value: { features: number[]; label: string; timestamp: number };
    indexes: { 'by-label': string };
  };
}

const DB_NAME = 'wifi-radar-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<RadarDBSchema> | null = null;

export async function getDB(): Promise<IDBPDatabase<RadarDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<RadarDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Sessions store
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionsStore.createIndex('by-start', 'startTime');
      }

      // Events store
      if (!db.objectStoreNames.contains('events')) {
        const eventsStore = db.createObjectStore('events', { autoIncrement: true });
        eventsStore.createIndex('by-session', 'sessionId');
        eventsStore.createIndex('by-time', 'timestamp');
        eventsStore.createIndex('by-type', 'type');
      }

      // Patterns store
      if (!db.objectStoreNames.contains('patterns')) {
        db.createObjectStore('patterns', { keyPath: 'hour' });
      }

      // Anomalies store
      if (!db.objectStoreNames.contains('anomalies')) {
        const anomaliesStore = db.createObjectStore('anomalies', { autoIncrement: true });
        anomaliesStore.createIndex('by-time', 'timestamp');
        anomaliesStore.createIndex('by-severity', 'severity');
      }

      // Sensor history store
      if (!db.objectStoreNames.contains('sensorHistory')) {
        const historyStore = db.createObjectStore('sensorHistory', { autoIncrement: true });
        historyStore.createIndex('by-time', 'timestamp');
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }

      // ML training data store
      if (!db.objectStoreNames.contains('mlTrainingData')) {
        const mlStore = db.createObjectStore('mlTrainingData', { autoIncrement: true });
        mlStore.createIndex('by-label', 'label');
      }
    },
  });

  return dbInstance;
}

// ============================================================================
// SESSION OPERATIONS
// ============================================================================

export async function createSession(name: string): Promise<RecordedSession> {
  const db = await getDB();
  const session: RecordedSession = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    startTime: Date.now(),
    endTime: null,
    events: [],
    metadata: {
      totalWifiScans: 0,
      totalBluetoothScans: 0,
      totalMovementEvents: 0,
      totalAlerts: 0,
    },
  };
  await db.put('sessions', session);
  return session;
}

export async function endSession(id: string): Promise<void> {
  const db = await getDB();
  const session = await db.get('sessions', id);
  if (session) {
    session.endTime = Date.now();
    await db.put('sessions', session);
  }
}

export async function getAllSessions(): Promise<RecordedSession[]> {
  const db = await getDB();
  return db.getAllFromIndex('sessions', 'by-start');
}

export async function getSession(id: string): Promise<RecordedSession | undefined> {
  const db = await getDB();
  return db.get('sessions', id);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('sessions', id);
  // Also delete associated events
  const tx = db.transaction('events', 'readwrite');
  const index = tx.store.index('by-session');
  let cursor = await index.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

// ============================================================================
// EVENT OPERATIONS
// ============================================================================

export async function addEvent(sessionId: string, event: SessionEvent): Promise<void> {
  const db = await getDB();
  await db.add('events', { ...event, sessionId });
  
  // Update session metadata
  const session = await db.get('sessions', sessionId);
  if (session) {
    if (event.type === 'wifi') session.metadata.totalWifiScans++;
    if (event.type === 'bluetooth') session.metadata.totalBluetoothScans++;
    if (event.type === 'alert') session.metadata.totalAlerts++;
    if (event.data?.movementDetected) session.metadata.totalMovementEvents++;
    await db.put('sessions', session);
  }
}

export async function getEventsBySession(sessionId: string): Promise<SessionEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('events', 'by-session', sessionId);
}

export async function getEventsByTimeRange(start: number, end: number): Promise<SessionEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('events', 'by-time', IDBKeyRange.bound(start, end));
}

// ============================================================================
// SENSOR HISTORY OPERATIONS
// ============================================================================

export async function addSensorReading(data: SensorFusion): Promise<void> {
  const db = await getDB();
  await db.add('sensorHistory', data);
  
  // Keep only last 24 hours of data
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const tx = db.transaction('sensorHistory', 'readwrite');
  const index = tx.store.index('by-time');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

export async function getSensorHistory(hours: number = 24): Promise<SensorFusion[]> {
  const db = await getDB();
  const start = Date.now() - hours * 60 * 60 * 1000;
  return db.getAllFromIndex('sensorHistory', 'by-time', IDBKeyRange.lowerBound(start));
}

// ============================================================================
// ANOMALY OPERATIONS
// ============================================================================

export async function addAnomaly(anomaly: AnomalyAlert): Promise<void> {
  const db = await getDB();
  await db.add('anomalies', anomaly);
}

export async function getRecentAnomalies(hours: number = 24): Promise<AnomalyAlert[]> {
  const db = await getDB();
  const start = Date.now() - hours * 60 * 60 * 1000;
  return db.getAllFromIndex('anomalies', 'by-time', IDBKeyRange.lowerBound(start));
}

// ============================================================================
// SETTINGS OPERATIONS
// ============================================================================

export async function setSetting(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const db = await getDB();
  const value = await db.get('settings', key);
  return value !== undefined ? value : defaultValue;
}

// ============================================================================
// ML TRAINING DATA OPERATIONS
// ============================================================================

export async function addTrainingData(features: number[], label: string): Promise<void> {
  const db = await getDB();
  await db.add('mlTrainingData', { features, label, timestamp: Date.now() });
}

export async function getTrainingData(): Promise<{ features: number[]; label: string }[]> {
  const db = await getDB();
  return db.getAll('mlTrainingData');
}

export async function clearTrainingData(): Promise<void> {
  const db = await getDB();
  await db.clear('mlTrainingData');
}

// ============================================================================
// PATTERN OPERATIONS
// ============================================================================

export async function updatePattern(pattern: ActivityPattern): Promise<void> {
  const db = await getDB();
  await db.put('patterns', pattern);
}

export async function getAllPatterns(): Promise<ActivityPattern[]> {
  const db = await getDB();
  return db.getAll('patterns');
}

// ============================================================================
// UTILITY
// ============================================================================

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('sessions');
  await db.clear('events');
  await db.clear('patterns');
  await db.clear('anomalies');
  await db.clear('sensorHistory');
  await db.clear('mlTrainingData');
}

export async function getStorageStats(): Promise<{
  sessions: number;
  events: number;
  sensorReadings: number;
  anomalies: number;
}> {
  const db = await getDB();
  return {
    sessions: await db.count('sessions'),
    events: await db.count('events'),
    sensorReadings: await db.count('sensorHistory'),
    anomalies: await db.count('anomalies'),
  };
}
