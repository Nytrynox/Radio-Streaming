'use client';

import { useEffect, useRef } from 'react';
import type { DetectedObject } from '../lib/real-wifi-scanner';
import type { PresenceZone, EnhancedDetectedObject } from '../lib/advanced-csi-engine';

interface ThermalViewProps {
  isActive: boolean;
  movementIntensity: number;
  signalQuality: number;
  detectedObjects: DetectedObject[] | EnhancedDetectedObject[];
  presenceZones?: PresenceZone[];
  direction?: 'approaching' | 'departing' | 'lateral' | 'stationary' | 'unknown';
  showGrid?: boolean;
  colorMode?: 'thermal' | 'nightvision' | 'radar';
}

export default function ThermalView({
  isActive,
  movementIntensity,
  signalQuality,
  detectedObjects,
  presenceZones = [],
  direction = 'unknown',
  showGrid = true,
  colorMode = 'thermal'
}: ThermalViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const scanLineRef = useRef(0);
  
  const latestRef = useRef({ isActive, movementIntensity, signalQuality, detectedObjects, presenceZones, direction, showGrid, colorMode });

  useEffect(() => {
    latestRef.current = { isActive, movementIntensity, signalQuality, detectedObjects, presenceZones, direction, showGrid, colorMode };
  }, [isActive, movementIntensity, signalQuality, detectedObjects, presenceZones, direction, showGrid, colorMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0, height = 0;
    
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const palettes = {
      thermal: {
        bg: '#0a0005',
        primary: [255, 80, 20],
        secondary: [255, 200, 50],
        cold: [20, 0, 60]
      },
      nightvision: {
        bg: '#000500',
        primary: [0, 255, 80],
        secondary: [200, 255, 200],
        cold: [0, 30, 10]
      },
      radar: {
        bg: '#000510',
        primary: [0, 150, 255],
        secondary: [150, 220, 255],
        cold: [0, 20, 50]
      }
    };

    const hex = (rgb: number[], a = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

    const draw = (t: number) => {
      const props = latestRef.current;
      const palette = palettes[props.colorMode || 'thermal'];
      const objs = props.detectedObjects;
      
      // Background
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);
      
      // Ambient heat glow
      const ambientGrad = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width * 0.6);
      ambientGrad.addColorStop(0, hex(palette.cold, 0.1 + props.movementIntensity * 0.1));
      ambientGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, width, height);

      // Grid overlay
      if (props.showGrid) {
        ctx.strokeStyle = hex(palette.primary, 0.08);
        ctx.lineWidth = 1;
        const gridSize = 40;
        
        for (let x = 0; x < width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        
        // Center reticle
        const cx = width/2, cy = height/2;
        ctx.strokeStyle = hex(palette.secondary, 0.4);
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.arc(cx, cy, 50, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(cx, cy, 25, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(cx - 70, cy);
        ctx.lineTo(cx - 30, cy);
        ctx.moveTo(cx + 30, cy);
        ctx.lineTo(cx + 70, cy);
        ctx.moveTo(cx, cy - 70);
        ctx.lineTo(cx, cy - 30);
        ctx.moveTo(cx, cy + 30);
        ctx.lineTo(cx, cy + 70);
        ctx.stroke();
      }

      // Draw heat signatures for detected objects
      if (objs.length === 0) {
        ctx.fillStyle = hex(palette.secondary, 0.3);
        ctx.font = '14px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText('NO THERMAL SIGNATURES', width/2, height/2 - 10);
        ctx.font = '10px "JetBrains Mono"';
        ctx.fillStyle = hex(palette.secondary, 0.2);
        ctx.fillText('Waiting for signal data...', width/2, height/2 + 15);
      } else {
        objs.forEach((obj, i) => {
          // Position based on object properties
          const angle = (obj.id.charCodeAt(0) + i * 137) % 360 * (Math.PI / 180);
          const dist = width * 0.15 + (1 - obj.confidence) * width * 0.2;
          const x = width/2 + Math.cos(angle + t * 0.0005) * dist;
          const y = height/2 + Math.sin(angle + t * 0.0005) * dist;
          
          // Heat intensity based on confidence
          const intensity = 0.4 + obj.confidence * 0.6;
          const radius = 40 + obj.confidence * 60;
          
          // Multi-layer heat bloom
          for (let layer = 3; layer >= 0; layer--) {
            const layerRadius = radius * (1 + layer * 0.5);
            const layerIntensity = intensity * (1 - layer * 0.2);
            
            const heatColor = lerp(palette.cold, palette.primary, layerIntensity);
            if (layer === 0) {
              const innerColor = lerp(palette.primary, palette.secondary, obj.confidence);
              heatColor[0] = innerColor[0];
              heatColor[1] = innerColor[1];
              heatColor[2] = innerColor[2];
            }
            
            const grad = ctx.createRadialGradient(x, y, 0, x, y, layerRadius);
            grad.addColorStop(0, hex(heatColor, layerIntensity * 0.6));
            grad.addColorStop(0.5, hex(heatColor, layerIntensity * 0.3));
            grad.addColorStop(1, 'transparent');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, layerRadius, 0, Math.PI * 2);
            ctx.fill();
          }
          
          // Pulsing halo
          const pulsePhase = (t * 0.004 + i) % (Math.PI * 2);
          const pulseRadius = radius + Math.sin(pulsePhase) * 20;
          ctx.strokeStyle = hex(palette.secondary, 0.3 + Math.sin(pulsePhase) * 0.2);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Label
          ctx.fillStyle = hex(palette.secondary, 0.8);
          ctx.font = '9px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(obj.sourceNetwork?.slice(0, 10) || `SIG-${i+1}`, x, y + radius + 15);
          ctx.fillStyle = hex(palette.secondary, 0.5);
          ctx.fillText(`${(obj.confidence * 100).toFixed(0)}%`, x, y + radius + 26);
        });
      }
      
      // Scanning line effect
      if (props.isActive) {
        scanLineRef.current = (scanLineRef.current + 3) % height;
        const scanY = scanLineRef.current;
        
        const scanGrad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
        scanGrad.addColorStop(0, 'transparent');
        scanGrad.addColorStop(0.5, hex(palette.primary, 0.15));
        scanGrad.addColorStop(1, 'transparent');
        
        ctx.fillStyle = scanGrad;
        ctx.fillRect(0, scanY - 30, width, 60);
        
        ctx.strokeStyle = hex(palette.primary, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(width, scanY);
        ctx.stroke();
      }
      
      // Presence zones bar
      if (props.presenceZones.length > 0) {
        const barHeight = 30;
        const barY = height - barHeight - 10;
        
        props.presenceZones.forEach((zone, i) => {
          const barWidth = (width - 40) / props.presenceZones.length - 10;
          const barX = 20 + i * (barWidth + 10);
          
          ctx.fillStyle = hex(palette.cold, 0.3);
          ctx.fillRect(barX, barY, barWidth, barHeight);
          
          ctx.fillStyle = hex(palette.primary, zone.intensity);
          ctx.fillRect(barX, barY, barWidth * zone.intensity, barHeight);
          
          ctx.strokeStyle = hex(palette.primary, 0.5);
          ctx.strokeRect(barX, barY, barWidth, barHeight);
          
          ctx.fillStyle = hex(palette.secondary, 0.8);
          ctx.font = '9px "JetBrains Mono"';
          ctx.textAlign = 'left';
          ctx.fillText(zone.name.slice(0, 12), barX + 4, barY + 12);
        });
      }
      
      // HUD
      ctx.fillStyle = hex(palette.secondary, 0.7);
      ctx.font = '11px "JetBrains Mono"';
      ctx.textAlign = 'left';
      ctx.fillText(`${props.colorMode?.toUpperCase()} VIEW`, 16, 24);
      ctx.fillText(`INTENSITY: ${(props.movementIntensity * 100).toFixed(0)}%`, 16, 40);
      ctx.fillText(`DIRECTION: ${props.direction.toUpperCase()}`, 16, 56);
      
      ctx.textAlign = 'right';
      ctx.fillText(`TARGETS: ${objs.length}`, width - 16, 24);
      ctx.fillText(props.isActive ? '● SCANNING' : '○ STANDBY', width - 16, 40);

      rafRef.current = requestAnimationFrame(() => draw(t + 16));
    };

    draw(0);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="thermal-container glass-panel">
      <canvas ref={canvasRef} className="thermal-canvas" />
      <style jsx>{`
        .thermal-container {
          width: 100%;
          height: 100%;
          min-height: 350px;
          position: relative;
          overflow: hidden;
        }
        .thermal-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
      `}</style>
    </div>
  );
}
