// ============================================================================
// HISTORICAL PATTERN ANALYSIS
// Analyzes activity patterns over time for anomaly detection and insights
// ============================================================================

import type { ActivityPattern, AnomalyAlert, PatternAnalysis, SensorFusion } from './types';
import { 
  getSensorHistory, 
  addAnomaly, 
  getAllPatterns, 
  updatePattern,
  getRecentAnomalies 
} from './db';

export class PatternAnalyzer {
  private patterns: Map<string, ActivityPattern> = new Map();
  private recentSamples: SensorFusion[] = [];
  private readonly maxRecentSamples = 100;

  public async loadPatterns() {
    const stored = await getAllPatterns();
    this.patterns.clear();
    stored.forEach(p => {
      const key = `${p.dayOfWeek}-${p.hour}`;
      this.patterns.set(key, p);
    });
  }

  public async addSample(data: SensorFusion) {
    this.recentSamples.push(data);
    if (this.recentSamples.length > this.maxRecentSamples) {
      this.recentSamples.shift();
    }

    // Update patterns
    const date = new Date(data.timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();
    const key = `${dayOfWeek}-${hour}`;

    const existing = this.patterns.get(key) || {
      hour,
      dayOfWeek,
      averageIntensity: 0,
      eventCount: 0,
    };

    // Exponential moving average
    const alpha = 0.1;
    existing.averageIntensity = existing.averageIntensity * (1 - alpha) + data.combined.movementScore * alpha;
    existing.eventCount++;

    this.patterns.set(key, existing);
    await updatePattern(existing);

    // Check for anomalies
    await this.checkForAnomalies(data, existing);
  }

  private async checkForAnomalies(data: SensorFusion, pattern: ActivityPattern) {
    const anomalies: AnomalyAlert[] = [];

    // Check for unusual activity level
    if (pattern.eventCount > 10) { // Need some data first
      const deviation = Math.abs(data.combined.movementScore - pattern.averageIntensity);
      
      if (deviation > pattern.averageIntensity * 2) {
        const isHigher = data.combined.movementScore > pattern.averageIntensity;
        anomalies.push({
          timestamp: data.timestamp,
          type: 'unusual_intensity',
          severity: deviation > pattern.averageIntensity * 3 ? 'high' : 'medium',
          message: isHigher 
            ? 'Unusually high activity detected for this time'
            : 'Unusually quiet for this time',
          data: { expected: pattern.averageIntensity, actual: data.combined.movementScore },
        });
      }
    }

    // Check for unusual time activity
    const date = new Date(data.timestamp);
    const hour = date.getHours();
    const isNightTime = hour >= 23 || hour < 6;
    
    if (isNightTime && data.combined.movementScore > 0.5) {
      anomalies.push({
        timestamp: data.timestamp,
        type: 'unusual_time',
        severity: 'medium',
        message: 'Significant activity detected during night hours',
        data: { hour, movementScore: data.combined.movementScore },
      });
    }

    // Store anomalies
    for (const anomaly of anomalies) {
      await addAnomaly(anomaly);
    }
  }

  public async analyze(): Promise<PatternAnalysis> {
    // Get historical data
    const history = await getSensorHistory(24);
    const anomalies = await getRecentAnomalies(24);

    // Calculate hourly heatmap
    const hourlyHeatmap = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);
    
    for (const sample of history) {
      const hour = new Date(sample.timestamp).getHours();
      hourlyHeatmap[hour] += sample.combined.movementScore;
      hourlyCounts[hour]++;
    }
    
    for (let i = 0; i < 24; i++) {
      if (hourlyCounts[i] > 0) {
        hourlyHeatmap[i] /= hourlyCounts[i];
      }
    }

    // Calculate weekly heatmap
    const weeklyHeatmap = new Array(7).fill(0);
    const weeklyCounts = new Array(7).fill(0);
    
    // Use stored patterns for weekly data
    for (const pattern of this.patterns.values()) {
      weeklyHeatmap[pattern.dayOfWeek] += pattern.averageIntensity;
      weeklyCounts[pattern.dayOfWeek]++;
    }
    
    for (let i = 0; i < 7; i++) {
      if (weeklyCounts[i] > 0) {
        weeklyHeatmap[i] /= weeklyCounts[i];
      }
    }

    // Calculate trends
    const trends = this.calculateTrends(history);

    return {
      patterns: Array.from(this.patterns.values()),
      anomalies,
      hourlyHeatmap,
      weeklyHeatmap,
      trends,
    };
  }

  private calculateTrends(history: SensorFusion[]): PatternAnalysis['trends'] {
    const trends: PatternAnalysis['trends'] = [];

    if (history.length < 10) return trends;

    // Split into halves and compare
    const mid = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, mid);
    const secondHalf = history.slice(mid);

    const firstAvg = firstHalf.reduce((sum, s) => sum + s.combined.movementScore, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.combined.movementScore, 0) / secondHalf.length;

    let direction: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (secondAvg > firstAvg * 1.2) direction = 'increasing';
    else if (secondAvg < firstAvg * 0.8) direction = 'decreasing';

    trends.push({ direction, period: 'last_24h' });

    return trends;
  }

  public getPeakHours(): number[] {
    const hourlyAverages: { hour: number; avg: number }[] = [];
    
    for (let h = 0; h < 24; h++) {
      let sum = 0;
      let count = 0;
      
      for (const pattern of this.patterns.values()) {
        if (pattern.hour === h) {
          sum += pattern.averageIntensity;
          count++;
        }
      }
      
      if (count > 0) {
        hourlyAverages.push({ hour: h, avg: sum / count });
      }
    }

    hourlyAverages.sort((a, b) => b.avg - a.avg);
    return hourlyAverages.slice(0, 3).map(h => h.hour);
  }

  public getQuietHours(): number[] {
    const hourlyAverages: { hour: number; avg: number }[] = [];
    
    for (let h = 0; h < 24; h++) {
      let sum = 0;
      let count = 0;
      
      for (const pattern of this.patterns.values()) {
        if (pattern.hour === h) {
          sum += pattern.averageIntensity;
          count++;
        }
      }
      
      if (count > 0) {
        hourlyAverages.push({ hour: h, avg: sum / count });
      }
    }

    hourlyAverages.sort((a, b) => a.avg - b.avg);
    return hourlyAverages.slice(0, 3).map(h => h.hour);
  }

  public clear() {
    this.patterns.clear();
    this.recentSamples = [];
  }
}

// ============================================================================
// ANOMALY DETECTOR
// Real-time anomaly detection with configurable thresholds
// ============================================================================

export class AnomalyDetector {
  private baselineActivity = 0.3;
  private stdDev = 0.2;
  private readonly minSamples = 20;
  private samples: number[] = [];

  public addSample(activityScore: number) {
    this.samples.push(activityScore);
    if (this.samples.length > 100) {
      this.samples.shift();
    }

    if (this.samples.length >= this.minSamples) {
      this.updateStats();
    }
  }

  private updateStats() {
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const variance = this.samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / this.samples.length;
    
    this.baselineActivity = mean;
    this.stdDev = Math.sqrt(variance);
  }

  public isAnomaly(activityScore: number, threshold = 2): boolean {
    if (this.samples.length < this.minSamples) return false;
    
    const zScore = Math.abs(activityScore - this.baselineActivity) / (this.stdDev || 1);
    return zScore > threshold;
  }

  public getZScore(activityScore: number): number {
    return (activityScore - this.baselineActivity) / (this.stdDev || 1);
  }

  public reset() {
    this.samples = [];
    this.baselineActivity = 0.3;
    this.stdDev = 0.2;
  }
}
