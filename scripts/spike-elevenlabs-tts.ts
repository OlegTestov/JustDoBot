/**
 * Spike 0.3: ElevenLabs TTS validation
 *
 * Usage: ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... bun run scripts/spike-elevenlabs-tts.ts
 *
 * What to verify:
 * - @elevenlabs/elevenlabs-js installs and works in Bun
 * - output_format: "ogg_opus" produces Telegram-compatible OGG (no ffmpeg needed!)
 * - eleven_multilingual_v2 handles Russian + English
 * - Voice ID is configurable
 * - Response time < 3s for short text
 * - Premium voice quality
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Error: ELEVENLABS_API_KEY environment variable is required");
  process.exit(1);
}

const voiceId = process.env.ELEVENLABS_VOICE_ID;
if (!voiceId) {
  console.error("Error: ELEVENLABS_VOICE_ID environment variable is required");
  console.error(
    "Get voice IDs from: https://api.elevenlabs.io/v1/voices (or ElevenLabs dashboard)",
  );
  process.exit(1);
}

const modelId = process.argv[2] ?? "eleven_multilingual_v2";
const text = process.argv[3] ?? "Привет! Я твой AI-ассистент. Как дела?";

console.log(`Voice ID: ${voiceId}`);
console.log(`Model: ${modelId}`);
console.log(`Text: ${text}`);
console.log("---");

const client = new ElevenLabsClient({ apiKey });

// Generate OGG audio (Telegram-native format!)
const startTime = Date.now();

const audioStream = await client.textToSpeech.convert(voiceId, {
  text,
  model_id: modelId,
  output_format: "ogg_opus",
});

// Collect stream into Buffer
const chunks: Uint8Array[] = [];
for await (const chunk of audioStream) {
  chunks.push(chunk);
}
const audioBuffer = Buffer.concat(chunks);

const elapsed = Date.now() - startTime;

const outputPath = "/tmp/spike-elevenlabs.ogg";
await Bun.write(outputPath, audioBuffer);

console.log(`Audio size: ${audioBuffer.length} bytes`);
console.log(`Time: ${elapsed}ms`);
console.log(`Output: ${outputPath}`);
console.log("---");

if (audioBuffer.length > 0) {
  console.log("PASS: Audio received");
} else {
  console.log("FAIL: Empty audio");
}

if (elapsed < 5000) {
  console.log(`PASS: Response time ${elapsed}ms < 5000ms`);
} else {
  console.log(`WARN: Response time ${elapsed}ms >= 5000ms`);
}

// Verify OGG header (first 4 bytes should be "OggS")
const header = audioBuffer.subarray(0, 4).toString("ascii");
if (header === "OggS") {
  console.log("PASS: Valid OGG container (OggS header)");
} else {
  console.log(`WARN: Unexpected header: ${header} (expected OggS)`);
}

console.log("");
console.log("Listen to verify quality: open /tmp/spike-elevenlabs.ogg");
console.log("Key advantage: ogg_opus output — NO ffmpeg conversion needed!");
