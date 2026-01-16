'use client';

import { useState, useEffect, useRef } from 'react';
import { MotionClassifier, SimpleMotionClassifier } from '../lib/ml-classifier';
import type { MLPrediction, MotionClass, MLModelState } from '../lib/types';

interface MLPanelProps {
  isActive: boolean;
  onPrediction?: (prediction: MLPrediction) => void;
  wifiIntensity: number;
  wifiNetworks: number;
  wifiMovement: boolean;
  rssiDelta: number;
  movementIntensity: number;
}

export default function MLPanel({
  isActive,
  onPrediction,
  wifiIntensity,
  wifiNetworks,
  wifiMovement,
  rssiDelta,
  movementIntensity
}: MLPanelProps) {
  const [isTrainingMode, setIsTrainingMode] = useState(false);
  const [prediction, setPrediction] = useState<MLPrediction | null>(null);
  const [modelState, setModelState] = useState<MLModelState>({
    isLoaded: false,
    isTraining: false,
    accuracy: 0,
    lastPrediction: null,
    trainingProgress: 0
  });
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const classifierRef = useRef<MotionClassifier | null>(null);
  const simpleClassifierRef = useRef<SimpleMotionClassifier | null>(null);
  const lastPredictionTimeRef = useRef(0);
  
  const motionClasses: MotionClass[] = [
    'idle', 'walking', 'running', 'standing', 
    'multiple_people', 'approaching', 'departing', 'unknown'
  ];
  
  const classEmojis: Record<MotionClass, string> = {
    idle: '😴',
    walking: '🚶',
    running: '🏃',
    standing: '🧍',
    multiple_people: '👥',
    approaching: '⏩',
    departing: '⏪',
    unknown: '❓'
  };
  
  useEffect(() => {
    const init = async () => {
      try {
        classifierRef.current = new MotionClassifier();
        await classifierRef.current.initialize();
        simpleClassifierRef.current = new SimpleMotionClassifier();
        setModelState(classifierRef.current.getState());
      } catch (err) {
        console.warn('ML init error:', err);
        setError('Using simple classifier (ML model unavailable)');
        simpleClassifierRef.current = new SimpleMotionClassifier();
      }
    };
    init();
    return () => { classifierRef.current?.dispose(); };
  }, []);
  
  useEffect(() => {
    if (!isActive || isTrainingMode) return;
    
    const now = Date.now();
    if (now - lastPredictionTimeRef.current < 1000) return;
    lastPredictionTimeRef.current = now;
    
    const runPrediction = async () => {
      try {
        const inputData = {
          wifiIntensity,
          wifiNetworks,
          wifiMovement,
          rssiDelta,
          bluetoothDevices: 0,
          bluetoothNearby: 0,
          sonarMovement: movementIntensity,
          sonarDistance: 5,
          lightLevel: 500,
          lightShadow: movementIntensity > 0.3,
          networkActive: wifiNetworks,
          timeSinceLastEvent: 1000
        };
        
        let pred: MLPrediction | null = null;
        
        if (classifierRef.current?.getState().isLoaded) {
          const features = classifierRef.current.extractFeatures(inputData);
          pred = await classifierRef.current.predict(features);
        } else if (simpleClassifierRef.current) {
          const result = simpleClassifierRef.current.classify({
            wifiIntensity,
            bluetoothNearby: 0,
            sonarMovement: movementIntensity,
            lightShadow: movementIntensity > 0.3,
            networkActive: wifiNetworks
          });
          
          pred = {
            timestamp: now,
            class: result.class,
            confidence: result.confidence,
            probabilities: Object.fromEntries(
              motionClasses.map(c => [c, c === result.class ? result.confidence : 0])
            ) as Record<MotionClass, number>,
            features: [wifiIntensity, wifiNetworks, movementIntensity]
          };
        }
        
        if (pred) {
          setPrediction(pred);
          onPrediction?.(pred);
        }
      } catch (err) {
        console.warn('Prediction error:', err);
      }
    };
    
    runPrediction();
  }, [isActive, isTrainingMode, wifiIntensity, wifiNetworks, wifiMovement, rssiDelta, movementIntensity, onPrediction]);
  
  const addTrainingSample = async (label: MotionClass) => {
    if (!classifierRef.current) return;
    const features = classifierRef.current.extractFeatures({
      wifiIntensity, wifiNetworks, wifiMovement, rssiDelta,
      bluetoothDevices: 0, bluetoothNearby: 0, sonarMovement: movementIntensity,
      sonarDistance: 5, lightLevel: 500, lightShadow: movementIntensity > 0.3,
      networkActive: wifiNetworks, timeSinceLastEvent: 1000
    });
    await classifierRef.current.addTrainingSample(features, label);
    setSampleCount(prev => prev + 1);
  };
  
  const trainModel = async () => {
    if (!classifierRef.current || sampleCount < 10) return;
    setModelState(prev => ({ ...prev, isTraining: true }));
    try {
      const accuracy = await classifierRef.current.train((progress) => {
        setTrainingProgress(progress * 100);
      });
      setModelState(prev => ({ ...prev, isTraining: false, accuracy: accuracy * 100 }));
    } catch (err) {
      console.error('Training error:', err);
      setModelState(prev => ({ ...prev, isTraining: false }));
    }
  };
  
  const clearModel = async () => {
    if (!classifierRef.current) return;
    await classifierRef.current.clearModel();
    setSampleCount(0);
    setTrainingProgress(0);
    setModelState(classifierRef.current.getState());
  };

  return (
    <div className="ml-panel glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">NEURAL CORTEX</h3>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={isTrainingMode}
            onChange={(e) => setIsTrainingMode(e.target.checked)}
          />
          <span className="toggle-slider"></span>
          <span className="toggle-label">TRAIN</span>
        </label>
      </div>
      
      {error && <div className="error-msg">{error}</div>}
      
      {/* Current Prediction Display */}
      {prediction && !isTrainingMode && (
        <div className="prediction-display">
          <div className="prediction-main">
            <span className="prediction-icon">{classEmojis[prediction.class]}</span>
            <div className="prediction-info">
              <span className="class-name">{prediction.class.replace('_', ' ').toUpperCase()}</span>
              <div className="confidence-meter">
                <div className="meter-fill" style={{ width: `${prediction.confidence * 100}%` }}></div>
              </div>
              <span className="confidence-text">CONFIDENCE: {(prediction.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          
          <div className="probability-bars">
            {motionClasses.slice(0, 4).map(cls => (
              <div key={cls} className="prob-row">
                <span className="prob-label">{cls.substring(0, 8)}</span>
                <div className="prob-bar">
                  <div 
                    className={`prob-fill ${cls === prediction.class ? 'active' : ''}`}
                    style={{ width: `${(prediction.probabilities[cls] || 0) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Training Mode UI */}
      {isTrainingMode && (
        <div className="training-ui">
          <div className="label-grid">
            {motionClasses.map(cls => (
              <button
                key={cls}
                className="label-btn"
                onClick={() => addTrainingSample(cls)}
                disabled={modelState.isTraining}
              >
                {classEmojis[cls]} {cls.replace('_', ' ')}
              </button>
            ))}
          </div>
          
          <div className="training-stats">
            <div className="stat-box">
              <span className="stat-label">SAMPLES</span>
              <span className="stat-value">{sampleCount}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">ACCURACY</span>
              <span className="stat-value">{modelState.accuracy.toFixed(1)}%</span>
            </div>
          </div>
          
          {modelState.isTraining && (
            <div className="training-progress">
              <div className="progress-bar" style={{ width: `${trainingProgress}%` }} />
              <span className="progress-text">TRAINING... {trainingProgress.toFixed(0)}%</span>
            </div>
          )}
          
          <div className="action-row">
            <button 
              className="action-btn primary"
              onClick={trainModel}
              disabled={sampleCount < 10 || modelState.isTraining}
            >
              INITIATE TRAINING
            </button>
            <button 
              className="action-btn danger"
              onClick={clearModel}
              disabled={modelState.isTraining}
            >
              PURGE DATA
            </button>
          </div>
        </div>
      )}
      
      <style jsx>{`
        .ml-panel {
          padding: 16px;
          min-height: 200px;
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
        
        .toggle-switch {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        
        .toggle-switch input { display: none; }
        
        .toggle-slider {
          width: 32px;
          height: 16px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          position: relative;
          transition: all 0.3s;
        }
        
        .toggle-switch input:checked + .toggle-slider {
          background: var(--accent-primary);
        }
        
        .toggle-slider::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 12px;
          height: 12px;
          background: #fff;
          border-radius: 50%;
          transition: all 0.3s;
        }
        
        .toggle-switch input:checked + .toggle-slider::after {
          transform: translateX(16px);
          background: #000;
        }
        
        .toggle-label {
          font-size: 9px;
          color: var(--text-secondary);
          letter-spacing: 1px;
        }
        
        .prediction-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .prediction-main {
          display: flex;
          align-items: center;
          gap: 16px;
          background: rgba(0, 0, 0, 0.3);
          padding: 12px;
          border-radius: 6px;
          border-left: 2px solid var(--accent-secondary);
        }
        
        .prediction-icon { font-size: 24px; }
        
        .prediction-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .class-name {
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 700;
        }
        
        .confidence-meter {
          height: 2px;
          background: rgba(255, 255, 255, 0.1);
          width: 100%;
        }
        
        .meter-fill {
          height: 100%;
          background: var(--accent-secondary);
          box-shadow: 0 0 5px var(--accent-secondary);
        }
        
        .confidence-text {
          font-size: 9px;
          color: var(--text-tertiary);
        }
        
        .probability-bars {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .prob-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .prob-label {
          font-size: 9px;
          color: var(--text-tertiary);
          width: 50px;
          text-transform: uppercase;
        }
        
        .prob-bar {
          flex: 1;
          height: 4px;
          background: rgba(255, 255, 255, 0.05);
        }
        
        .prob-fill {
          height: 100%;
          background: var(--text-tertiary);
          transition: width 0.3s;
        }
        
        .prob-fill.active {
          background: var(--accent-primary);
          box-shadow: 0 0 5px var(--accent-primary);
        }
        
        .label-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 16px;
        }
        
        .label-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid transparent;
          color: var(--text-secondary);
          padding: 8px;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
          transition: all 0.2s;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .label-btn:hover {
          background: rgba(0, 255, 157, 0.1);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
        }
        
        .training-stats {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }
        
        .stat-box {
          flex: 1;
          background: rgba(0, 0, 0, 0.3);
          padding: 8px;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        
        .stat-label { font-size: 8px; color: var(--text-tertiary); margin-bottom: 2px; }
        .stat-value { font-family: 'JetBrains Mono', monospace; color: var(--accent-primary); font-size: 14px; }
        
        .action-row { display: flex; gap: 8px; }
        
        .action-btn {
          flex: 1;
          padding: 8px;
          border: none;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .action-btn.primary {
          background: var(--accent-primary);
          color: #000;
        }
        
        .action-btn.danger {
          background: rgba(255, 42, 109, 0.2);
          color: var(--accent-alert);
          border: 1px solid var(--accent-alert);
        }
        
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .error-msg {
          font-size: 10px;
          color: var(--accent-alert);
          margin-bottom: 10px;
          padding: 4px;
          background: rgba(255, 42, 109, 0.1);
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
