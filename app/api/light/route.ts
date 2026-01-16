import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Store previous reading for change detection
let previousReading = { lux: 0, timestamp: 0 };

export async function GET() {
  try {
    // Get REAL backlight/brightness data from AppleARMBacklight (Apple Silicon)
    const { stdout } = await execFileAsync(
      'ioreg',
      ['-r', '-c', 'AppleARMBacklight'],
      { timeout: 5000 }
    );

    let milliNits = 0;
    let rawBrightness = 0;
    let uncalMilliNits = 0;

    // Parse BrightnessMilliNits value
    const milliNitsMatch = stdout.match(/"BrightnessMilliNits"=\{[^}]*"value"=(\d+)/);
    if (milliNitsMatch) {
      milliNits = parseInt(milliNitsMatch[1], 10);
    }

    // Parse rawBrightness
    const rawMatch = stdout.match(/"rawBrightness"=\{[^}]*"value"=(\d+)/);
    if (rawMatch) {
      rawBrightness = parseInt(rawMatch[1], 10);
    }

    // Parse uncalMilliNits
    const uncalMatch = stdout.match(/"uncalMilliNits"=(\d+)/);
    if (uncalMatch) {
      uncalMilliNits = parseInt(uncalMatch[1], 10);
    }

    // Convert milliNits to approximate lux
    // 1 nit ≈ 3.426 lux (rough approximation for reflected light perception)
    // milliNits / 1000 = nits, then * 3.426 ≈ lux
    const nits = milliNits / 1000;
    const estimatedLux = Math.round(nits * 3.5);

    // Calculate change from previous reading
    const now = Date.now();
    const change = estimatedLux - previousReading.lux;
    const timeDelta = now - previousReading.timestamp;
    
    // Detect shadow if significant drop in short time
    const shadowDetected = timeDelta < 5000 && change < -previousReading.lux * 0.15;

    // Update previous
    previousReading = { lux: estimatedLux, timestamp: now };

    return NextResponse.json({
      timestamp: now,
      lux: estimatedLux,
      nits: nits,
      milliNits: milliNits,
      rawBrightness: rawBrightness,
      uncalMilliNits: uncalMilliNits,
      change: change,
      shadowDetected: shadowDetected,
      source: 'AppleARMBacklight',
      isRealData: true,
    });
  } catch (err) {
    // Fallback: try Intel Mac method
    try {
      const { stdout } = await execFileAsync(
        'ioreg',
        ['-c', 'AppleLMUController'],
        { timeout: 3000 }
      );

      const alsMatch = stdout.match(/"ALSSensorReading"\s*=\s*(\d+)/i)
                    || stdout.match(/"CurrentReading"\s*=\s*(\d+)/i);
      
      if (alsMatch) {
        const rawValue = parseInt(alsMatch[1], 10);
        const lux = Math.round(rawValue / 10);

        return NextResponse.json({
          timestamp: Date.now(),
          lux: lux,
          raw: rawValue,
          source: 'AppleLMUController',
          isRealData: true,
        });
      }
    } catch {}

    // If all else fails, return error
    return NextResponse.json(
      {
        timestamp: Date.now(),
        lux: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        source: 'none',
        isRealData: false,
        hint: 'Light sensor access may require permissions or different hardware',
      },
      { status: 500 }
    );
  }
}
