/**
 * Spike 0.5: Twilio outbound call validation
 *
 * Usage:
 *   TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_PHONE_NUMBER=... \
 *   TARGET_PHONE_NUMBER=... bun run scripts/spike-twilio-call.ts
 *
 * What to verify:
 * - Twilio REST API works without SDK (pure fetch)
 * - Russian TwiML <Say> reproduces speech
 * - Call status can be tracked via API
 */

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const TARGET_PHONE = process.env.TARGET_PHONE_NUMBER;

if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_PHONE || !TARGET_PHONE) {
  console.error("Error: Required environment variables:");
  console.error("  TWILIO_ACCOUNT_SID");
  console.error("  TWILIO_AUTH_TOKEN");
  console.error("  TWILIO_PHONE_NUMBER (your Twilio phone number)");
  console.error("  TARGET_PHONE_NUMBER (phone to call, e.g. +1234567890)");
  process.exit(1);
}

console.log(`From: ${TWILIO_PHONE}`);
console.log(`To: ${TARGET_PHONE}`);
console.log("---");

const twiml = `
<Response>
  <Say language="ru-RU">Привет! Это твой AI-ассистент. У тебя важное письмо.</Say>
  <Pause length="1"/>
  <Say language="ru-RU">Перезвони мне в Телеграм когда будет время.</Say>
</Response>`.trim();

console.log("TwiML:");
console.log(twiml);
console.log("---");

const response = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`,
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: TWILIO_PHONE,
      To: TARGET_PHONE,
      Twiml: twiml,
    }),
  },
);

if (!response.ok) {
  const errorText = await response.text();
  console.error(`API error ${response.status}: ${errorText}`);
  process.exit(1);
}

const result = (await response.json()) as {
  sid: string;
  status: string;
  date_created: string;
};

console.log(`Call SID: ${result.sid}`);
console.log(`Status: ${result.status}`);
console.log(`Created: ${result.date_created}`);
console.log("---");

if (result.sid) {
  console.log("PASS: Call initiated successfully");
  console.log("");
  console.log("Check call status:");
  console.log(
    `  curl -u "${TWILIO_SID}:${TWILIO_TOKEN}" https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${result.sid}.json | jq .status`,
  );
} else {
  console.log("FAIL: No call SID returned");
}
