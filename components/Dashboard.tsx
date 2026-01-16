'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Heatmap, { HourlyHeatmap } from './Heatmap';
import ActivityTimeline from './ActivityTimeline';
import type { SensorFusion, MotionClass, BluetoothDevice, NetworkDevice, AnomalyAlert } from '../lib/types';
import type { DetectedObject } from '../lib/real-wifi-scanner';

// Dynamic imports for heavy components
const Room3D = dynamic(() => import('./Room3D'), { ssr: false, loading: () => <div className="loading-3d">Loading 3D View...</div> });

interface DashboardProps {
  isScanning: boolean;
  wifiData: { intensity: number; networks: number; movement: boolean; objects: DetectedObject[] };
  bluetoothData: { devices: BluetoothDevice[]; nearby: number };
  sonarData: { movement: number; distance: number };
  lightData: { level: number; shadow: boolean };
  networkData: { devices: NetworkDevice[]; active: number };
  mlData: { class: MotionClass; confidence: number };
  heatmap?: number[][];
  hourlyActivity: number[];
  anomalies: AnomalyAlert[];
  position?: { x: number; y: number };
  onViewChange: (view: 'radar' | '3d' | 'timeline') => void;
}

export default function Dashboard({
  isScanning, wifiData, bluetoothData, sonarData, lightData, networkData, mlData,
  heatmap, hourlyActivity, anomalies, position, onViewChange
}: DashboardProps) {
  const [activeView, setActiveView] = useState<'radar' | '3d' | 'timeline'>('radar');

  const combinedScore = useMemo(() => {
    const scores = [
      wifiData.intensity * 0.3,
      (bluetoothData.nearby / 5) * 0.15,
      sonarData.movement * 0.25,
      (lightData.shadow ? 0.3 : 0) * 0.1,
      mlData.confidence * 0.2,
    ];
    return Math.min(1, scores.reduce((a, b) => a + b, 0));
  }, [wifiData, bluetoothData, sonarData, lightData, mlData]);

  const combinedScoreWidthPct = Math.max(0, Math.min(100, combinedScore * 100));
  const wifiWidthPct = Math.max(0, Math.min(100, wifiData.intensity * 100));
  const btWidthPct = Math.max(0, Math.min(100, bluetoothData.nearby * 20));
  const sonarWidthPct = Math.max(0, Math.min(100, sonarData.movement * 100));
  const lightWidthPct = Math.max(0, Math.min(100, lightData.level / 10));
  const netWidthPct = Math.max(0, Math.min(100, networkData.active * 10));

  const alertLevel = combinedScore > 0.7 ? 'high' : combinedScore > 0.4 ? 'medium' : 'low';

  const timelineEvents = useMemo(() => {
    // Generate events from anomalies
    return anomalies.map(a => ({
      timestamp: a.timestamp,
      type: a.type,
      intensity: a.severity === 'high' ? 0.9 : a.severity === 'medium' ? 0.6 : 0.3,
      label: a.message,
    }));
  }, [anomalies]);

  return (
    <div className="dashboard">
      {/* Combined Score Header */}
      <div className={`score-header ${alertLevel}`}>
        <div className="score-main">
          <span className="score-label">Combined Detection Score</span>
          <span className="score-value">{(combinedScore * 100).toFixed(0)}%</span>
        </div>
        <div className="score-bar">
          <div className="score-fill" />
        </div>
        <div className="ml-class">
          <span>🤖 ML: </span>
          <strong>{mlData.class}</strong>
          <span className="confidence">({(mlData.confidence * 100).toFixed(0)}%)</span>
        </div>
      </div>

      {/* Sensor Grid */}
      <div className="sensor-grid">
        <div className="sensor-card">
          <div className="sensor-icon">📶</div>
          <div className="sensor-info">
            <span className="sensor-name">WiFi</span>
            <span className="sensor-value">{wifiData.networks} networks</span>
            <div className="sensor-bar"><div className="fill fill-wifi" /></div>
          </div>
        </div>
        <div className="sensor-card">
          <div className="sensor-icon">📱</div>
          <div className="sensor-info">
            <span className="sensor-name">Bluetooth</span>
            <span className="sensor-value">{bluetoothData.devices.length} devices</span>
            <div className="sensor-bar"><div className="fill fill-bt" /></div>
          </div>
        </div>
        <div className="sensor-card">
          <div className="sensor-icon">🔊</div>
          <div className="sensor-info">
            <span className="sensor-name">Sonar</span>
            <span className="sensor-value">{(sonarData.movement * 100).toFixed(0)}%</span>
            <div className="sensor-bar"><div className="fill fill-sonar" /></div>
          </div>
        </div>
        <div className="sensor-card">
          <div className="sensor-icon">💡</div>
          <div className="sensor-info">
            <span className="sensor-name">Light</span>
            <span className="sensor-value">{lightData.level.toFixed(0)} lux</span>
            <div className={`sensor-bar ${lightData.shadow ? 'shadow' : ''}`}><div className="fill fill-light" /></div>
          </div>
        </div>
        <div className="sensor-card">
          <div className="sensor-icon">🌐</div>
          <div className="sensor-info">
            <span className="sensor-name">Network</span>
            <span className="sensor-value">{networkData.active} active</span>
            <div className="sensor-bar"><div className="fill fill-net" /></div>
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="view-tabs">
        <button className={activeView === 'radar' ? 'active' : ''} onClick={() => { setActiveView('radar'); onViewChange('radar'); }}>📡 Radar</button>
        <button className={activeView === '3d' ? 'active' : ''} onClick={() => { setActiveView('3d'); onViewChange('3d'); }}>🎮 3D Room</button>
        <button className={activeView === 'timeline' ? 'active' : ''} onClick={() => { setActiveView('timeline'); onViewChange('timeline'); }}>📊 Timeline</button>
      </div>

      {/* View Content */}
      <div className="view-content">
        {activeView === '3d' && (
          <Room3D detectedObjects={wifiData.objects} movementIntensity={combinedScore} position={position} heatmap={heatmap} isActive={isScanning} />
        )}
        {activeView === 'timeline' && (
          <div className="timeline-view">
            <ActivityTimeline events={timelineEvents} hours={6} />
            <div className="mini-charts">
              <HourlyHeatmap data={hourlyActivity} label="24h Activity Pattern" />
              {heatmap && <Heatmap data={heatmap} width={150} height={150} showLabels />}
            </div>
          </div>
        )}
        {activeView === 'radar' && (
          <div className="radar-placeholder">Use main radar view above</div>
        )}
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="anomalies">
          <h4>⚠️ Recent Anomalies</h4>
          {anomalies.slice(-3).map((a, i) => (
            <div key={i} className={`anomaly ${a.severity}`}>
              <span className="time">{new Date(a.timestamp).toLocaleTimeString()}</span>
              <span className="msg">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .dashboard { display: flex; flex-direction: column; gap: 12px; }
        .score-header { background: rgba(0,255,128,0.08); border: 1px solid rgba(0,255,128,0.2); border-radius: 10px; padding: 12px; }
        .score-header.high { border-color: #ff4444; background: rgba(255,68,68,0.1); }
        .score-header.medium { border-color: #ffaa00; background: rgba(255,170,0,0.1); }
        .score-main { display: flex; justify-content: space-between; align-items: center; }
        .score-label { font-size: 11px; color: #888; }
        .score-value { font-size: 24px; font-weight: bold; color: #00ff88; }
        .score-header.high .score-value { color: #ff4444; }
        .score-header.medium .score-value { color: #ffaa00; }
        .score-bar { height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; margin: 8px 0; }
        .score-fill { height: 100%; width: ${combinedScoreWidthPct}%; background: linear-gradient(90deg, #00cc66, #00ff88); border-radius: 3px; transition: width 0.3s; }
        .score-header.high .score-fill { background: linear-gradient(90deg, #ff4444, #ff6666); }
        .ml-class { font-size: 10px; color: #00cc66; }
        .ml-class .confidence { color: #666; margin-left: 4px; }
        .sensor-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        @media (max-width: 800px) { .sensor-grid { grid-template-columns: repeat(3, 1fr); } }
        .sensor-card { background: rgba(0,255,128,0.04); border: 1px solid rgba(0,255,128,0.1); border-radius: 8px; padding: 10px; display: flex; gap: 8px; align-items: center; }
        .sensor-icon { font-size: 20px; }
        .sensor-info { flex: 1; }
        .sensor-name { display: block; font-size: 9px; color: #666; }
        .sensor-value { display: block; font-size: 11px; color: #00cc66; font-weight: 600; }
        .sensor-bar { height: 3px; background: rgba(0,0,0,0.3); border-radius: 2px; margin-top: 4px; }
        .sensor-bar .fill { height: 100%; background: #00ff88; border-radius: 2px; transition: width 0.3s; }
        .sensor-bar .fill-wifi { width: ${wifiWidthPct}%; }
        .sensor-bar .fill-bt { width: ${btWidthPct}%; }
        .sensor-bar .fill-sonar { width: ${sonarWidthPct}%; }
        .sensor-bar .fill-light { width: ${lightWidthPct}%; }
        .sensor-bar .fill-net { width: ${netWidthPct}%; }
        .sensor-bar.shadow div { background: #ff4444; }
        .view-tabs { display: flex; gap: 8px; }
        .view-tabs button { flex: 1; padding: 8px; background: rgba(0,255,128,0.05); border: 1px solid rgba(0,255,128,0.15); border-radius: 6px; color: #666; font-size: 11px; cursor: pointer; transition: all 0.2s; }
        .view-tabs button.active { background: rgba(0,255,128,0.15); border-color: #00ff88; color: #00ff88; }
        .view-content { min-height: 200px; background: rgba(0,0,0,0.2); border-radius: 8px; overflow: hidden; }
        .timeline-view { padding: 12px; }
        .mini-charts { display: flex; gap: 12px; margin-top: 12px; }
        .radar-placeholder { display: flex; align-items: center; justify-content: center; height: 200px; color: #444; font-size: 12px; }
        .loading-3d { display: flex; align-items: center; justify-content: center; height: 400px; color: #00ff88; }
        .anomalies { background: rgba(255,68,68,0.05); border: 1px solid rgba(255,68,68,0.2); border-radius: 8px; padding: 10px; }
        .anomalies h4 { margin: 0 0 8px 0; font-size: 11px; color: #ff6b6b; }
        .anomaly { display: flex; gap: 8px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid rgba(255,68,68,0.1); }
        .anomaly .time { color: #666; }
        .anomaly .msg { color: #ff6b6b; }
        .anomaly.high .msg { color: #ff4444; font-weight: 600; }
      `}</style>
    </div>
  );
}
