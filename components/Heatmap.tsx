'use client';

import { useRef, useEffect } from 'react';

interface HeatmapProps {
  data: number[][]; // 2D grid of values 0-1
  width?: number;
  height?: number;
  colorScheme?: 'green' | 'heat' | 'blue';
  showLabels?: boolean;
}

export default function Heatmap({ data, width = 200, height = 200, colorScheme = 'green', showLabels = false }: HeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const rows = data.length;
    const cols = data[0]?.length || 0;
    const cellW = width / cols;
    const cellH = height / rows;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const value = data[y]?.[x] || 0;
        ctx.fillStyle = getColor(value, colorScheme);
        ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
      }
    }

    // Draw center marker
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }, [data, width, height, colorScheme]);

  return (
    <div className="heatmap-container" style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width, height, borderRadius: 8, display: 'block' }} />
      {showLabels && (
        <div className="heatmap-labels" style={{ position: 'absolute', bottom: 4, right: 4, fontSize: 10, color: '#888' }}>
          Position Heatmap
        </div>
      )}
    </div>
  );
}

function getColor(value: number, scheme: 'green' | 'heat' | 'blue'): string {
  const v = Math.max(0, Math.min(1, value));
  
  switch (scheme) {
    case 'heat':
      // Black -> Red -> Yellow -> White
      if (v < 0.33) {
        const t = v / 0.33;
        return `rgb(${Math.round(t * 255)}, 0, 0)`;
      } else if (v < 0.66) {
        const t = (v - 0.33) / 0.33;
        return `rgb(255, ${Math.round(t * 255)}, 0)`;
      } else {
        const t = (v - 0.66) / 0.34;
        return `rgb(255, 255, ${Math.round(t * 255)})`;
      }
      
    case 'blue':
      // Dark blue -> Cyan
      return `rgb(0, ${Math.round(v * 150)}, ${Math.round(50 + v * 205)})`;
      
    case 'green':
    default:
      // Dark -> Green
      return `rgba(0, ${Math.round(100 + v * 155)}, ${Math.round(v * 100)}, ${0.3 + v * 0.7})`;
  }
}

// Hourly activity heatmap
export function HourlyHeatmap({ data, label }: { data: number[]; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const barW = width / 24;
    const maxVal = Math.max(...data, 0.1);

    ctx.clearRect(0, 0, width, height);

    for (let h = 0; h < 24; h++) {
      const val = data[h] || 0;
      const barH = (val / maxVal) * (height - 20);
      const intensity = val / maxVal;
      
      ctx.fillStyle = `rgba(0, ${Math.round(150 + intensity * 105)}, ${Math.round(intensity * 100)}, 0.8)`;
      ctx.fillRect(h * barW + 2, height - 15 - barH, barW - 4, barH);
    }

    // Hour labels
    ctx.fillStyle = '#666';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    for (let h = 0; h < 24; h += 4) {
      ctx.fillText(h.toString(), h * barW + barW / 2, height - 3);
    }
  }, [data]);

  return (
    <div style={{ position: 'relative' }}>
      {label && <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{label}</div>}
      <canvas ref={canvasRef} width={240} height={60} style={{ width: '100%', height: 60 }} />
    </div>
  );
}
