// ============================================================================
// AMBIENT LIGHT SENSOR INTEGRATION
// Uses AmbientLightSensor API (if available) or fallback to video-based detection
// ============================================================================

import type { LightReading, LightSensorState } from './types';

export class AmbientLightMonitor {
  private sensor: any = null; // AmbientLightSensor
  private isRunning = false;
  private baseline = 100;
  private history: LightReading[] = [];
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private useVideoFallback = false;
  private callback: ((reading: LightReading) => void) | null = null;

  public async start(onReading: (reading: LightReading) => void) {
    if (this.isRunning) return;
    
    this.callback = onReading;
    this.isRunning = true;

    // Try native AmbientLightSensor first
    if ('AmbientLightSensor' in window) {
      try {
        // @ts-ignore - AmbientLightSensor may not be in types
        this.sensor = new AmbientLightSensor({ frequency: 10 });
        this.sensor.addEventListener('reading', () => {
          this.processReading(this.sensor.illuminance);
        });
        this.sensor.addEventListener('error', (err: any) => {
          console.warn('AmbientLightSensor error:', err);
          this.startVideoFallback();
        });
        this.sensor.start();
        console.log('Using native AmbientLightSensor');
        return;
      } catch (err) {
        console.warn('AmbientLightSensor not available:', err);
      }
    }

    // Fallback to video-based brightness detection
    await this.startVideoFallback();
  }

  private async startVideoFallback() {
    this.useVideoFallback = true;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: 64, height: 64 } 
      });

      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = stream;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;
      await this.videoElement.play();

      this.canvasElement = document.createElement('canvas');
      this.canvasElement.width = 64;
      this.canvasElement.height = 64;

      this.measureBrightnessLoop();
      console.log('Using video-based light detection');
    } catch (err) {
      console.error('Video fallback failed:', err);
      // Final fallback: use API endpoint
      this.startApiFallback();
    }
  }

  private startApiFallback() {
    const poll = async () => {
      if (!this.isRunning) return;
      
      try {
        const res = await fetch('/api/light', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.lux !== undefined) {
            this.processReading(data.lux);
          }
        }
      } catch (err) {
        console.warn('Light API error:', err);
      }
      
      setTimeout(poll, 500);
    };
    
    poll();
  }

  private measureBrightnessLoop() {
    if (!this.isRunning || !this.videoElement || !this.canvasElement) return;

    const ctx = this.canvasElement.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(this.videoElement, 0, 0, 64, 64);
    const imageData = ctx.getImageData(0, 0, 64, 64);
    const data = imageData.data;

    // Calculate average brightness
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Perceived brightness formula
      totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b);
    }
    
    const avgBrightness = totalBrightness / (64 * 64);
    // Convert to approximate lux (very rough estimation)
    const estimatedLux = avgBrightness * 4;

    this.processReading(estimatedLux);

    requestAnimationFrame(() => this.measureBrightnessLoop());
  }

  private processReading(lux: number) {
    // Initialize baseline
    if (this.history.length === 0) {
      this.baseline = lux;
    }

    // Calculate change from baseline
    const change = lux - this.baseline;
    const shadowDetected = change < -this.baseline * 0.15; // 15% decrease = shadow

    const reading: LightReading = {
      timestamp: Date.now(),
      lux,
      change,
      shadowDetected,
    };

    // Update history
    this.history.push(reading);
    if (this.history.length > 100) this.history.shift();

    // Slowly adapt baseline (for gradual lighting changes)
    this.baseline = this.baseline * 0.995 + lux * 0.005;

    this.callback?.(reading);
  }

  public stop() {
    this.isRunning = false;

    if (this.sensor) {
      this.sensor.stop();
      this.sensor = null;
    }

    if (this.videoElement) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      this.videoElement = null;
    }

    this.canvasElement = null;
    this.callback = null;
  }

  public getState(): LightSensorState {
    return {
      isActive: this.isRunning,
      baseline: this.baseline,
      current: this.history.length > 0 ? this.history[this.history.length - 1].lux : 0,
      history: this.history.slice(-50),
    };
  }

  public recalibrate() {
    if (this.history.length > 0) {
      this.baseline = this.history[this.history.length - 1].lux;
    }
  }

  public isUsingVideoFallback(): boolean {
    return this.useVideoFallback;
  }
}

// ============================================================================
// SHADOW PATTERN ANALYZER
// ============================================================================

export class ShadowAnalyzer {
  private readings: LightReading[] = [];
  private readonly windowSize = 30;

  public addReading(reading: LightReading) {
    this.readings.push(reading);
    if (this.readings.length > this.windowSize) {
      this.readings.shift();
    }
  }

  public analyze(): {
    trend: 'brightening' | 'darkening' | 'stable';
    variability: number;
    shadowEvents: number;
    avgLux: number;
  } {
    if (this.readings.length < 5) {
      return { trend: 'stable', variability: 0, shadowEvents: 0, avgLux: 0 };
    }

    // Calculate average
    const avgLux = this.readings.reduce((sum, r) => sum + r.lux, 0) / this.readings.length;

    // Calculate trend
    const firstHalf = this.readings.slice(0, this.readings.length / 2);
    const secondHalf = this.readings.slice(this.readings.length / 2);
    const firstAvg = firstHalf.reduce((sum, r) => sum + r.lux, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, r) => sum + r.lux, 0) / secondHalf.length;
    
    let trend: 'brightening' | 'darkening' | 'stable' = 'stable';
    if (secondAvg > firstAvg * 1.1) trend = 'brightening';
    else if (secondAvg < firstAvg * 0.9) trend = 'darkening';

    // Calculate variability (standard deviation)
    const variance = this.readings.reduce((sum, r) => sum + Math.pow(r.lux - avgLux, 2), 0) / this.readings.length;
    const variability = Math.sqrt(variance) / (avgLux || 1);

    // Count shadow events
    const shadowEvents = this.readings.filter(r => r.shadowDetected).length;

    return { trend, variability, shadowEvents, avgLux };
  }

  public clear() {
    this.readings = [];
  }
}
