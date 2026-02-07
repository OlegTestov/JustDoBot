import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TwilioCallProvider } from "../../src/plugins/voice/twilio-calls/index";

let provider: TwilioCallProvider;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  provider = new TwilioCallProvider();
  originalFetch = globalThis.fetch;
  process.env.TWILIO_ACCOUNT_SID = "ACtest123";
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  process.env.TWILIO_PHONE_NUMBER = "+15551234567";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_PHONE_NUMBER;
});

describe("TwilioCallProvider", () => {
  describe("init", () => {
    test("throws without TWILIO_ACCOUNT_SID", async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      await expect(provider.init({ voice: { twilio: { phone_number: "" } } })).rejects.toThrow(
        "TWILIO_ACCOUNT_SID is not set",
      );
    });

    test("throws without TWILIO_AUTH_TOKEN", async () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      await expect(provider.init({ voice: { twilio: { phone_number: "" } } })).rejects.toThrow(
        "TWILIO_AUTH_TOKEN is not set",
      );
    });

    test("throws without phone number", async () => {
      delete process.env.TWILIO_PHONE_NUMBER;
      await expect(provider.init({ voice: { twilio: { phone_number: "" } } })).rejects.toThrow(
        "TWILIO_PHONE_NUMBER is not set",
      );
    });
  });

  describe("makeCall", () => {
    test("sends correct request", async () => {
      await provider.init({ voice: { twilio: { phone_number: "+15551234567" } } });

      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sid: "CA123", status: "queued" }),
          text: () => Promise.resolve(""),
        }),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await provider.makeCall("+1234567890", "Hello", "en");

      expect(result.callSid).toBe("CA123");
      expect(result.status).toBe("queued");

      // Verify fetch was called once
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];

      // Verify URL contains account SID
      expect(fetchUrl).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest123/Calls.json");

      // Verify method
      expect(fetchOptions.method).toBe("POST");

      // Verify auth header (Basic base64 of "ACtest123:test-auth-token")
      const expectedAuth = `Basic ${btoa("ACtest123:test-auth-token")}`;
      expect((fetchOptions.headers as Record<string, string>).Authorization).toBe(expectedAuth);

      // Verify content type
      expect((fetchOptions.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );

      // Verify body contains TwiML with correct voice and phone numbers
      const body = fetchOptions.body as string;
      expect(body).toContain("To=%2B1234567890");
      expect(body).toContain("From=%2B15551234567");
      expect(body).toContain("Polly.Joanna");
      expect(body).toContain("Hello");
    });

    test("throws on API error", async () => {
      await provider.init({ voice: { twilio: { phone_number: "+15551234567" } } });

      const mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Bad Request: invalid phone number"),
        }),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await expect(provider.makeCall("+invalid", "Hello", "en")).rejects.toThrow(
        "Twilio API error 400: Bad Request: invalid phone number",
      );
    });
  });
});
