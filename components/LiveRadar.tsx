'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { DetectedObject } from '../lib/real-wifi-scanner';

type Props = {
  isActive: boolean;
  detectedObjects: DetectedObject[];
  signalStrength: number;
  range: number;
  networkCount: number;
  isCalibrated: boolean;
  calibrationProgress: number;
  rssiHistory: number[];
  movementIntensity: number;
};

export default function LiveRadar(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sweepAngleRef = useRef(0);
  const pingRingsRef = useRef<{ radius: number; opacity: number; time: number }[]>([]);

  const radarBlips = useMemo(() => {
    const toAngle = (key: string) => {
      let h = 2166136261;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) / 2 ** 32) * Math.PI * 2;
    };
    return props.detectedObjects.map((o, idx) => {
      const key = `${o.sourceNetwork}-${idx}`;
      const angle = toAngle(key);
      const radius = Math.min(1, Math.max(0.15, o.distance / Math.max(1, props.range)));
      return { id: o.id, angle, radius, strength: o.confidence, network: o.sourceNetwork };
    });
  }, [props.detectedObjects, props.range]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame = 0;
    
    const draw = (timestamp: number) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.42;

      // Background gradient
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2);
      bgGrad.addColorStop(0, 'rgba(0, 255, 157, 0.03)');
      bgGrad.addColorStop(0.5, 'rgba(0, 240, 255, 0.01)');
      bgGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Grid rings with distance labels
      ctx.strokeStyle = 'rgba(0, 255, 157, 0.12)';
      ctx.lineWidth = 1 * dpr;
      
      const rings = [0.25, 0.5, 0.75, 1];
      rings.forEach((ring, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r * ring, 0, Math.PI * 2);
        ctx.stroke();
        
        // Distance labels
        const dist = Math.round(props.range * ring);
        ctx.fillStyle = 'rgba(0, 255, 157, 0.4)';
        ctx.font = `${9 * dpr}px "JetBrains Mono"`;
        ctx.fillText(`${dist}m`, cx + r * ring + 5 * dpr, cy - 2 * dpr);
      });
      
      // Crosshairs with gradient
      const crossGrad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      crossGrad.addColorStop(0, 'rgba(0, 255, 157, 0)');
      crossGrad.addColorStop(0.5, 'rgba(0, 255, 157, 0.2)');
      crossGrad.addColorStop(1, 'rgba(0, 255, 157, 0)');
      
      ctx.strokeStyle = crossGrad;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();
      
      const crossGradV = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      crossGradV.addColorStop(0, 'rgba(0, 255, 157, 0)');
      crossGradV.addColorStop(0.5, 'rgba(0, 255, 157, 0.2)');
      crossGradV.addColorStop(1, 'rgba(0, 255, 157, 0)');
      
      ctx.strokeStyle = crossGradV;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // Orbital Scan Sweep
      if (props.isActive) {
        sweepAngleRef.current += 0.03; // Smooth rotation
        const sweepAngle = sweepAngleRef.current;
        
        // Sweep gradient cone
        const sweepGrad = ctx.createConicGradient(sweepAngle - Math.PI / 3, cx, cy);
        sweepGrad.addColorStop(0, 'rgba(0, 255, 157, 0)');
        sweepGrad.addColorStop(0.05, 'rgba(0, 255, 157, 0.02)');
        sweepGrad.addColorStop(0.15, 'rgba(0, 255, 157, 0.1)');
        sweepGrad.addColorStop(0.25, 'rgba(0, 255, 157, 0.2)');
        sweepGrad.addColorStop(0.26, 'rgba(0, 255, 157, 0)');
        sweepGrad.addColorStop(1, 'rgba(0, 255, 157, 0)');
        
        ctx.fillStyle = sweepGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        
        // Sweep line with glow
        ctx.save();
        ctx.shadowColor = '#00ff9d';
        ctx.shadowBlur = 15 * dpr;
        ctx.strokeStyle = 'rgba(0, 255, 157, 0.8)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweepAngle) * r, cy + Math.sin(sweepAngle) * r);
        ctx.stroke();
        ctx.restore();
        
        // Ping rings from center
        if (timestamp % 60 < 2) { // New ping every ~1 second
          pingRingsRef.current.push({ radius: 0, opacity: 1, time: timestamp });
        }
      }
      
      // Update and draw ping rings
      pingRingsRef.current = pingRingsRef.current.filter(ping => {
        ping.radius += 2 * dpr;
        ping.opacity -= 0.015;
        
        if (ping.opacity > 0 && ping.radius < r) {
          ctx.strokeStyle = `rgba(0, 240, 255, ${ping.opacity * 0.3})`;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, ping.radius, 0, Math.PI * 2);
          ctx.stroke();
          return true;
        }
        return false;
      });

      // Draw detected blips with animations
      radarBlips.forEach((b, i) => {
        const x = cx + Math.cos(b.angle) * r * b.radius;
        const y = cy + Math.sin(b.angle) * r * b.radius;
        
        const pulsePhase = (timestamp * 0.005 + i) % (Math.PI * 2);
        const pulse = 1 + Math.sin(pulsePhase) * 0.2;
        const size = (6 + b.strength * 6) * dpr * pulse;

        // Glow
        ctx.save();
        ctx.shadowColor = '#ff2a6d';
        ctx.shadowBlur = 20 * dpr;
        
        // Core
        ctx.fillStyle = 'rgba(255, 42, 109, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();

        // Pulse ring
        ctx.strokeStyle = `rgba(255, 42, 109, ${0.5 - Math.sin(pulsePhase) * 0.3})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, size * 1.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        
        // Connection line to center
        const lineGrad = ctx.createLinearGradient(cx, cy, x, y);
        lineGrad.addColorStop(0, 'rgba(255, 42, 109, 0)');
        lineGrad.addColorStop(1, 'rgba(255, 42, 109, 0.3)');
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        // Network label
        if (b.network) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.font = `${8 * dpr}px "JetBrains Mono"`;
          ctx.fillText(b.network.slice(0, 8), x + size + 4 * dpr, y + 3 * dpr);
        }
      });

      // Center device indicator
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10 * dpr;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      
      // Outer ring
      ctx.strokeStyle = 'rgba(0, 255, 157, 0.3)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      
      // Cardinal markers
      ctx.fillStyle = 'rgba(0, 255, 157, 0.5)';
      ctx.font = `bold ${10 * dpr}px "JetBrains Mono"`;
      ctx.textAlign = 'center';
      ctx.fillText('N', cx, cy - r - 12 * dpr);
      ctx.fillText('S', cx, cy + r + 18 * dpr);
      ctx.fillText('E', cx + r + 15 * dpr, cy + 4 * dpr);
      ctx.fillText('W', cx - r - 15 * dpr, cy + 4 * dpr);

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [props.isActive, props.range, radarBlips]);

  return (
    <div className="radar-container glass-panel">
      <canvas ref={canvasRef} className="radar-canvas" />
      
      <div className="radar-hud">
        <div className="hud-top">
          <div className="hud-badge">
            <span className={`status-dot ${props.isActive ? 'active' : ''}`} />
            <span>{props.isActive ? 'SCANNING' : 'STANDBY'}</span>
          </div>
          <div className="hud-range">{props.range}M RANGE</div>
        </div>
        
        <div className="hud-bottom">
          <div className="hud-stat">
            <span className="label">TARGETS</span>
            <span className="value">{props.detectedObjects.length}</span>
          </div>
          <div className="hud-stat">
            <span className="label">NETWORKS</span>
            <span className="value">{props.networkCount}</span>
          </div>
          <div className="hud-stat">
            <span className="label">INTENSITY</span>
            <span className="value">{(props.movementIntensity * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        .radar-container {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 350px;
          overflow: hidden;
        }
        
        .radar-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .radar-hud {
          position: absolute;
          inset: 0;
          padding: 16px;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .hud-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .hud-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.4);
          padding: 4px 10px;
          border-radius: 4px;
          border-left: 2px solid var(--neon-green);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--neon-green);
        }

        .hud-range {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
        }

        .hud-bottom {
          display: flex;
          gap: 20px;
          justify-content: flex-end;
        }

        .hud-stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .hud-stat .label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 8px;
          color: rgba(255, 255, 255, 0.4);
          letter-spacing: 1px;
        }

        .hud-stat .value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          color: var(--neon-cyan);
          text-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
        }
      `}</style>
    </div>
  );
}
