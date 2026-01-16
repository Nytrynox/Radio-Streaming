'use client';

import { useState, useEffect, useRef } from 'react';
import { DataExporter } from '../lib/data-export';
import type { SessionEvent, ExportOptions } from '../lib/types';

interface RecordingPanelProps {
  isScanning: boolean;
  onEventCapture?: () => SessionEvent | null;
}

export default function RecordingPanel({ isScanning, onEventCapture }: RecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [startTime, setStartTime] = useState<number>(0);
  const [duration, setDuration] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [isExporting, setIsExporting] = useState(false);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  
  // Update duration while recording
  useEffect(() => {
    if (isRecording && startTime) {
      timerRef.current = setInterval(() => {
        setDuration(Date.now() - startTime);
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording, startTime]);
  
  // Capture events while recording
  useEffect(() => {
    if (!isRecording || !isScanning || !onEventCapture) return;
    
    const event = onEventCapture();
    if (event) {
      setEvents(prev => [...prev, event]);
      setEventCount(prev => prev + 1);
    }
  }, [isRecording, isScanning, onEventCapture]);
  
  const startRecording = () => {
    const now = Date.now();
    setStartTime(now);
    setSessionName(`Session ${new Date(now).toLocaleTimeString()}`);
    setEvents([]);
    setEventCount(0);
    setDuration(0);
    setIsRecording(true);
  };
  
  const stopRecording = () => {
    setIsRecording(false);
    clearInterval(timerRef.current);
  };
  
  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  
  const exportData = async () => {
    if (events.length === 0) return;
    
    setIsExporting(true);
    try {
      const data = exportFormat === 'json' 
        ? JSON.stringify({ session: sessionName, events }, null, 2)
        : events.map(e => `${e.timestamp},${e.type},${JSON.stringify(e.data)}`).join('\n');
      
      const blob = new Blob([data], { type: exportFormat === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName.replace(/\s+/g, '_')}.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    }
    setIsExporting(false);
  };

  return (
    <div className="recording-panel glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">BLACK BOX RECORDER</h3>
        <div className={`status-badge ${isRecording ? 'recording' : ''}`}>
          {isRecording ? '● REC' : '○ IDLE'}
        </div>
      </div>
      
      {!isRecording ? (
        <button className="primary-btn" onClick={startRecording} disabled={!isScanning}>
          <div className="btn-icon">⏺</div>
          <span>INITIATE RECORDING</span>
        </button>
      ) : (
        <div className="active-recording">
          <div className="stats-grid">
            <div className="stat-box">
              <span className="label">DURATION</span>
              <span className="value mono">{formatDuration(duration)}</span>
            </div>
            <div className="stat-box">
              <span className="label">EVENTS</span>
              <span className="value mono">{eventCount}</span>
            </div>
          </div>
          
          <button className="stop-btn" onClick={stopRecording}>
            <div className="btn-icon">⏹</div>
            <span>TERMINATE SESSION</span>
          </button>
        </div>
      )}
      
      {events.length > 0 && !isRecording && (
        <div className="export-section">
          <div className="format-selector">
            <button 
              className={`format-btn ${exportFormat === 'csv' ? 'active' : ''}`}
              onClick={() => setExportFormat('csv')}
            >CSV</button>
            <button 
              className={`format-btn ${exportFormat === 'json' ? 'active' : ''}`}
              onClick={() => setExportFormat('json')}
            >JSON</button>
          </div>
          
          <button className="export-btn" onClick={exportData} disabled={isExporting}>
            {isExporting ? 'EXPORTING...' : `DOWNLOAD ${eventCount} EVENTS`}
          </button>
        </div>
      )}
      
      <style jsx>{`
        .recording-panel {
          padding: 16px;
        }
        
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--glass-border);
        }
        
        .panel-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--accent-secondary);
          margin: 0;
          letter-spacing: 1px;
        }
        
        .status-badge {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.05);
        }
        
        .status-badge.recording {
          color: var(--accent-alert);
          background: rgba(255, 42, 109, 0.1);
          border: 1px solid rgba(255, 42, 109, 0.3);
          animation: pulse 1s infinite;
        }
        
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.6;} }
        
        .primary-btn, .stop-btn, .export-btn {
          width: 100%;
          padding: 12px;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
        }
        
        .primary-btn {
          background: linear-gradient(135deg, var(--accent-primary), #00cc88);
          color: #000;
        }
        
        .primary-btn:hover {
          box-shadow: 0 0 15px rgba(0, 255, 157, 0.3);
        }
        
        .primary-btn:disabled {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.3);
          cursor: not-allowed;
          box-shadow: none;
        }
        
        .active-recording {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        
        .stat-box {
          background: rgba(0, 0, 0, 0.3);
          padding: 8px;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        
        .label { font-size: 8px; color: var(--text-tertiary); margin-bottom: 4px; letter-spacing: 1px; }
        .value { font-size: 14px; color: var(--accent-secondary); }
        .mono { font-family: 'JetBrains Mono', monospace; }
        
        .stop-btn {
          background: rgba(255, 42, 109, 0.15);
          color: var(--accent-alert);
          border: 1px solid var(--accent-alert);
        }
        
        .stop-btn:hover {
          background: rgba(255, 42, 109, 0.25);
          box-shadow: 0 0 15px rgba(255, 42, 109, 0.2);
        }
        
        .export-section {
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--glass-border);
        }
        
        .format-selector {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
        }
        
        .format-btn {
          flex: 1;
          padding: 6px;
          background: transparent;
          border: 1px solid var(--glass-border);
          color: var(--text-tertiary);
          font-size: 10px;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s;
        }
        
        .format-btn:hover { background: rgba(255, 255, 255, 0.05); }
        
        .format-btn.active {
          background: rgba(0, 255, 157, 0.1);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
        }
        
        .export-btn {
          background: rgba(0, 240, 255, 0.1);
          color: var(--accent-secondary);
          border: 1px solid rgba(0, 240, 255, 0.3);
        }
        
        .export-btn:hover {
          background: rgba(0, 240, 255, 0.2);
          box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
