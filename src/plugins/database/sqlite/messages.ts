import type { Database } from "bun:sqlite";
import type { Message } from "../../../core/interfaces";

export class MessageRepository {
  private stmtInsert;
  private stmtGetRecent;
  private stmtGetLastTime;

  constructor(db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO messages (session_id, role, content, telegram_message_id, media_type, media_url)
      VALUES ($session_id, $role, $content, $telegram_message_id, $media_type, $media_url)
    `);

    this.stmtGetRecent = db.prepare(`
      SELECT * FROM messages
      WHERE session_id = $session_id
      ORDER BY id DESC
      LIMIT $limit
    `);

    this.stmtGetLastTime = db.prepare(`
      SELECT created_at FROM messages
      WHERE session_id = $session_id
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  saveMessage(msg: Message): void {
    this.stmtInsert.run({
      $session_id: msg.session_id,
      $role: msg.role,
      $content: msg.content,
      $telegram_message_id: msg.telegram_message_id ?? null,
      $media_type: msg.media_type ?? null,
      $media_url: msg.media_url ?? null,
    });
  }

  getRecentMessages(limit: number, sessionId: string): Message[] {
    const rows = this.stmtGetRecent.all({
      $session_id: sessionId,
      $limit: limit,
    }) as Message[];
    return rows.reverse();
  }

  getLastMessageTime(sessionId: string): string | null {
    const row = this.stmtGetLastTime.get({ $session_id: sessionId }) as {
      created_at: string;
    } | null;
    return row?.created_at ?? null;
  }
}
