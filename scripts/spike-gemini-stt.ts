/**
 * Spike 0.1: Gemini 2.5 Flash STT validation
 *
 * Usage: GEMINI_API_KEY=... bun run scripts/spike-gemini-stt.ts [path-to-audio.oga]
 *
 * What to verify:
 * - OGG/Opus file (.oga from Telegram) accepted with MIME type "audio/ogg"
 * - Russian and English speech transcribed accurately
 * - Response time < 5s for 30-second message
 * - Prompt doesn't add extra commentary to transcription
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const audioPath = process.argv[2];
if (!audioPath) {
  console.error("Usage: bun run scripts/spike-gemini-stt.ts <path-to-audio-file>");
  console.error("Example: bun run scripts/spike-gemini-stt.ts ./test-voice.oga");
  process.exit(1);
}

const model = "gemini-2.5-flash";
const audioFile = Bun.file(audioPath);

if (!(await audioFile.exists())) {
  console.error(`File not found: ${audioPath}`);
  process.exit(1);
}

const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
const base64Audio = audioBuffer.toString("base64");

// Determine MIME type from extension
const ext = audioPath.split(".").pop()?.toLowerCase() ?? "ogg";
const mimeMap: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};
const mimeType = mimeMap[ext] ?? `audio/${ext}`;

console.log(`File: ${audioPath}`);
console.log(`Size: ${audioBuffer.length} bytes`);
console.log(`MIME: ${mimeType}`);
console.log(`Model: ${model}`);
console.log("---");

const startTime = Date.now();

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            {
              text: "Transcribe this audio message exactly as spoken. Return only the transcription text, nothing else. No quotes, no labels, no commentary.",
            },
          ],
        },
      ],
    }),
  },
);

const elapsed = Date.now() - startTime;

if (!response.ok) {
  const errorText = await response.text();
  console.error(`API error ${response.status}: ${errorText}`);
  process.exit(1);
}

const result = (await response.json()) as {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const transcription = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

console.log(`Status: ${response.status}`);
console.log(`Time: ${elapsed}ms`);
console.log(`Transcription: ${transcription ?? "(empty)"}`);
console.log(`Chars: ${transcription?.length ?? 0}`);
console.log("---");

if (transcription) {
  console.log("PASS: Transcription received");
} else {
  console.log("FAIL: Empty transcription");
}
if (elapsed < 5000) {
  console.log(`PASS: Response time ${elapsed}ms < 5000ms`);
} else {
  console.log(`WARN: Response time ${elapsed}ms >= 5000ms`);
}
