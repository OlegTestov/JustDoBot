export class SessionManager {
  private sessions = new Map<number, { sessionId: string; lastActivity: number }>();
  private timeoutMs: number;

  constructor(timeoutHours: number) {
    this.timeoutMs = timeoutHours * 60 * 60 * 1000;
  }

  getSessionId(chatId: number): string {
    const existing = this.sessions.get(chatId);
    const now = Date.now();

    if (existing && now - existing.lastActivity < this.timeoutMs) {
      existing.lastActivity = now;
      return existing.sessionId;
    }

    const sessionId = crypto.randomUUID();
    this.sessions.set(chatId, { sessionId, lastActivity: now });
    return sessionId;
  }

  clearSession(chatId: number): string {
    const sessionId = crypto.randomUUID();
    this.sessions.set(chatId, { sessionId, lastActivity: Date.now() });
    return sessionId;
  }

  getLastActivity(chatId: number): number | null {
    return this.sessions.get(chatId)?.lastActivity ?? null;
  }
}
