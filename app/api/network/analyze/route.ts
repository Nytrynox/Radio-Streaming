import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface NetworkDevice {
  ip: string;
  mac: string;
  hostname?: string;
  interface: string;
  lastActive: number;
  isOnline: boolean;
  activityScore: number;
}

function parseArpTable(output: string): NetworkDevice[] {
  const devices: NetworkDevice[] = [];
  const lines = output.split('\n').filter(Boolean);
  
  for (const line of lines) {
    // Format: hostname (IP) at MAC on interface [ifscope ...]
    // or: ? (IP) at MAC on interface
    const match = line.match(/^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)\s+on\s+(\S+)/i);
    
    if (match) {
      const hostname = match[1] !== '?' ? match[1] : undefined;
      const ip = match[2];
      const mac = match[3];
      const iface = match[4];
      
      // Skip incomplete entries and broadcast
      if (mac === '(incomplete)' || mac === 'ff:ff:ff:ff:ff:ff') continue;
      // Skip multicast
      if (ip.startsWith('224.') || ip.startsWith('239.')) continue;
      
      devices.push({
        ip,
        mac,
        hostname,
        interface: iface,
        lastActive: Date.now(),
        isOnline: true,
        activityScore: 0.5,
      });
    }
  }
  
  return devices;
}

async function getActiveConnections(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-an'], { timeout: 5000 });
    const established = stdout.split('\n').filter(line => line.includes('ESTABLISHED')).length;
    return established;
  } catch {
    return 0;
  }
}

async function getInterfaceStats(): Promise<{ bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-ib'], { timeout: 5000 });
    const lines = stdout.split('\n');
    
    // Find en0 line
    const en0Line = lines.find(line => line.startsWith('en0'));
    if (en0Line) {
      const parts = en0Line.split(/\s+/);
      // Columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
      return {
        packetsIn: parseInt(parts[4]) || 0,
        bytesIn: parseInt(parts[6]) || 0,
        packetsOut: parseInt(parts[7]) || 0,
        bytesOut: parseInt(parts[9]) || 0,
      };
    }
  } catch {}
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0 };
}

export async function GET() {
  try {
    // Get REAL ARP table data
    const { stdout: arpOut } = await execFileAsync('arp', ['-a'], { timeout: 5000 });
    const devices = parseArpTable(arpOut);
    
    // Get active connections count
    const activeConnections = await getActiveConnections();
    
    // Get interface stats for activity measurement
    const ifStats = await getInterfaceStats();

    return NextResponse.json({
      timestamp: Date.now(),
      devices,
      activeConnections,
      interfaceStats: ifStats,
      recentActivity: devices.map(d => ({
        device: d.hostname || d.mac,
        action: 'online',
        time: Date.now(),
      })),
      source: 'arp_table',
      isRealData: true,
    });
  } catch (err) {
    return NextResponse.json(
      { 
        error: 'network_analysis_failed', 
        message: err instanceof Error ? err.message : String(err),
        isRealData: false,
      },
      { status: 500 }
    );
  }
}
