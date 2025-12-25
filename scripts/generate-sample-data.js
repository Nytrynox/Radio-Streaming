const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'sample_csi.csv');

// Create directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Config for "Real" Data Simulation (Intel 5300 NIC / ESP32 style)
const SUBCARRIERS = 64; // Standard 802.11n/ac subcarriers
const PACKETS = 2000; // ~20 seconds at 100Hz
const SAMPLE_RATE = 100; // Hz

const stream = fs.createWriteStream(OUTPUT_FILE);

// Header: timestamp, amp_1, phase_1, amp_2, phase_2, ...
let header = 'timestamp';
for (let i = 0; i < SUBCARRIERS; i++) {
  header += `,amp_${i},phase_${i}`;
}
stream.write(header + '\n');

console.log('Generating realistic WiFi CSI data...');

let timestamp = 0;

// Base channel response (multipath fading effect)
const channelResponse = Array.from({ length: SUBCARRIERS }, () => Math.random() * 30 + 40);

for (let i = 0; i < PACKETS; i++) {
  timestamp += 1000 / SAMPLE_RATE; // ms
  
  // Simulate Human Breathing (Periodic sine wave modulation on specific subcarriers)
  const breathingFreq = 0.3; // Hz (approx 18 breaths/min)
  const breathingEffect = Math.sin((timestamp / 1000) * 2 * Math.PI * breathingFreq) * 5;
  
  // Simulate "Wall" attenuation changes (sudden drops/spikes simulating movement behind wall)
  // Let's say movement happens between t=5s and t=15s
  let movementEffect = 0;
  if (i > 500 && i < 1500) {
     movementEffect = (Math.random() - 0.5) * 10; // High frequency noise due to Doppler
  }

  let row = `${timestamp.toFixed(2)}`;
  
  for (let s = 0; s < SUBCARRIERS; s++) {
    // Amplitude: Base + Breathing (on some subs) + Noise + Movement
    let amp = channelResponse[s];
    
    // Breathing affects central subcarriers more
    if (s > 20 && s < 45) {
        amp += breathingEffect;
    }
    
    // Add Gaussian Noise
    amp += (Math.random() - 0.5) * 2;
    
    // Add movement scattering
    amp += movementEffect;
    
    // Phase: Random walk but coherent across subcarriers
    // Real phase needs sanitization, but for raw visualization we simulate linear phase + noise
    const phase = (s * 0.5 + (timestamp / 1000) + (Math.random() * 0.1)) % (2 * Math.PI);
    
    row += `,${amp.toFixed(2)},${phase.toFixed(4)}`;
  }
  
  stream.write(row + '\n');
}

stream.end();
console.log(`Generated ${PACKETS} packets of CSI data at ${OUTPUT_FILE}`);
