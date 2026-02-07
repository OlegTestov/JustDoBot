/**
 * Spike 0.4: ffmpeg in Bun subprocess validation
 *
 * Usage: bun run scripts/spike-ffmpeg.ts
 *
 * What to verify:
 * - Bun.spawn(["ffmpeg", ...]) works
 * - Pipe stdin/stdout works for in-memory conversion (no temp files)
 * - PCM → OGG conversion via pipes
 * - ffmpeg is available in the environment
 */

// 1. Check ffmpeg availability
console.log("1. Checking ffmpeg availability...");
const version = Bun.spawn(["ffmpeg", "-version"], {
  stdout: "pipe",
  stderr: "pipe",
});
await version.exited;

if (version.exitCode !== 0) {
  console.error("FAIL: ffmpeg not found or errored");
  console.error("Install: brew install ffmpeg (macOS) / apt-get install ffmpeg (Linux)");
  process.exit(1);
}

const versionOutput = await new Response(version.stdout).text();
const firstLine = versionOutput.split("\n")[0];
console.log(`PASS: ${firstLine}`);
console.log("---");

// 2. Test pipe stdin/stdout (in-memory, no temp files)
console.log("2. Testing pipe stdin/stdout conversion...");

// Generate 1 second of silence: 24kHz, mono, 16-bit LE = 48000 bytes
const sampleRate = 24000;
const durationSec = 1;
const silence = new Uint8Array(sampleRate * 2 * durationSec); // 16-bit = 2 bytes per sample

const convert = Bun.spawn(
  [
    "ffmpeg",
    "-f",
    "s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    "-i",
    "pipe:0",
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    "-f",
    "ogg",
    "pipe:1",
  ],
  {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  },
);

convert.stdin.write(silence);
convert.stdin.end();

const output = await new Response(convert.stdout).arrayBuffer();
const exitCode = await convert.exited;

console.log(`Input: ${silence.byteLength} bytes PCM (${durationSec}s silence at ${sampleRate}Hz)`);
console.log(`Output: ${output.byteLength} bytes OGG`);
console.log(`Exit code: ${exitCode}`);

if (exitCode === 0 && output.byteLength > 0) {
  console.log("PASS: Pipe conversion successful");
} else {
  const stderr = await new Response(convert.stderr).text();
  console.error("FAIL: Pipe conversion failed");
  console.error(stderr);
  process.exit(1);
}

// Verify OGG header
const header = Buffer.from(output).subarray(0, 4).toString("ascii");
if (header === "OggS") {
  console.log("PASS: Valid OGG container (OggS header)");
} else {
  console.log(`WARN: Unexpected header: ${header}`);
}

console.log("---");

// 3. Test with actual audio content (sine wave)
console.log("3. Testing with sine wave audio...");

const sineWave = new Int16Array(sampleRate * durationSec);
const frequency = 440; // A4 note
for (let i = 0; i < sineWave.length; i++) {
  sineWave[i] = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 16000);
}

const sineConvert = Bun.spawn(
  [
    "ffmpeg",
    "-f",
    "s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    "-i",
    "pipe:0",
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    "-f",
    "ogg",
    "pipe:1",
  ],
  {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  },
);

sineConvert.stdin.write(new Uint8Array(sineWave.buffer));
sineConvert.stdin.end();

const sineOutput = await new Response(sineConvert.stdout).arrayBuffer();
const sineExit = await sineConvert.exited;

console.log(`Sine wave input: ${sineWave.byteLength} bytes`);
console.log(`OGG output: ${sineOutput.byteLength} bytes`);
console.log(`Exit code: ${sineExit}`);

if (sineExit === 0 && sineOutput.byteLength > 0) {
  console.log("PASS: Sine wave conversion successful");
} else {
  console.log("FAIL: Sine wave conversion failed");
}

console.log("---");
console.log("All ffmpeg tests completed.");
console.log(
  "Note: ffmpeg is only needed for Gemini TTS (PCM→OGG). ElevenLabs outputs OGG natively.",
);
