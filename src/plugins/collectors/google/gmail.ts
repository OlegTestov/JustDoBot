import type { GoogleOAuthClient } from "./oauth";

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
}

export class GmailClient {
  constructor(private oauth: GoogleOAuthClient) {}

  async getImportantUnread(maxDays = 7): Promise<GmailMessage[]> {
    const token = await this.oauth.getAccessToken();
    const after = Math.floor(Date.now() / 1000) - maxDays * 86400;
    const query = `is:unread is:important after:${after}`;

    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!listResponse.ok) {
      throw new Error(`Gmail API error: ${listResponse.status}`);
    }

    const listData = (await listResponse.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
    };

    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }

    const detailResults = await Promise.allSettled(
      listData.messages.map((msg) =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => (r.ok ? r.json() : null)),
      ),
    );

    const messages: GmailMessage[] = [];
    for (const result of detailResults) {
      if (result.status !== "fulfilled" || !result.value) continue;

      const detail = result.value as {
        id: string;
        threadId: string;
        snippet: string;
        internalDate: string;
        payload: {
          headers: Array<{ name: string; value: string }>;
        };
      };

      const headers = detail.payload.headers;
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(No subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "Unknown";

      messages.push({
        id: detail.id,
        threadId: detail.threadId,
        subject,
        from,
        snippet: detail.snippet,
        date: new Date(Number(detail.internalDate)).toISOString(),
      });
    }

    return messages;
  }
}
