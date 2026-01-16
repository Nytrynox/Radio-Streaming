'use client';

import { useState } from 'react';
import type { FeatureSettings } from '../lib/types';

interface SettingsProps {
  settings: FeatureSettings;
  onChange: (settings: FeatureSettings) => void;
  onClose: () => void;
}

const defaultSettings: FeatureSettings = {
  wifi: { enabled: true, scanInterval: 2000 },
  bluetooth: { enabled: true, scanInterval: 5000 },
  sonar: { enabled: false, frequency: 19000, sensitivity: 0.5 },
  light: { enabled: true, threshold: 15 },
  network: { enabled: true, scanInterval: 10000 },
  ml: { enabled: true, autoClassify: true },
  triangulation: { enabled: true },
  recording: { autoStart: false, maxDuration: 3600000 },
  powerSaving: { enabled: true, reducedInterval: 6000 },
};

export default function Settings({ settings, onChange, onClose }: SettingsProps) {
  const [localSettings, setLocalSettings] = useState<FeatureSettings>({ ...defaultSettings, ...settings });

  const updateSetting = <K extends keyof FeatureSettings>(
    category: K,
    key: keyof FeatureSettings[K],
    value: any
  ) => {
    setLocalSettings(prev => ({
      ...prev,
      [category]: { ...prev[category], [key]: value },
    }));
  };

  const handleSave = () => {
    onChange(localSettings);
    onClose();
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>⚙️ Advanced Settings</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-content">
          {/* WiFi Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>📶 WiFi Scanning</span>
              <input type="checkbox" checked={localSettings.wifi.enabled} onChange={e => updateSetting('wifi', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Scan Interval</label>
              <input type="range" min={500} max={10000} step={500} value={localSettings.wifi.scanInterval} onChange={e => updateSetting('wifi', 'scanInterval', +e.target.value)} />
              <span>{localSettings.wifi.scanInterval}ms</span>
            </div>
          </div>

          {/* Bluetooth Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>📱 Bluetooth Detection</span>
              <input type="checkbox" checked={localSettings.bluetooth.enabled} onChange={e => updateSetting('bluetooth', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Scan Interval</label>
              <input type="range" min={2000} max={30000} step={1000} value={localSettings.bluetooth.scanInterval} onChange={e => updateSetting('bluetooth', 'scanInterval', +e.target.value)} />
              <span>{localSettings.bluetooth.scanInterval / 1000}s</span>
            </div>
          </div>

          {/* Sonar Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>🔊 Audio Sonar</span>
              <input type="checkbox" checked={localSettings.sonar.enabled} onChange={e => updateSetting('sonar', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Frequency</label>
              <input type="range" min={17000} max={21000} step={500} value={localSettings.sonar.frequency} onChange={e => updateSetting('sonar', 'frequency', +e.target.value)} />
              <span>{localSettings.sonar.frequency}Hz</span>
            </div>
            <div className="setting-row">
              <label>Sensitivity</label>
              <input type="range" min={0.1} max={1} step={0.1} value={localSettings.sonar.sensitivity} onChange={e => updateSetting('sonar', 'sensitivity', +e.target.value)} />
              <span>{(localSettings.sonar.sensitivity * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Light Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>💡 Ambient Light</span>
              <input type="checkbox" checked={localSettings.light.enabled} onChange={e => updateSetting('light', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Shadow Threshold</label>
              <input type="range" min={5} max={50} step={5} value={localSettings.light.threshold} onChange={e => updateSetting('light', 'threshold', +e.target.value)} />
              <span>{localSettings.light.threshold}%</span>
            </div>
          </div>

          {/* ML Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>🤖 ML Classification</span>
              <input type="checkbox" checked={localSettings.ml.enabled} onChange={e => updateSetting('ml', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Auto-classify</label>
              <input type="checkbox" checked={localSettings.ml.autoClassify} onChange={e => updateSetting('ml', 'autoClassify', e.target.checked)} />
            </div>
          </div>

          {/* Power Settings */}
          <div className="setting-group">
            <div className="group-header">
              <span>🔋 Power Saving</span>
              <input type="checkbox" checked={localSettings.powerSaving.enabled} onChange={e => updateSetting('powerSaving', 'enabled', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label>Reduced Interval</label>
              <input type="range" min={3000} max={30000} step={1000} value={localSettings.powerSaving.reducedInterval} onChange={e => updateSetting('powerSaving', 'reducedInterval', +e.target.value)} />
              <span>{localSettings.powerSaving.reducedInterval / 1000}s</span>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save Settings</button>
        </div>
      </div>

      <style jsx>{`
        .settings-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex;
          align-items: center; justify-content: center; z-index: 1000;
        }
        .settings-panel {
          background: #0a1a10; border: 1px solid rgba(0,255,128,0.3);
          border-radius: 12px; width: 90%; max-width: 500px; max-height: 80vh; overflow: hidden;
        }
        .settings-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px; border-bottom: 1px solid rgba(0,255,128,0.15);
        }
        .settings-header h2 { margin: 0; font-size: 16px; color: #00ff88; }
        .close-btn { background: none; border: none; color: #666; font-size: 20px; cursor: pointer; }
        .settings-content { padding: 16px; overflow-y: auto; max-height: 50vh; }
        .setting-group {
          background: rgba(0,255,128,0.04); border: 1px solid rgba(0,255,128,0.1);
          border-radius: 8px; padding: 12px; margin-bottom: 12px;
        }
        .group-header { display: flex; justify-content: space-between; align-items: center; color: #00cc66; font-size: 12px; margin-bottom: 10px; }
        .setting-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 11px; color: #888; }
        .setting-row label { flex: 1; }
        .setting-row input[type="range"] { flex: 2; accent-color: #00ff88; }
        .setting-row input[type="checkbox"] { accent-color: #00ff88; }
        .setting-row span { width: 60px; text-align: right; color: #00cc66; }
        .settings-footer { display: flex; gap: 12px; padding: 16px; border-top: 1px solid rgba(0,255,128,0.15); }
        .btn-cancel { flex: 1; padding: 10px; background: transparent; border: 1px solid #444; border-radius: 6px; color: #888; cursor: pointer; }
        .btn-save { flex: 1; padding: 10px; background: linear-gradient(135deg, #00cc66, #00ff88); border: none; border-radius: 6px; color: #000; font-weight: 600; cursor: pointer; }
      `}</style>
    </div>
  );
}

export { defaultSettings };
