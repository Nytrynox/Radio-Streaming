'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RealScanResult } from '../lib/real-wifi-scanner';

interface CalibrationProfile {
  id: string;
  name: string;
  createdAt: number;
  baselineRSSI: Record<string, number>;
  movementThreshold: number;
  sensitivity: 'low' | 'medium' | 'high' | 'ultra';
}

interface CalibrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (profile: CalibrationProfile) => void;
  currentScan?: RealScanResult;
}

type Step = 'intro' | 'capture' | 'sensitivity' | 'complete';

export default function CalibrationWizard({ isOpen, onClose, onComplete, currentScan }: CalibrationWizardProps) {
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('Default');
  const [progress, setProgress] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [baselineRSSI, setBaselineRSSI] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high' | 'ultra'>('medium');
  const [threshold, setThreshold] = useState(3.0);

  useEffect(() => {
    if (step !== 'capture' || !isCapturing || !currentScan) return;
    
    const networks = currentScan.currentNetwork 
      ? [currentScan.currentNetwork, ...currentScan.nearbyNetworks]
      : currentScan.nearbyNetworks;
    
    const newHist = { ...history };
    networks.forEach(n => {
      const key = n.bssid || n.ssid;
      if (!key || !Number.isFinite(n.rssi)) return;
      if (!newHist[key]) newHist[key] = [];
      newHist[key].push(n.rssi);
      if (newHist[key].length > 15) newHist[key].shift();
    });
    setHistory(newHist);
    
    const minSamples = Math.min(...Object.values(newHist).map(h => h.length), 15);
    setProgress(Math.min(100, (minSamples / 15) * 100));
    
    if (minSamples >= 15) {
      const baselines: Record<string, number> = {};
      Object.entries(newHist).forEach(([k, v]) => {
        baselines[k] = v.reduce((a, b) => a + b, 0) / v.length;
      });
      setBaselineRSSI(baselines);
      setIsCapturing(false);
      setTimeout(() => setStep('sensitivity'), 500);
    }
  }, [currentScan, step, isCapturing, history]);

  const complete = useCallback(() => {
    const profile: CalibrationProfile = {
      id: `profile-${Date.now()}`,
      name,
      createdAt: Date.now(),
      baselineRSSI,
      movementThreshold: threshold,
      sensitivity
    };
    try {
      const saved = localStorage.getItem('calibration_profiles');
      const profiles = saved ? JSON.parse(saved) : [];
      profiles.push(profile);
      localStorage.setItem('calibration_profiles', JSON.stringify(profiles));
    } catch {}
    onComplete(profile);
    onClose();
  }, [name, baselineRSSI, threshold, sensitivity, onComplete, onClose]);

  if (!isOpen) return null;

  return (
    <div className="overlay scale-in">
      <div className="modal glass-panel">
        <div className="header">
          <h2>SENSOR CALIBRATION PROTOCOL</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="content">
          {step === 'intro' && (
            <div className="step-content fade-in">
              <div className="icon-wrapper">🎯</div>
              <h3>INITIALIZE CALIBRATION</h3>
              <p>Optimize sensor baseline for current environment. Keep area clear of movement.</p>
              
              <div className="input-group">
                <label>PROFILE IDENTIFIER</label>
                <input 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="ENTER NAME..." 
                  className="cyber-input"
                />
              </div>
              
              <button className="primary-btn" onClick={() => setStep('capture')}>
                INITIATE SEQUENCE
              </button>
            </div>
          )}
          
          {step === 'capture' && (
            <div className="step-content fade-in">
              <div className="icon-wrapper spin">📡</div>
              <h3>SIGNAL ACQUISITION</h3>
              <p>Capturing ambient RF baseline. Please remain still.</p>
              
              {!isCapturing ? (
                <button className="primary-btn" onClick={() => setIsCapturing(true)}>
                  BEGIN CAPTURE
                </button>
              ) : (
                <div className="progress-container">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="progress-text">ACQUIRING SAMPLES... {progress.toFixed(0)}%</span>
                </div>
              )}
            </div>
          )}
          
          {step === 'sensitivity' && (
            <div className="step-content fade-in">
              <div className="icon-wrapper">⚙️</div>
              <h3>SENSITIVITY THRESHOLD</h3>
              <p>Select detection sensitivity level.</p>
              
              <div className="grid-options">
                {(['low', 'medium', 'high', 'ultra'] as const).map(s => (
                  <button 
                    key={s} 
                    className={`option-btn ${sensitivity === s ? 'active' : ''}`} 
                    onClick={() => { setSensitivity(s); setThreshold({low:5,medium:3,high:2,ultra:1}[s]); }}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              
              <button className="primary-btn" onClick={() => setStep('complete')}>CONFIRM & PROCEED</button>
            </div>
          )}
          
          {step === 'complete' && (
            <div className="step-content fade-in">
              <div className="icon-wrapper success">✅</div>
              <h3>CALIBRATION SUCCESSFUL</h3>
              <p>Baseline established for {Object.keys(baselineRSSI).length} signal sources.</p>
              
              <div className="summary-box">
                <div className="summary-row">
                  <span>PROFILE</span>
                  <span className="val">{name}</span>
                </div>
                <div className="summary-row">
                  <span>SENSITIVITY</span>
                  <span className="val">{sensitivity.toUpperCase()}</span>
                </div>
              </div>
              
              <button className="primary-btn" onClick={complete}>APPLY CONFIGURATION</button>
            </div>
          )}
        </div>
      </div>
      
      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 5, 16, 0.85);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.3s ease-out;
        }
        
        .modal {
          width: 90%;
          max-width: 420px;
          background: rgba(5, 10, 20, 0.95);
          border: 1px solid var(--accent-primary);
          box-shadow: 0 0 30px rgba(0, 255, 157, 0.15);
          padding: 24px;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--glass-border);
        }
        
        .header h2 {
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          color: var(--accent-primary);
          margin: 0;
          letter-spacing: 1px;
        }
        
        .close-btn {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
          transition: color 0.2s;
        }
        
        .close-btn:hover { color: #fff; }
        
        .step-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        
        .icon-wrapper {
          font-size: 32px;
          margin-bottom: 16px;
        }
        
        .icon-wrapper.spin { animation: spin 2s infinite linear; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        h3 {
          font-family: 'JetBrains Mono', monospace;
          font-size: 16px;
          color: #fff;
          margin: 0 0 8px 0;
        }
        
        p {
          font-size: 12px;
          color: var(--text-secondary);
          margin: 0 0 24px 0;
          line-height: 1.5;
        }
        
        .input-group {
          width: 100%;
          text-align: left;
          margin-bottom: 24px;
        }
        
        .input-group label {
          display: block;
          font-size: 10px;
          color: var(--accent-secondary);
          margin-bottom: 8px;
          letter-spacing: 1px;
        }
        
        .cyber-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--glass-border);
          padding: 12px;
          color: #fff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          border-radius: 4px;
        }
        
        .cyber-input:focus {
          border-color: var(--accent-primary);
          outline: none;
          box-shadow: 0 0 10px rgba(0, 255, 157, 0.2);
        }
        
        .primary-btn {
          width: 100%;
          padding: 14px;
          background: var(--accent-primary);
          color: #000;
          border: none;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          letter-spacing: 1px;
          transition: all 0.2s;
        }
        
        .primary-btn:hover {
          box-shadow: 0 0 20px rgba(0, 255, 157, 0.4);
          transform: translateY(-1px);
        }
        
        .progress-container {
          width: 100%;
          margin-bottom: 16px;
        }
        
        .progress-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        
        .progress-fill {
          height: 100%;
          background: var(--accent-primary);
          transition: width 0.3s ease;
          box-shadow: 0 0 10px var(--accent-primary);
        }
        
        .progress-text {
          font-size: 10px;
          color: var(--accent-primary);
          font-family: 'JetBrains Mono', monospace;
        }
        
        .grid-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          width: 100%;
          margin-bottom: 24px;
        }
        
        .option-btn {
          padding: 12px;
          background: transparent;
          border: 1px solid var(--glass-border);
          color: var(--text-secondary);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s;
        }
        
        .option-btn:hover {
          border-color: var(--accent-secondary);
          color: #fff;
        }
        
        .option-btn.active {
          background: rgba(0, 240, 255, 0.15);
          border-color: var(--accent-secondary);
          color: var(--accent-secondary);
          font-weight: 700;
          box-shadow: 0 0 15px rgba(0, 240, 255, 0.15);
        }
        
        .summary-box {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          padding: 16px;
          border-radius: 6px;
          margin-bottom: 24px;
        }
        
        .summary-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 11px;
        }
        
        .summary-row:last-child { margin-bottom: 0; }
        
        .summary-row span:first-child { color: var(--text-tertiary); }
        .summary-row .val { color: var(--accent-primary); font-family: 'JetBrains Mono', monospace; }
        
        .fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
