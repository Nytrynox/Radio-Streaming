import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const AIRPORT_PATH =
  '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';

const SYSTEM_PROFILER_PATH = '/usr/sbin/system_profiler';

function parseSignalNoise(signalNoise: string | undefined): { rssi?: number; noise?: number; snr?: number } {
  if (!signalNoise) return {};
  // Example: "-70 dBm / -94 dBm"
  const match = signalNoise.match(/(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/i);
  if (!match) return {};
  const rssi = Number(match[1]);
  const noise = Number(match[2]);
  const snr = Number.isFinite(rssi) && Number.isFinite(noise) ? rssi - noise : undefined;
  return {
    rssi: Number.isFinite(rssi) ? rssi : undefined,
    noise: Number.isFinite(noise) ? noise : undefined,
    snr: Number.isFinite(snr) ? snr : undefined,
  };
}

function normalizeChannel(channel: string | undefined): string | undefined {
  if (!channel) return undefined;
  // Example: "7 (2GHz, 20MHz)" or "149 (5GHz, 80MHz)"
  const m = channel.match(/^\s*(\d+)/);
  return m ? m[1] : channel;
}

function makePseudoBssid(input: {
  ssid: string;
  channel?: string;
  security?: string;
  phymode?: string;
}) {
  const parts = [input.ssid, input.channel ?? '', input.security ?? '', input.phymode ?? '']
    .map(p => String(p).trim())
    .filter(Boolean);
  return parts.join('|') || 'unknown';
}

type SystemProfilerWifiNetwork = {
  _name?: string;
  spairport_network_channel?: string;
  spairport_security_mode?: string;
  spairport_network_phymode?: string;
  spairport_signal_noise?: string;
};

type SystemProfilerInterface = {
  _name?: string;
  spairport_current_network_information?: SystemProfilerWifiNetwork;
  spairport_airport_other_local_wireless_networks?: SystemProfilerWifiNetwork[];
};

function parseSystemProfilerWifi(jsonText: string): {
  iface: string;
  currentNetwork: any | null;
  nearbyNetworks: any[];
} {
  const data = JSON.parse(jsonText) as any;
  const first = Array.isArray(data?.SPAirPortDataType) ? data.SPAirPortDataType[0] : undefined;
  const interfaces: SystemProfilerInterface[] = Array.isArray(first?.spairport_airport_interfaces)
    ? first.spairport_airport_interfaces
    : [];

  const primary = interfaces.find(i => i?._name) ?? interfaces[0];
  const iface = primary?._name || 'en0';

  const cur = primary?.spairport_current_network_information;
  const other = primary?.spairport_airport_other_local_wireless_networks ?? [];

  const toNetwork = (n: SystemProfilerWifiNetwork | undefined | null) => {
    if (!n) return null;
    const ssid = n._name ?? '';
    const channelRaw = n.spairport_network_channel;
    const channel = normalizeChannel(channelRaw);
    const security = n.spairport_security_mode;
    const phymode = n.spairport_network_phymode;
    const { rssi, noise, snr } = parseSignalNoise(n.spairport_signal_noise);
    // If RSSI is missing, this entry is unreliable. Returning a placeholder (e.g. -90)
    // causes huge deltas between scans and looks like "fake" activity.
    if (rssi === undefined) return null;
    const bssid = makePseudoBssid({ ssid, channel, security, phymode });
    return {
      ssid,
      bssid,
      rssi,
      channel,
      noise,
      snr,
      security,
    };
  };

  const currentNetwork = toNetwork(cur);
  const nearbyNetworks = other.map(toNetwork).filter(Boolean) as any[];

  return {
    iface,
    currentNetwork,
    nearbyNetworks,
  };
}

function parseAirportInfo(output: string) {
  const lines = output
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const kv: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    kv[key] = value;
  }

  const ssid = kv.SSID ?? '';
  const bssid = kv.BSSID ?? '';

  const rssi = Number(kv.agrCtlRSSI);
  const noise = Number(kv.agrCtlNoise);
  const channel = kv.channel;

  const snr = Number.isFinite(rssi) && Number.isFinite(noise) ? rssi - noise : undefined;

  if (!ssid && !bssid) return null;

  return {
    ssid,
    bssid,
    rssi: Number.isFinite(rssi) ? rssi : -90,
    noise: Number.isFinite(noise) ? noise : undefined,
    snr: Number.isFinite(snr) ? snr : undefined,
    channel,
  };
}

function parseAirportScan(output: string) {
  const lines = output
    .split('\n')
    .map(l => l.replace(/\r/g, ''))
    .filter(Boolean);

  // First line is header.
  const dataLines = lines.slice(1);

  const networks: Array<{
    ssid: string;
    bssid: string;
    rssi: number;
    channel?: string;
    security?: string;
  }> = [];

  for (const rawLine of dataLines) {
    const line = rawLine.trimEnd();
    const bssidMatch = line.match(/([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
    if (!bssidMatch || bssidMatch.index == null) continue;

    const bssid = bssidMatch[1];
    const ssidPart = line.slice(0, bssidMatch.index).trim();
    const after = line.slice(bssidMatch.index + bssid.length).trim();

    const parts = after.split(/\s+/);
    const rssi = Number(parts[0]);
    const channel = parts[1];
    const security = parts.slice(4).join(' ');

    if (!Number.isFinite(rssi)) continue;

    networks.push({
      ssid: ssidPart,
      bssid,
      rssi,
      channel,
      security: security || undefined,
    });
  }

  return networks;
}

export async function GET() {
  try {
    // Prefer airport when available (older macOS versions), else fall back to system_profiler (newer macOS).
    let hasAirport = false;
    try {
      await access(AIRPORT_PATH);
      hasAirport = true;
    } catch {
      hasAirport = false;
    }

    if (hasAirport) {
      const [{ stdout: infoOut }, { stdout: scanOut }] = await Promise.all([
        execFileAsync(AIRPORT_PATH, ['-I'], { timeout: 4000 }),
        execFileAsync(AIRPORT_PATH, ['-s'], { timeout: 6000 }),
      ]);

      const currentNetwork = parseAirportInfo(String(infoOut));
      const allNetworks = parseAirportScan(String(scanOut));

      const nearbyNetworks = currentNetwork
        ? allNetworks.filter(n => n.bssid.toLowerCase() !== currentNetwork.bssid.toLowerCase())
        : allNetworks;

      return NextResponse.json({
        timestamp: Date.now(),
        interface: 'en0',
        currentNetwork,
        nearbyNetworks,
      });
    }

    const { stdout } = await execFileAsync(
      SYSTEM_PROFILER_PATH,
      ['SPAirPortDataType', '-json'],
      {
        timeout: 12000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const parsed = parseSystemProfilerWifi(String(stdout));
    return NextResponse.json({
      timestamp: Date.now(),
      interface: parsed.iface,
      currentNetwork: parsed.currentNetwork,
      nearbyNetworks: parsed.nearbyNetworks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Common cause on macOS: Location Services permission is required for WiFi scanning.
    // We return a helpful message instead of failing silently.
    return NextResponse.json(
      {
        error: 'wifi_scan_failed',
        message,
        hint:
          'On macOS, WiFi data access may require Location Services enabled for your terminal/IDE (System Settings → Privacy & Security → Location Services). If `airport` is missing, this endpoint falls back to `system_profiler SPAirPortDataType -json` which can be slower.',
      },
      { status: 500 },
    );
  }
}
