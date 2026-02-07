/**
 * Spike 0.2: Gemini 2.5 Flash Preview TTS validation
 *
 * Usage: GEMINI_API_KEY=... bun run scripts/spike-gemini-tts.ts
 *
 * What to verify:
 * - Gemini returns base64 PCM audio in inlineData.data
 * - PCM → OGG conversion via ffmpeg works
 * - Voice quality is acceptable
 * - voiceName parameter works (Kore, Puck, Charon — 30 variants)
 * - Russian text → Russian speech
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const model = "gemini-2.5-flash-preview-tts";
const voiceName = process.argv[2] ?? "Kore";
const text = process.argv[3] ?? "Привет! Я твой AI-ассистент. Чем могу помочь?";

console.log(`Model: ${model}`);
console.log(`Voice: ${voiceName}`);
console.log(`Text: ${text}`);
console.log("---");

// 1. Generate audio via Gemini TTS
const startTime = Date.now();

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    }),
  },
);

const apiElapsed = Date.now() - startTime;

if (!response.ok) {
  const errorText = await response.text();
  console.error(`API error ${response.status}: ${errorText}`);
  process.exit(1);
}

const result = (await response.json()) as {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data: string; mimeType: string } }>;
    };
  }>;
};

const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
const audioMime = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;

if (!audioData) {
  console.error("FAIL: No audio data in response");
  console.log("Response:", JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`API time: ${apiElapsed}ms`);
console.log(`Audio MIME: ${audioMime}`);
console.log(`Base64 length: ${audioData.length} chars`);

// 2. Decode PCM
const pcmBuffer = Buffer.from(audioData, "base64");
console.log(`PCM size: ${pcmBuffer.length} bytes`);

// 3. Convert PCM → OGG via ffmpeg
const pcmPath = "/tmp/spike-gemini-tts.pcm";
const oggPath = "/tmp/spike-gemini-tts.ogg";

await Bun.write(pcmPath, pcmBuffer);

const convertStart = Date.now();
const proc = Bun.spawn(
  [
    "ffmpeg",
    "-y",
    "-f",
    "s16le",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-i",
    pcmPath,
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    oggPath,
  ],
  { stdout: "pipe", stderr: "pipe" },
);
await proc.exited;
const convertElapsed = Date.now() - convertStart;

if (proc.exitCode !== 0) {
  const stderr = await new Response(proc.stderr).text();
  console.error(`FAIL: ffmpeg conversion failed (exit ${proc.exitCode})`);
  console.error(stderr);
  process.exit(1);
}

const oggFile = Bun.file(oggPath);
const oggSize = (await oggFile.arrayBuffer()).byteLength;

console.log(`OGG size: ${oggSize} bytes`);
console.log(`Convert time: ${convertElapsed}ms`);
console.log("---");

console.log(`Output file: ${oggPath}`);
console.log("Listen to verify voice quality: open /tmp/spike-gemini-tts.ogg");
console.log("");

if (audioData) console.log("PASS: Audio data received");
if (oggSize > 0) console.log("PASS: OGG conversion successful");
if (apiElapsed < 10000) {
  console.log(`PASS: API time ${apiElapsed}ms < 10000ms`);
} else {
  console.log(`WARN: API time ${apiElapsed}ms >= 10000ms`);
}
