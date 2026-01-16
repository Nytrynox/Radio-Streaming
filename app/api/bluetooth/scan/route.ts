import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface BluetoothDevice {
  address: string;
  name: string;
  rssi: number;
  isConnected: boolean;
  lastSeen: number;
  deviceType: string;
  firmwareVersion?: string;
  minorType?: string;
}

function guessDeviceType(name: string, minorType?: string): string {
  const n = (name + ' ' + (minorType || '')).toLowerCase();
  if (n.includes('iphone') || n.includes('android') || n.includes('phone')) return 'phone';
  if (n.includes('macbook') || n.includes('laptop') || n.includes('mac')) return 'laptop';
  if (n.includes('airpod') || n.includes('headphone') || n.includes('buds') || n.includes('headset')) return 'headphones';
  if (n.includes('watch') || n.includes('band')) return 'watch';
  if (n.includes('speaker') || n.includes('homepod') || n.includes('audio')) return 'speaker';
  if (n.includes('mouse') || n.includes('keyboard') || n.includes('trackpad')) return 'input';
  return 'unknown';
}

function parseSystemProfilerBluetooth(jsonText: string): {
  devices: BluetoothDevice[];
  connectedDevice: BluetoothDevice | null;
  controllerAddress: string;
} {
  const devices: BluetoothDevice[] = [];
  let connectedDevice: BluetoothDevice | null = null;
  let controllerAddress = '';

  try {
    const data = JSON.parse(jsonText);
    const btData = data?.SPBluetoothDataType?.[0];
    
    if (!btData) {
      return { devices, connectedDevice, controllerAddress };
    }

    // Get controller info
    controllerAddress = btData.controller_properties?.controller_address || '';

    // Parse connected devices
    const connectedDevices = btData.device_connected || btData.devices_connected || [];
    for (const deviceGroup of connectedDevices) {
      for (const [name, info] of Object.entries(deviceGroup)) {
        const deviceInfo = info as any;
        const device: BluetoothDevice = {
          address: deviceInfo.device_address || '',
          name: name,
          rssi: -35, // Connected devices have strong signal
          isConnected: true,
          lastSeen: Date.now(),
          deviceType: guessDeviceType(name, deviceInfo.device_minorType),
          firmwareVersion: deviceInfo.device_firmwareVersion,
          minorType: deviceInfo.device_minorType,
        };
        devices.push(device);
        if (!connectedDevice) connectedDevice = device;
      }
    }

    // Parse not connected (paired) devices
    const notConnectedDevices = btData.device_not_connected || btData.devices_not_connected || [];
    for (const deviceGroup of notConnectedDevices) {
      for (const [name, info] of Object.entries(deviceGroup)) {
        const deviceInfo = info as any;
        const device: BluetoothDevice = {
          address: deviceInfo.device_address || '',
          name: name,
          rssi: -70, // Not connected = weaker estimated signal
          isConnected: false,
          lastSeen: Date.now(),
          deviceType: guessDeviceType(name, deviceInfo.device_minorType),
          firmwareVersion: deviceInfo.device_firmwareVersion,
          minorType: deviceInfo.device_minorType,
        };
        devices.push(device);
      }
    }

  } catch (err) {
    console.error('Failed to parse Bluetooth data:', err);
  }

  return { devices, connectedDevice, controllerAddress };
}

export async function GET() {
  try {
    // Use system_profiler to get REAL Bluetooth data
    const { stdout } = await execFileAsync(
      '/usr/sbin/system_profiler',
      ['SPBluetoothDataType', '-json'],
      { timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
    );

    const { devices, connectedDevice, controllerAddress } = parseSystemProfilerBluetooth(stdout);

    return NextResponse.json({
      timestamp: Date.now(),
      devices,
      connectedDevice,
      controllerAddress,
      source: 'system_profiler', // Indicate this is REAL data
      isRealData: true,
    });
  } catch (err) {
    console.error('Bluetooth scan error:', err);
    return NextResponse.json(
      { 
        error: 'bluetooth_scan_failed', 
        message: err instanceof Error ? err.message : String(err),
        hint: 'Bluetooth scanning requires system_profiler access',
        isRealData: false,
      },
      { status: 500 }
    );
  }
}
