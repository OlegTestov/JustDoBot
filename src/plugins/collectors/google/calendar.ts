import type { GoogleOAuthClient } from "./oauth";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

export class CalendarClient {
  constructor(private oauth: GoogleOAuthClient) {}

  async getUpcomingEvents(maxDays = 2): Promise<CalendarEvent[]> {
    const token = await this.oauth.getAccessToken();
    const now = new Date();
    const end = new Date(now.getTime() + maxDays * 86400 * 1000);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      throw new Error(`Calendar API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        location?: string;
        description?: string;
      }>;
    };

    if (!data.items || data.items.length === 0) {
      return [];
    }

    return data.items.map((event) => ({
      id: event.id,
      summary: event.summary ?? "(No title)",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      location: event.location,
      description: event.description,
    }));
  }
}
