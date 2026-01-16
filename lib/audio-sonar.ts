// ============================================================================
// AUDIO SONAR DETECTION
// Uses Web Audio API for ultrasonic movement detection and sound events
// ============================================================================

import type { SonarReading, AudioEvent, SonarState } from './types';

export class AudioSonar {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private isRunning = false;
  private sonarFrequency = 19000; // 19kHz - inaudible to most humans
  private baselineAmplitude = 0;
  private calibrationSamples: number[] = [];
  private readonly calibrationCount = 30;
  private callbacks: {
    onReading?: (reading: SonarReading) => void;
    onEvent?: (event: AudioEvent) => void;
  } = {};

  public async start(options: {
    frequency?: number;
    sensitivity?: number;
    onReading?: (reading: SonarReading) => void;
    onEvent?: (event: AudioEvent) => void;
  } = {}) {
    if (this.isRunning) return;

    this.sonarFrequency = options.frequency || 19000;
    this.callbacks = { onReading: options.onReading, onEvent: options.onEvent };

    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create oscillator for ultrasonic tone
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.type = 'sine';
      this.oscillator.frequency.setValueAtTime(this.sonarFrequency, this.audioContext.currentTime);

      // Create gain node to control volume
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime); // Low volume

      // Connect oscillator -> gain -> output
      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Create analyser for microphone input
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.3;

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false, 
          autoGainControl: false 
        } 
      });
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);

      // Start oscillator
      this.oscillator.start();
      this.isRunning = true;

      // Start analysis loop
      this.analyze();

      console.log('Audio Sonar started at', this.sonarFrequency, 'Hz');
    } catch (err) {
      console.error('Failed to start Audio Sonar:', err);
      throw err;
    }
  }

  public stop() {
    this.isRunning = false;
    
    if (this.oscillator) {
      this.oscillator.stop();
      this.oscillator.disconnect();
      this.oscillator = null;
    }
    
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.calibrationSamples = [];
    this.baselineAmplitude = 0;
  }

  private analyze() {
    if (!this.isRunning || !this.analyser || !this.audioContext) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const frequencyData = new Float32Array(bufferLength);
    const timeData = new Float32Array(bufferLength);
    
    this.analyser.getFloatFrequencyData(frequencyData);
    this.analyser.getFloatTimeDomainData(timeData);

    // Find the bin for our sonar frequency
    const nyquist = this.audioContext.sampleRate / 2;
    const binWidth = nyquist / bufferLength;
    const sonarBin = Math.round(this.sonarFrequency / binWidth);

    // Get amplitude at sonar frequency (and neighboring bins)
    let sonarAmplitude = 0;
    for (let i = Math.max(0, sonarBin - 2); i <= Math.min(bufferLength - 1, sonarBin + 2); i++) {
      sonarAmplitude = Math.max(sonarAmplitude, frequencyData[i]);
    }
    
    // Convert from dB to linear
    const linearAmplitude = Math.pow(10, sonarAmplitude / 20);

    // Calibration phase
    if (this.calibrationSamples.length < this.calibrationCount) {
      this.calibrationSamples.push(linearAmplitude);
      if (this.calibrationSamples.length === this.calibrationCount) {
        this.baselineAmplitude = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationCount;
        console.log('Sonar calibrated. Baseline:', this.baselineAmplitude);
      }
    } else {
      // Calculate movement score based on deviation from baseline
      const deviation = Math.abs(linearAmplitude - this.baselineAmplitude);
      const movementScore = Math.min(1, deviation / (this.baselineAmplitude * 0.5 || 1));

      // Estimate distance (very rough - based on amplitude decay)
      const distanceEstimate = Math.max(0.5, Math.min(10, 3 / (linearAmplitude + 0.001)));

      const reading: SonarReading = {
        timestamp: Date.now(),
        frequency: this.sonarFrequency,
        amplitude: linearAmplitude,
        echoDelay: 0, // Would need more sophisticated processing
        movementScore,
        distanceEstimate,
      };

      this.callbacks.onReading?.(reading);

      // Detect audio events from time domain data
      this.detectAudioEvents(timeData);
    }

    // Continue loop
    requestAnimationFrame(() => this.analyze());
  }

  private detectAudioEvents(timeData: Float32Array) {
    // Calculate RMS volume
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      sum += timeData[i] * timeData[i];
    }
    const rms = Math.sqrt(sum / timeData.length);
    const volumeDb = 20 * Math.log10(rms + 0.0001);

    // Detect sudden loud sounds
    if (volumeDb > -30) { // Threshold for "loud" sound
      const event = this.classifyAudioEvent(timeData, volumeDb);
      if (event) {
        this.callbacks.onEvent?.(event);
      }
    }
  }

  private lastEventTime = 0;
  private readonly eventCooldownMs = 500;

  private classifyAudioEvent(timeData: Float32Array, volumeDb: number): AudioEvent | null {
    const now = Date.now();
    if (now - this.lastEventTime < this.eventCooldownMs) return null;
    
    // Simple classification based on volume and pattern
    // In a real implementation, you'd use ML for better classification
    let type: AudioEvent['type'] = 'unknown';
    let confidence = 0.5;

    if (volumeDb > -20) {
      // Very loud - likely impact or door
      type = 'impact';
      confidence = 0.7;
    } else if (volumeDb > -25) {
      // Moderately loud - could be door or footstep
      type = 'door';
      confidence = 0.6;
    } else if (volumeDb > -30) {
      // Quieter - likely footstep
      type = 'footstep';
      confidence = 0.5;
    }

    this.lastEventTime = now;

    return {
      timestamp: now,
      type,
      confidence,
      volume: volumeDb,
    };
  }

  public getState(): SonarState {
    return {
      isActive: this.isRunning,
      readings: [],
      events: [],
      lastMovement: 0,
      ambientNoise: this.baselineAmplitude,
    };
  }

  public isCalibrated(): boolean {
    return this.calibrationSamples.length >= this.calibrationCount;
  }

  public recalibrate() {
    this.calibrationSamples = [];
    this.baselineAmplitude = 0;
  }

  public setVolume(volume: number) {
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(
        Math.max(0, Math.min(1, volume)),
        this.audioContext.currentTime
      );
    }
  }
}

// ============================================================================
// SOUND EVENT DETECTOR (Passive - no ultrasonic emission)
// ============================================================================

export class SoundEventDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private isRunning = false;
  private noiseFloor = -50;
  private onEvent: ((event: AudioEvent) => void) | null = null;

  public async start(onEvent: (event: AudioEvent) => void) {
    if (this.isRunning) return;

    this.onEvent = onEvent;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.5;

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: false } 
      });
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);

      this.isRunning = true;
      this.detectLoop();

      console.log('Sound Event Detector started');
    } catch (err) {
      console.error('Failed to start Sound Event Detector:', err);
      throw err;
    }
  }

  public stop() {
    this.isRunning = false;
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.onEvent = null;
  }

  private detectLoop() {
    if (!this.isRunning || !this.analyser) return;

    const timeData = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(timeData);

    // Calculate RMS
    let sum = 0;
    for (const sample of timeData) {
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / timeData.length);
    const volumeDb = 20 * Math.log10(rms + 0.0001);

    // Detect events above noise floor
    if (volumeDb > this.noiseFloor + 15) {
      this.onEvent?.({
        timestamp: Date.now(),
        type: 'unknown',
        confidence: Math.min(1, (volumeDb - this.noiseFloor) / 40),
        volume: volumeDb,
      });
    }

    // Slowly adjust noise floor
    this.noiseFloor = this.noiseFloor * 0.99 + volumeDb * 0.01;

    setTimeout(() => this.detectLoop(), 100);
  }
}
