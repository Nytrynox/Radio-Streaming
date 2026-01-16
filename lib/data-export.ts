// ============================================================================
// DATA EXPORT UTILITIES
// Export sensor data to CSV, JSON, and PDF formats
// ============================================================================

import { jsPDF } from 'jspdf';
import type { 
  ExportFormat, 
  ExportOptions, 
  RecordedSession, 
  SessionEvent,
  SensorFusion 
} from './types';
import { getSensorHistory, getEventsBySession, getAllSessions, getRecentAnomalies } from './db';

export class DataExporter {
  
  public async exportSession(sessionId: string, options: ExportOptions): Promise<Blob> {
    const events = await getEventsBySession(sessionId);
    
    switch (options.format) {
      case 'csv':
        return this.toCSV(events, options);
      case 'json':
        return this.toJSON(events, options);
      case 'pdf':
        return this.toPDF(sessionId, events, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  public async exportHistory(hours: number, options: ExportOptions): Promise<Blob> {
    const history = await getSensorHistory(hours);
    const events = history.map((h, i) => ({
      timestamp: h.timestamp,
      type: 'sensor_fusion' as const,
      data: h,
    }));

    switch (options.format) {
      case 'csv':
        return this.toCSV(events, options);
      case 'json':
        return this.toJSON(events, options);
      case 'pdf':
        return this.toPDFReport(hours, history, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  private toCSV(events: SessionEvent[], options: ExportOptions): Blob {
    const rows: string[] = [];
    
    // Header - build as array of strings only
    const headerItems: string[] = [
      'timestamp',
      'datetime',
      'type',
    ];
    if (options.includeWifi) { headerItems.push('wifi_intensity', 'wifi_networks'); }
    if (options.includeBluetooth) { headerItems.push('bluetooth_devices'); }
    if (options.includeSonar) { headerItems.push('sonar_movement'); }
    if (options.includeLight) { headerItems.push('light_level'); }
    if (options.includeNetwork) { headerItems.push('network_active'); }
    if (options.includeMl) { headerItems.push('ml_class', 'ml_confidence'); }
    headerItems.push('presence_score', 'movement_score', 'alert_level');
    
    rows.push(headerItems.join(','));

    // Data rows
    for (const event of events) {
      const d = event.data as SensorFusion;
      const rowItems: (string | number)[] = [
        event.timestamp,
        new Date(event.timestamp).toISOString(),
        event.type,
      ];
      if (options.includeWifi) {
        rowItems.push(d?.wifi?.intensity ?? '', d?.wifi?.networks ?? '');
      }
      if (options.includeBluetooth) {
        rowItems.push(d?.bluetooth?.devices ?? '');
      }
      if (options.includeSonar) {
        rowItems.push(d?.sonar?.movement ?? '');
      }
      if (options.includeLight) {
        rowItems.push(d?.light?.level ?? '');
      }
      if (options.includeNetwork) {
        rowItems.push(d?.network?.active ?? '');
      }
      if (options.includeMl) {
        rowItems.push(d?.ml?.class ?? '', d?.ml?.confidence ?? '');
      }
      rowItems.push(
        d?.combined?.presenceScore ?? '',
        d?.combined?.movementScore ?? '',
        d?.combined?.alertLevel ?? ''
      );
      
      rows.push(rowItems.join(','));
    }

    return new Blob([rows.join('\n')], { type: 'text/csv' });
  }

  private toJSON(events: SessionEvent[], options: ExportOptions): Blob {
    const filtered = events.map(event => {
      const d = event.data as SensorFusion;
      const result: any = {
        timestamp: event.timestamp,
        datetime: new Date(event.timestamp).toISOString(),
        type: event.type,
      };

      if (options.includeWifi && d?.wifi) result.wifi = d.wifi;
      if (options.includeBluetooth && d?.bluetooth) result.bluetooth = d.bluetooth;
      if (options.includeSonar && d?.sonar) result.sonar = d.sonar;
      if (options.includeLight && d?.light) result.light = d.light;
      if (options.includeNetwork && d?.network) result.network = d.network;
      if (options.includeMl && d?.ml) result.ml = d.ml;
      if (d?.combined) result.combined = d.combined;

      return result;
    });

    return new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
  }

  private async toPDF(sessionId: string, events: SessionEvent[], options: ExportOptions): Promise<Blob> {
    const doc = new jsPDF();
    const sessions = await getAllSessions();
    const session = sessions.find(s => s.id === sessionId);

    // Title
    doc.setFontSize(20);
    doc.text('WiFi Signal Radar - Session Report', 20, 20);

    // Session info
    doc.setFontSize(12);
    let y = 35;
    
    if (session) {
      doc.text(`Session: ${session.name}`, 20, y); y += 7;
      doc.text(`Start: ${new Date(session.startTime).toLocaleString()}`, 20, y); y += 7;
      if (session.endTime) {
        doc.text(`End: ${new Date(session.endTime).toLocaleString()}`, 20, y); y += 7;
      }
      doc.text(`Total Events: ${events.length}`, 20, y); y += 7;
    }

    y += 10;

    // Summary stats
    doc.setFontSize(14);
    doc.text('Summary Statistics', 20, y); y += 10;
    doc.setFontSize(10);

    const stats = this.calculateStats(events);
    doc.text(`WiFi Scans: ${stats.wifiScans}`, 20, y); y += 6;
    doc.text(`Bluetooth Scans: ${stats.bluetoothScans}`, 20, y); y += 6;
    doc.text(`Movement Events: ${stats.movementEvents}`, 20, y); y += 6;
    doc.text(`Alerts: ${stats.alerts}`, 20, y); y += 6;
    doc.text(`Average Presence Score: ${(stats.avgPresence * 100).toFixed(1)}%`, 20, y); y += 6;
    doc.text(`Peak Activity: ${new Date(stats.peakTime).toLocaleTimeString()}`, 20, y); y += 6;

    // Add more pages if needed for detailed data
    if (events.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text('Event Timeline (Last 50)', 20, 20);
      
      doc.setFontSize(8);
      y = 30;
      
      for (const event of events.slice(-50)) {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        const time = new Date(event.timestamp).toLocaleTimeString();
        const d = event.data as SensorFusion;
        const alert = d?.combined?.alertLevel || 'none';
        doc.text(`${time} - ${event.type} - Alert: ${alert}`, 20, y);
        y += 5;
      }
    }

    return doc.output('blob');
  }

  private async toPDFReport(hours: number, history: SensorFusion[], options: ExportOptions): Promise<Blob> {
    const doc = new jsPDF();
    const anomalies = await getRecentAnomalies(hours);

    // Title
    doc.setFontSize(20);
    doc.text('WiFi Signal Radar - Activity Report', 20, 20);

    doc.setFontSize(12);
    let y = 35;
    doc.text(`Report Period: Last ${hours} hours`, 20, y); y += 7;
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y); y += 7;
    doc.text(`Total Readings: ${history.length}`, 20, y); y += 15;

    // Quick stats
    doc.setFontSize(14);
    doc.text('Overview', 20, y); y += 10;
    doc.setFontSize(10);

    const avgMovement = history.reduce((sum, h) => sum + h.combined.movementScore, 0) / (history.length || 1);
    const avgPresence = history.reduce((sum, h) => sum + h.combined.presenceScore, 0) / (history.length || 1);
    const highAlerts = history.filter(h => h.combined.alertLevel === 'high').length;

    doc.text(`Average Movement Score: ${(avgMovement * 100).toFixed(1)}%`, 20, y); y += 6;
    doc.text(`Average Presence Score: ${(avgPresence * 100).toFixed(1)}%`, 20, y); y += 6;
    doc.text(`High Alert Events: ${highAlerts}`, 20, y); y += 6;
    doc.text(`Anomalies Detected: ${anomalies.length}`, 20, y); y += 15;

    // Anomalies section
    if (anomalies.length > 0) {
      doc.setFontSize(14);
      doc.text('Anomalies', 20, y); y += 10;
      doc.setFontSize(9);

      for (const anomaly of anomalies.slice(0, 10)) {
        if (y > 270) break;
        const time = new Date(anomaly.timestamp).toLocaleString();
        const icon = anomaly.severity === 'high' ? '🚨' : anomaly.severity === 'medium' ? '⚠️' : 'ℹ️';
        doc.text(`${time} [${anomaly.severity.toUpperCase()}] ${anomaly.message}`, 20, y);
        y += 6;
      }
    }

    return doc.output('blob');
  }

  private calculateStats(events: SessionEvent[]): {
    wifiScans: number;
    bluetoothScans: number;
    movementEvents: number;
    alerts: number;
    avgPresence: number;
    peakTime: number;
  } {
    let wifiScans = 0;
    let bluetoothScans = 0;
    let movementEvents = 0;
    let alerts = 0;
    let totalPresence = 0;
    let peakPresence = 0;
    let peakTime = Date.now();

    for (const event of events) {
      if (event.type === 'wifi') wifiScans++;
      if (event.type === 'bluetooth') bluetoothScans++;
      if (event.type === 'alert') alerts++;
      
      const d = event.data as SensorFusion;
      if (d?.combined?.movementScore > 0.3) movementEvents++;
      if (d?.combined?.presenceScore) {
        totalPresence += d.combined.presenceScore;
        if (d.combined.presenceScore > peakPresence) {
          peakPresence = d.combined.presenceScore;
          peakTime = event.timestamp;
        }
      }
    }

    return {
      wifiScans,
      bluetoothScans,
      movementEvents,
      alerts,
      avgPresence: events.length > 0 ? totalPresence / events.length : 0,
      peakTime,
    };
  }

  public downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
