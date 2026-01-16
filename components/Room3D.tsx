'use client';

import { useEffect, useRef } from 'react';
import type { DetectedObject } from '../lib/real-wifi-scanner';
import type { Position2D } from '../lib/types';

interface Room3DProps {
  detectedObjects: DetectedObject[];
  movementIntensity: number;
  position?: Position2D;
  heatmap?: number[][];
  isActive: boolean;
}

interface Point3D { x: number; y: number; z: number; }
interface Point2D { x: number; y: number; scale: number; depth: number; }

export default function Room3D({ detectedObjects, movementIntensity, isActive }: Room3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const cameraAngleRef = useRef(0);
  const cameraVelocityRef = useRef(0.008);
  
  const latestRef = useRef({ detectedObjects, movementIntensity, isActive });

  useEffect(() => {
    latestRef.current = { detectedObjects, movementIntensity, isActive };
  }, [detectedObjects, movementIntensity, isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0, height = 0;
    const fov = 500;
    const camHeight = -80;

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

    const project = (p: Point3D, angle: number): Point2D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = p.x * cos - p.z * sin;
      const rz = p.x * sin + p.z * cos;
      
      const depth = rz + 500;
      const scale = fov / Math.max(1, depth);
      const x2d = rx * scale + width / 2;
      const y2d = (p.y - camHeight) * scale + height / 2;
      
      return { x: x2d, y: y2d, scale: Math.max(0, scale), depth };
    };

    const draw = (t: number) => {
      if (!ctx) return;
      const { detectedObjects: objs, movementIntensity: intensity, isActive: active } = latestRef.current;
      
      // Smooth camera rotation
      if (active) {
        cameraAngleRef.current += cameraVelocityRef.current;
      }
      const angle = cameraAngleRef.current;
      
      // Clear with gradient
      const bgGrad = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
      bgGrad.addColorStop(0, '#0a1018');
      bgGrad.addColorStop(1, '#020408');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);
      
      // Holographic Grid Floor with wave animation
      const gridSize = 600;
      const step = 60;
      const floorY = 80;
      
      ctx.lineWidth = 1;
      
      // Draw grid lines with depth fade
      for (let x = -gridSize; x <= gridSize; x += step) {
        const points: Point2D[] = [];
        for (let z = -gridSize; z <= gridSize; z += step/2) {
          // Wave animation
          const wave = Math.sin((x + z) * 0.01 + t * 0.002) * 5 * intensity;
          const pt = project({ x, y: floorY + wave, z }, angle);
          points.push(pt);
        }
        
        ctx.beginPath();
        points.forEach((pt, i) => {
          const alpha = Math.max(0, 0.3 - pt.depth / 2000);
          ctx.strokeStyle = `rgba(0, 255, 157, ${alpha})`;
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      }
      
      for (let z = -gridSize; z <= gridSize; z += step) {
        const points: Point2D[] = [];
        for (let x = -gridSize; x <= gridSize; x += step/2) {
          const wave = Math.sin((x + z) * 0.01 + t * 0.002) * 5 * intensity;
          const pt = project({ x, y: floorY + wave, z }, angle);
          points.push(pt);
        }
        
        ctx.beginPath();
        points.forEach((pt, i) => {
          const alpha = Math.max(0, 0.3 - pt.depth / 2000);
          ctx.strokeStyle = `rgba(0, 255, 157, ${alpha})`;
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      }

      // Center beacon
      const beaconPulse = (Math.sin(t * 0.005) + 1) / 2;
      const beaconBase = project({ x: 0, y: floorY, z: 0 }, angle);
      const beaconTop = project({ x: 0, y: 30, z: 0 }, angle);
      
      // Beacon glow
      const beaconGrad = ctx.createRadialGradient(
        beaconBase.x, beaconBase.y, 0,
        beaconBase.x, beaconBase.y, 50 * beaconBase.scale
      );
      beaconGrad.addColorStop(0, `rgba(0, 255, 157, ${0.3 + beaconPulse * 0.2})`);
      beaconGrad.addColorStop(1, 'rgba(0, 255, 157, 0)');
      ctx.fillStyle = beaconGrad;
      ctx.beginPath();
      ctx.arc(beaconBase.x, beaconBase.y, 50 * beaconBase.scale, 0, Math.PI * 2);
      ctx.fill();
      
      // Beacon line
      ctx.strokeStyle = `rgba(0, 255, 157, ${0.5 + beaconPulse * 0.5})`;
      ctx.lineWidth = 2 * beaconBase.scale;
      ctx.beginPath();
      ctx.moveTo(beaconBase.x, beaconBase.y);
      ctx.lineTo(beaconTop.x, beaconTop.y);
      ctx.stroke();
      
      // Beacon top dot
      ctx.fillStyle = '#00ff9d';
      ctx.beginPath();
      ctx.arc(beaconTop.x, beaconTop.y, 4 * beaconTop.scale, 0, Math.PI * 2);
      ctx.fill();

      // Draw detected objects
      if (objs.length === 0 && active) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '14px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText('SCANNING ENVIRONMENT...', width / 2, height / 2);
      } else {
        objs.forEach((obj, i) => {
          const objAngle = (i / Math.max(1, objs.length)) * Math.PI * 2;
          const dist = 80 + (obj.distance || 5) * 25;
          
          const x = Math.cos(objAngle) * dist;
          const z = Math.sin(objAngle) * dist;
          const floatY = 40 + Math.sin(t * 0.003 + i * 2) * 15;
          
          const pt = project({ x, y: floatY, z }, angle);
          const floorPt = project({ x, y: floorY, z }, angle);
          
          if (pt.scale > 0.1) {
            // Laser connection to floor
            const laserGrad = ctx.createLinearGradient(pt.x, pt.y, floorPt.x, floorPt.y);
            laserGrad.addColorStop(0, 'rgba(255, 42, 109, 0.8)');
            laserGrad.addColorStop(1, 'rgba(255, 42, 109, 0)');
            
            ctx.strokeStyle = laserGrad;
            ctx.lineWidth = 2 * pt.scale;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(floorPt.x, floorPt.y);
            ctx.stroke();
            
            // Floor ripple
            const ripplePhase = (t * 0.01 + i) % (Math.PI * 2);
            const rippleSize = 20 + Math.sin(ripplePhase) * 10;
            ctx.strokeStyle = `rgba(255, 42, 109, ${0.3 + Math.sin(ripplePhase) * 0.2})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(floorPt.x, floorPt.y, rippleSize * pt.scale, rippleSize * pt.scale * 0.4, 0, 0, Math.PI * 2);
            ctx.stroke();
            
            // Object sphere with glow
            const r = (8 + obj.confidence * 12) * pt.scale;
            const pulse = 1 + Math.sin(t * 0.008 + i) * 0.15;
            
            ctx.save();
            ctx.shadowColor = '#ff2a6d';
            ctx.shadowBlur = 20;
            ctx.fillStyle = `rgba(255, 42, 109, ${0.7 + obj.confidence * 0.3})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            // Inner highlight
            ctx.fillStyle = 'rgba(255, 150, 180, 0.5)';
            ctx.beginPath();
            ctx.arc(pt.x - r * 0.2, pt.y - r * 0.2, r * 0.3, 0, Math.PI * 2);
            ctx.fill();
            
            // Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = `${Math.max(8, 10 * pt.scale)}px "JetBrains Mono"`;
            ctx.textAlign = 'center';
            ctx.fillText(obj.sourceNetwork?.slice(0, 10) || `SIG-${i+1}`, pt.x, pt.y + r + 12 * pt.scale);
          }
        });
      }

      // HUD overlay
      ctx.fillStyle = 'rgba(0, 255, 157, 0.6)';
      ctx.font = '11px "JetBrains Mono"';
      ctx.textAlign = 'left';
      ctx.fillText('HOLOGRAPHIC VIEW // 3D', 16, 24);
      ctx.fillText(`CAM: ${((angle * 180 / Math.PI) % 360).toFixed(0)}°`, 16, 40);
      ctx.fillText(`TARGETS: ${objs.length}`, 16, 56);
      
      ctx.textAlign = 'right';
      ctx.fillText(active ? '● ACTIVE' : '○ STANDBY', width - 16, 24);

      rafRef.current = requestAnimationFrame(() => draw(t + 16));
    };

    draw(0);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="room3d-container glass-panel">
      <canvas ref={canvasRef} className="room3d-canvas" />
      <style jsx>{`
        .room3d-container {
          width: 100%;
          height: 100%;
          min-height: 350px;
          position: relative;
          overflow: hidden;
        }
        .room3d-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
      `}</style>
    </div>
  );
}
