'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import LiveRadar from '../components/LiveRadar';
import ThermalView from '../components/ThermalView';
import MLPanel from '../components/MLPanel';
import RecordingPanel from '../components/RecordingPanel';
import CalibrationWizard from '../components/CalibrationWizard';
import { RealWifiScanner, RealWifiAnalyzer, RealScanResult, DetectedObject, RealWifiNetwork } from '../lib/real-wifi-scanner';
import { AdvancedCSIEngine, CSIAnalysisResult, PresenceZone } from '../lib/advanced-csi-engine';
import type { MLPrediction, MotionClass } from '../lib/types';

const Room3D = dynamic(() => import('../components/Room3D'), { ssr: false, loading: () => <div className="loading-3d">Loading 3D View...</div> });

export default function Home() {
  // State - ALL REAL DATA
  const [isScanning, setIsScanning] = useState(false);
  const [activeView, setActiveView] = useState<'radar' | '3d' | 'thermal'>('radar');
  const [range, setRange] = useState(15);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [signalQuality, setSignalQuality] = useState(0);
  const [networkCount, setNetworkCount] = useState(0);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('--:--:--');
  const [movementDetected, setMovementDetected] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState<RealWifiNetwork | null>(null);
  const [nearbyNetworks, setNearbyNetworks] = useState<RealWifiNetwork[]>([]);
  const [avgRSSI, setAvgRSSI] = useState(-90);
  const [scanCount, setScanCount] = useState(0);
  const [lastScanTime, setLastScanTime] = useState('');
  const [rssiHistory, setRssiHistory] = useState<number[]>([]);
  const [movementIntensity, setMovementIntensity] = useState(0);
  const [liveLog, setLiveLog] = useState<{ time: string; msg: string; type: string }[]>([]);
  
  // New enhanced features state
  const [csiResult, setCsiResult] = useState<CSIAnalysisResult | null>(null);
  const [presenceZones, setPresenceZones] = useState<PresenceZone[]>([]);
  const [direction, setDirection] = useState<'approaching' | 'departing' | 'lateral' | 'stationary' | 'unknown'>('unknown');
  const [mlPrediction, setMlPrediction] = useState<MLPrediction | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  const [colorMode, setColorMode] = useState<'thermal' | 'nightvision' | 'radar'>('thermal');
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high' | 'ultra'>('medium');
  const [currentScan, setCurrentScan] = useState<RealScanResult | null>(null);
  
  // Refs
  const wifiScannerRef = useRef<RealWifiScanner | null>(null);
  const wifiAnalyzerRef = useRef<RealWifiAnalyzer | null>(null);
  const csiEngineRef = useRef<AdvancedCSIEngine | null>(null);
  const prevRSSIRef = useRef<Map<string, number>>(new Map());
  
  // Add log entry
  const addLog = useCallback((msg: string, type: string = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLiveLog(prev => [...prev.slice(-15), { time, msg, type }]);
  }, []);
  
  // Update time
  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString());
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Initialize
  useEffect(() => {
    wifiScannerRef.current = new RealWifiScanner();
    wifiAnalyzerRef.current = new RealWifiAnalyzer();
    csiEngineRef.current = new AdvancedCSIEngine({ sensitivityLevel: sensitivity });
    return () => wifiScannerRef.current?.stop();
  }, []);
  
  // Handle REAL WiFi scan
  const handleRealWifiScan = useCallback((scanResult: RealScanResult) => {
    setLastScanTime(new Date(scanResult.timestamp).toLocaleTimeString());
    setScanCount(prev => prev + 1);
    
    const allNetworks = scanResult.currentNetwork 
      ? [scanResult.currentNetwork, ...scanResult.nearbyNetworks]
      : scanResult.nearbyNetworks;
    
    setCurrentNetwork(scanResult.currentNetwork);
    setNearbyNetworks(scanResult.nearbyNetworks);
    setNetworkCount(allNetworks.length);
    
    // Calculate movement intensity from REAL signal changes
    let totalChange = 0;
    let changeCount = 0;
    
    allNetworks.forEach(network => {
      const key = network.ssid || network.bssid;
      const prevRSSI = prevRSSIRef.current.get(key);
      
      if (prevRSSI !== undefined) {
        const delta = network.rssi - prevRSSI;
        const absChange = Math.abs(delta);
        totalChange += absChange;
        changeCount++;
      }
      prevRSSIRef.current.set(key, network.rssi);
    });
    
    // Update RSSI history for graph
    const currentAvgRSSI = allNetworks.reduce((acc, n) => acc + n.rssi, 0) / (allNetworks.length || 1);
    setAvgRSSI(currentAvgRSSI);
    setRssiHistory(prev => [...prev.slice(-50), currentAvgRSSI]);
    
    // Process with Standard Analyzer
    const analysis = wifiAnalyzerRef.current?.processScan(scanResult);
    if (analysis) {
      setDetectedObjects(analysis.objects);
      setSignalQuality(analysis.signalQuality);
      setIsCalibrated(analysis.isCalibrated);
      setCalibrationProgress(analysis.calibrationProgress);
      
      const intensity = Math.min(1, totalChange / 20); // Scale factor
      setMovementIntensity(intensity);
      setMovementDetected(intensity > 0.3);
      
      // Log significant events
      if (intensity > 0.5) {
        addLog(`High movement intensity: ${(intensity * 100).toFixed(0)}%`, 'alert');
      }
      if (analysis.objects.length > 0) {
        // addLog(`Detected ${analysis.detectedObjects.length} signal anomalies`, 'detection');
      }
      
      // Process with ADVANCED CSI Engine
      const csiAnalysis = csiEngineRef.current?.analyze(scanResult);
      if (csiAnalysis) {
        setCsiResult(csiAnalysis);
        setPresenceZones(csiAnalysis.presenceZones);
        setDirection(csiAnalysis.direction);
        
        // Merge enhanced objects
        if (csiAnalysis.objects.length > 0) {
          setDetectedObjects(prev => {
            // Simple merge: prefer enhanced objects
            return [...csiAnalysis.objects];
          });
        }
        
        // Use CSI intensity if higher than basic calculation
        if (csiAnalysis.movementIntensity > intensity) {
          setMovementIntensity(prev => prev * 0.5 + csiAnalysis.movementIntensity * 0.5);
        }
      }
    }
    
    // Store current scan for calibration wizard
    setCurrentScan(scanResult);
  }, [addLog, movementDetected]);
  
  // Start/stop scanning
  useEffect(() => {
    if (isScanning) {
      wifiAnalyzerRef.current?.reset();
      prevRSSIRef.current.clear();
      setScanCount(0);
      setRssiHistory([]);
      setMovementIntensity(0);
      addLog('Starting REAL WiFi scan...', 'info');
      
      // Faster scanning for more responsive detection
      wifiScannerRef.current?.start(handleRealWifiScan, 1500);
    } else {
      wifiScannerRef.current?.stop();
      if (scanCount > 0) addLog('Scan stopped', 'info');
    }
    
    return () => wifiScannerRef.current?.stop();
  }, [isScanning, handleRealWifiScan, addLog, scanCount]);

  const intensityWidthPct = Math.max(0, Math.min(100, movementIntensity * 100));
  const signalLevelWidthPct = currentNetwork ? Math.max(0, Math.min(100, (currentNetwork.rssi + 90) * 2)) : 0;

  return (
    <main className="dashboard-grid">
      {/* Header Area */}
      <header className="header-area glass-panel">
        <div className="logo-section">
          <div className="logo-icon-wrapper">
            <span className="logo-icon">📡</span>
            <div className="scanner-line"></div>
          </div>
          <div className="logo-text">
            <h1>WIFI RADAR <span className="pro-badge">PRO</span></h1>
            <span className="subtitle">ADVANCED CSI SURVEILLANCE SYSTEM</span>
          </div>
        </div>
        
        <div className="header-stats">
          <div className="stat-pill glass-panel">
            <span className="label">NETWORKS</span>
            <span className="value neon-blue">{networkCount}</span>
          </div>
          <div className="stat-pill glass-panel">
            <span className="label">SIGNAL AVG</span>
            <span className="value neon-green">{avgRSSI.toFixed(0)} <small>dBm</small></span>
          </div>
          <div className="stat-pill glass-panel">
            <span className="label">SYSTEM TIME</span>
            <span className="value mono">{currentTime}</span>
          </div>
        </div>

        <div className="status-indicator">
          <div className={`status-dot ${isScanning ? 'active' : ''}`}></div>
          <span className="status-text">{isScanning ? 'SYSTEM ACTIVE' : 'STANDBY'}</span>
        </div>
      </header>
      
      {/* Main Viewport */}
      <section className="viewport-area glass-panel">
        <div className="viewport-header">
          <div className="tabs">
            <button 
              className={`tab-btn ${activeView === 'radar' ? 'active' : ''}`}
              onClick={() => setActiveView('radar')}
            >
              <span className="icon">📡</span> RADAR
            </button>
            <button 
              className={`tab-btn ${activeView === '3d' ? 'active' : ''}`}
              onClick={() => setActiveView('3d')}
            >
              <span className="icon">🎮</span> 3D SPACE
            </button>
            <button 
              className={`tab-btn ${activeView === 'thermal' ? 'active' : ''}`}
              onClick={() => setActiveView('thermal')}
            >
              <span className="icon">🔥</span> THERMAL
            </button>
          </div>
          
          <div className="viewport-status">
            {movementDetected && (
              <div className="alert-badge pulse-red">
                ⚠️ MOTION DETECTED
              </div>
            )}
            <span className="scan-id mono">SCAN ID: #{scanCount.toString().padStart(4, '0')}</span>
          </div>
        </div>

        <div className="viewport-content">
          {activeView === 'radar' && (
            <LiveRadar
              isActive={isScanning}
              detectedObjects={detectedObjects}
              signalStrength={signalQuality}
              range={range}
              networkCount={networkCount}
              isCalibrated={isCalibrated}
              calibrationProgress={calibrationProgress}
              rssiHistory={rssiHistory}
              movementIntensity={movementIntensity}
            />
          )}
          {activeView === '3d' && (
            <Room3D
              detectedObjects={detectedObjects}
              movementIntensity={movementIntensity}
              isActive={isScanning}
            />
          )}
          {activeView === 'thermal' && (
            <ThermalView
              isActive={isScanning}
              movementIntensity={movementIntensity}
              signalQuality={signalQuality}
              detectedObjects={detectedObjects}
              presenceZones={presenceZones}
              direction={direction}
              colorMode={colorMode}
            />
          )}
          
          {/* Overlay HUD Elements */}
          <div className="hud-corners">
            <svg className="corner tl" viewBox="0 0 20 20"><path d="M1 19V1H19" /></svg>
            <svg className="corner tr" viewBox="0 0 20 20"><path d="M1 1V19H19" /></svg>
            <svg className="corner bl" viewBox="0 0 20 20"><path d="M19 1H1V19" /></svg>
            <svg className="corner br" viewBox="0 0 20 20"><path d="M19 19V1H1" /></svg>
          </div>
        </div>
      </section>
      
      {/* Sidebar Command Center */}
      <aside className="sidebar-area">
        {/* Primary Controls */}
        <div className="control-panel glass-panel">
          <h3 className="panel-title">COMMAND PRIMARY</h3>
          
          <button
            className={`mission-btn ${isScanning ? 'abort' : 'launch'}`}
            onClick={() => setIsScanning(p => !p)}
          >
            <div className="btn-content">
              <span className="icon">{isScanning ? '⏹' : '▶'}</span>
              <span className="text">{isScanning ? 'ABORT SCAN' : 'INITIATE SCAN'}</span>
            </div>
            <div className="btn-glitch"></div>
          </button>
          
          <div className="parameter-group">
            <label>SENSITIVITY LEVEL</label>
            <div className="sensitivity-selector">
              {['low', 'medium', 'high', 'ultra'].map((level) => (
                <button
                  key={level}
                  className={`level-btn ${sensitivity === level ? 'active' : ''}`}
                  onClick={() => {
                    setSensitivity(level as any);
                    csiEngineRef.current?.setSensitivity(level as any);
                  }}
                >
                  {level.charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          
          <div className="parameter-group">
            <label>DETECTION RANGE: {range}m</label>
            <input
              type="range"
              min="5"
              max="30"
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
              className="cyber-range"
            />
          </div>

          <button className="secondary-btn" onClick={() => setShowCalibration(true)}>
            <span>🎯</span> CALIBRATE SENSORS
          </button>
        </div>

        {/* Live Metrics */}
        <div className="metrics-panel glass-panel">
          <h3 className="panel-title">TELEMETRY</h3>
          <div className="telemetry-grid">
            <div className="telemetry-item">
              <span className="label">QUALITY</span>
              <div className="bar-container">
                <div className="bar-fill" style={{ width: `${signalQuality}%`, background: 'var(--accent-primary)' }}></div>
              </div>
              <span className="value">{signalQuality}%</span>
            </div>
            <div className="telemetry-item">
              <span className="label">INTENSITY</span>
              <div className="bar-container">
                <div className="bar-fill" style={{ width: `${movementIntensity * 100}%`, background: 'var(--accent-alert)' }}></div>
              </div>
              <span className="value">{(movementIntensity * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Modules */}
        <div className="modules-container">
          <MLPanel
            isActive={isScanning}
            onPrediction={(pred) => setMlPrediction(pred)}
            wifiIntensity={movementIntensity}
            wifiNetworks={networkCount}
            wifiMovement={movementDetected}
            rssiDelta={csiResult?.avgVariance ?? 0}
            movementIntensity={movementIntensity}
          />
          
          <RecordingPanel
            isScanning={isScanning}
            onEventCapture={() => currentScan ? {
              timestamp: Date.now(),
              type: 'sensor_fusion',
              data: {
                wifi: { intensity: movementIntensity, networks: networkCount, movement: movementDetected },
                ml: mlPrediction,
                direction,
                zones: presenceZones
              }
            } : null}
          />
        </div>

        {/* Console Log */}
        <div className="console-panel glass-panel">
          <h3 className="panel-title">SYSTEM LOG</h3>
          <div className="console-output mono">
            {liveLog.length === 0 && <span className="log-empty">System Ready. Waiting for input...</span>}
            {liveLog.map((entry, i) => (
              <div key={i} className={`log-line ${entry.type}`}>
                <span className="timestamp">[{entry.time}]</span>
                <span className="message">{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
      
      {/* Calibration Wizard Modal */}
      <CalibrationWizard
        isOpen={showCalibration}
        onClose={() => setShowCalibration(false)}
        onComplete={(profile) => {
          csiEngineRef.current?.setSensitivity(profile.sensitivity);
          setSensitivity(profile.sensitivity);
        }}
        currentScan={currentScan ?? undefined}
      />
      
      <style jsx>{`
        /* Layout */
        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          grid-template-rows: auto 1fr;
          grid-template-areas:
            "header header"
            "viewport sidebar";
          height: 100vh;
          width: 100vw;
          padding: 16px;
          gap: 16px;
          max-width: 1920px;
          margin: 0 auto;
        }

        /* Header Area */
        .header-area {
          grid-area: header;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 24px;
          height: 80px;
          position: relative;
          overflow: hidden;
        }

        .header-area::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
          opacity: 0.5;
        }

        .logo-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .logo-icon-wrapper {
          position: relative;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.4);
          border-radius: 50%;
          border: 1px solid var(--accent-primary);
          box-shadow: 0 0 15px rgba(0, 255, 157, 0.2);
        }

        .logo-icon { font-size: 24px; }
        .scanner-line {
          position: absolute;
          width: 100%;
          height: 2px;
          background: var(--accent-primary);
          animation: scan 2s linear infinite;
          box-shadow: 0 0 8px var(--accent-primary);
        }

        @keyframes scan {
          0% { top: 0; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }

        .logo-text h1 {
          font-family: 'JetBrains Mono', monospace;
          font-size: 24px;
          letter-spacing: -1px;
          color: var(--text-primary);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pro-badge {
          background: var(--accent-secondary);
          color: #000;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 800;
          letter-spacing: 1px;
        }

        .subtitle {
          font-size: 10px;
          color: var(--text-tertiary);
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .header-stats {
          display: flex;
          gap: 16px;
        }

        .stat-pill {
          display: flex;
          flex-direction: column;
          padding: 8px 16px;
          min-width: 120px;
        }

        .stat-pill .label {
          font-size: 9px;
          color: var(--text-secondary);
          letter-spacing: 1px;
          margin-bottom: 2px;
        }

        .stat-pill .value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 16px;
          font-weight: 700;
        }

        .neon-blue { color: var(--accent-secondary); text-shadow: 0 0 10px rgba(0, 240, 255, 0.4); }
        .neon-green { color: var(--accent-primary); text-shadow: 0 0 10px rgba(0, 255, 157, 0.4); }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border: 1px solid var(--glass-border);
          border-radius: 20px;
          background: rgba(0, 0, 0, 0.3);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          background: #444;
          border-radius: 50%;
        }

        .status-dot.active {
          background: var(--accent-primary);
          box-shadow: 0 0 10px var(--accent-primary);
          animation: pulse-glow 1.5s infinite;
        }

        .status-text {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1px;
          color: var(--text-secondary);
        }

        /* Viewport Area */
        .viewport-area {
          grid-area: viewport;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }

        .viewport-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid var(--glass-border);
        }

        .tabs { display: flex; gap: 8px; }

        .tab-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary);
          padding: 8px 16px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 4px;
        }

        .tab-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .tab-btn.active {
          background: rgba(0, 255, 157, 0.1);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
          box-shadow: 0 0 15px rgba(0, 255, 157, 0.1);
        }

        .viewport-status {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .alert-badge {
          background: rgba(255, 42, 109, 0.15);
          color: var(--accent-alert);
          border: 1px solid var(--accent-alert);
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .pulse-red { animation: pulse-alert 1s infinite alternate; }
        @keyframes pulse-alert {
          from { opacity: 0.6; box-shadow: 0 0 5px var(--accent-alert); }
          to { opacity: 1; box-shadow: 0 0 20px var(--accent-alert); }
        }

        .scan-id { font-size: 10px; color: var(--text-tertiary); }

        .viewport-content {
          flex: 1;
          position: relative;
          background: radial-gradient(circle at center, rgba(0,20,40,0.3) 0%, rgba(0,0,0,0.6) 100%);
        }

        /* HUD Overlay */
        .hud-corners {
          position: absolute;
          inset: 16px;
          pointer-events: none;
          z-index: 10;
        }

        .corner {
          position: absolute;
          width: 20px;
          height: 20px;
          fill: none;
          stroke: var(--accent-secondary);
          stroke-width: 2px;
          opacity: 0.5;
        }
        .tl { top: 0; left: 0; }
        .tr { top: 0; right: 0; }
        .bl { bottom: 0; left: 0; }
        .br { bottom: 0; right: 0; }

        /* Sidebar Area */
        .sidebar-area {
          grid-area: sidebar;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .panel-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--accent-secondary);
          margin-bottom: 12px;
          letter-spacing: 1px;
          border-bottom: 1px solid var(--glass-border);
          padding-bottom: 8px;
        }

        .control-panel, .metrics-panel, .console-panel {
          padding: 16px;
        }

        .mission-btn {
          width: 100%;
          padding: 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          margin-bottom: 20px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          letter-spacing: 2px;
          transition: all 0.3s;
        }

        .mission-btn.launch {
          background: linear-gradient(135deg, var(--accent-primary), #00cc88);
          color: #000;
          box-shadow: 0 0 20px rgba(0, 255, 157, 0.3);
        }
        
        .mission-btn.abort {
          background: linear-gradient(135deg, var(--accent-alert), #cc0044);
          color: #fff;
          box-shadow: 0 0 20px rgba(255, 42, 109, 0.3);
        }

        .mission-btn:hover { transform: scale(1.02); }
        .mission-btn:active { transform: scale(0.98); }

        .btn-content { display: flex; align-items: center; justify-content: center; gap: 12px; position: relative; z-index: 2; }
        .icon { font-size: 18px; }

        .parameter-group { margin-bottom: 16px; }
        .parameter-group label {
          display: block;
          font-size: 10px;
          color: var(--text-secondary);
          margin-bottom: 8px;
          letter-spacing: 1px;
        }

        .sensitivity-selector {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          padding: 2px;
          gap: 2px;
        }

        .level-btn {
          background: transparent;
          border: none;
          color: var(--text-tertiary);
          padding: 6px;
          font-size: 10px;
          cursor: pointer;
          border-radius: 2px;
          transition: all 0.2s;
        }

        .level-btn.active {
          background: var(--accent-primary);
          color: #000;
          font-weight: 700;
        }

        .cyber-range {
          width: 100%;
          -webkit-appearance: none;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          outline: none;
        }

        .cyber-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          background: var(--accent-secondary);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px var(--accent-secondary);
          transition: transform 0.1s;
        }
        .cyber-range::-webkit-slider-thumb:hover { transform: scale(1.2); }

        .secondary-btn {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--glass-border);
          color: var(--text-secondary);
          padding: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s;
        }
        .secondary-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: var(--text-tertiary);
          color: var(--text-primary);
        }

        .telemetry-grid { display: grid; gap: 12px; }
        
        .telemetry-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(0, 0, 0, 0.2);
          padding: 8px;
          border-radius: 4px;
        }

        .telemetry-item .label { font-size: 9px; color: var(--text-tertiary); width: 60px; }
        
        .bar-container {
          flex: 1;
          height: 4px;
          background: rgba(255, 255, 255, 0.05);
          margin: 0 12px;
          border-radius: 2px;
          overflow: hidden;
        }

        .bar-fill { height: 100%; transition: width 0.3s ease-out; }

        .telemetry-item .value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-primary);
          width: 30px;
          text-align: right;
        }

        .modules-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .console-output {
          height: 120px;
          overflow-y: auto;
          font-size: 10px;
        }

        .log-line {
          margin-bottom: 4px;
          display: flex;
          gap: 8px;
        }

        .log-line .timestamp { color: var(--text-tertiary); }
        .log-line.info .message { color: var(--accent-secondary); }
        .log-line.alert .message { color: var(--accent-alert); }
        .log-line.success .message { color: var(--accent-primary); }

        @media (max-width: 1200px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
            grid-template-areas:
              "header"
              "viewport"
              "sidebar";
          }
          .sidebar-area { max-height: 400px; padding-right: 0; }
        }
      `}</style>
    </main>
  );
}
