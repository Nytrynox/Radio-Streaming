'use client';

import { useMemo } from 'react';

interface TimelineEvent {
  timestamp: number;
  type: string;
  intensity: number;
  label?: string;
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
  hours?: number;
  onEventClick?: (event: TimelineEvent) => void;
}

export default function ActivityTimeline({ events, hours = 6, onEventClick }: ActivityTimelineProps) {
  const timeRange = useMemo(() => {
    const now = Date.now();
    const start = now - hours * 60 * 60 * 1000;
    return { start, end: now };
  }, [hours]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end);
  }, [events, timeRange]);

  const getPositionPercent = (timestamp: number) => {
    const range = timeRange.end - timeRange.start;
    return ((timestamp - timeRange.start) / range) * 100;
  };

  const getEventColor = (type: string, intensity: number) => {
    if (type === 'alert' || intensity > 0.7) return '#ff4444';
    if (type === 'movement' || intensity > 0.4) return '#ffaa00';
    return '#00ff88';
  };

  const hourMarkers = useMemo(() => {
    const markers = [];
    for (let h = 0; h <= hours; h++) {
      const time = timeRange.end - h * 60 * 60 * 1000;
      markers.push({
        time,
        label: new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        position: 100 - (h / hours) * 100,
      });
    }
    return markers;
  }, [hours, timeRange.end]);

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <span>📊 Activity Timeline</span>
        <span className="timeline-range">Last {hours}h</span>
      </div>
      
      <div className="timeline-track">
        {/* Hour markers */}
        {hourMarkers.map((marker, i) => (
          <div key={i} className="timeline-marker" style={{ left: `${marker.position}%` }}>
            <div className="marker-line" />
            <span className="marker-label">{marker.label}</span>
          </div>
        ))}
        
        {/* Events */}
        {filteredEvents.map((event, i) => (
          <div
            key={i}
            className="timeline-event"
            style={{
              left: `${getPositionPercent(event.timestamp)}%`,
              backgroundColor: getEventColor(event.type, event.intensity),
              height: `${20 + event.intensity * 30}px`,
            }}
            onClick={() => onEventClick?.(event)}
            title={`${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`}
          />
        ))}
      </div>

      <div className="timeline-legend">
        <span><span className="dot" style={{ background: '#ff4444' }} /> High Activity</span>
        <span><span className="dot" style={{ background: '#ffaa00' }} /> Medium</span>
        <span><span className="dot" style={{ background: '#00ff88' }} /> Low</span>
      </div>

      <style jsx>{`
        .timeline-container {
          background: rgba(0, 255, 128, 0.04);
          border: 1px solid rgba(0, 255, 128, 0.15);
          border-radius: 8px;
          padding: 12px;
        }
        .timeline-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #00ff88;
          margin-bottom: 10px;
        }
        .timeline-range { color: #666; }
        .timeline-track {
          position: relative;
          height: 60px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          overflow: hidden;
        }
        .timeline-marker {
          position: absolute;
          top: 0;
          height: 100%;
          transform: translateX(-50%);
        }
        .marker-line {
          position: absolute;
          top: 0;
          width: 1px;
          height: 100%;
          background: rgba(0, 255, 128, 0.1);
        }
        .marker-label {
          position: absolute;
          bottom: 2px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 8px;
          color: #555;
          white-space: nowrap;
        }
        .timeline-event {
          position: absolute;
          bottom: 0;
          width: 4px;
          border-radius: 2px 2px 0 0;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .timeline-event:hover {
          transform: scaleY(1.2);
        }
        .timeline-legend {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          font-size: 9px;
          color: #666;
        }
        .dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 4px;
        }
      `}</style>
    </div>
  );
}
