import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
}

export class GoogleOAuthClient {
  private tokens: GoogleTokens | null = null;

  constructor(private config: GoogleOAuthConfig) {}

  async init(): Promise<void> {
    if (existsSync(this.config.tokenPath)) {
      const raw = readFileSync(this.config.tokenPath, "utf-8");
      this.tokens = JSON.parse(raw);
    } else {
      throw new Error(
        `Google OAuth tokens not found at ${this.config.tokenPath}. ` +
          "Run setup and complete Google OAuth authorization to authenticate.",
      );
    }
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error("OAuth not initialized");

    if (this.tokens.expiry_date < Date.now() + 60_000) {
      await this.refreshAccessToken();
    }

    return this.tokens.access_token;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      throw new Error("No refresh token — re-authenticate required");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      throw new Error(`OAuth refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokens.access_token = data.access_token;
    this.tokens.expiry_date = Date.now() + data.expires_in * 1000;

    await mkdir(dirname(this.config.tokenPath), { recursive: true });
    writeFileSync(this.config.tokenPath, JSON.stringify(this.tokens, null, 2));
  }

  generateAuthUrl(): string {
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ];
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCodeForTokens(code: string): Promise<void> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      throw new Error(`OAuth code exchange failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    };

    await mkdir(dirname(this.config.tokenPath), { recursive: true });
    writeFileSync(this.config.tokenPath, JSON.stringify(this.tokens, null, 2));
  }
}
