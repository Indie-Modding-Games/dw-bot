import type { D1Database } from '@cloudflare/workers-types';
import type { FeedbackStorePort, TrackedFeedback } from '../../src/core/feedback/types.js';

/**
 * Store de seguimiento en D1 (SQLite serverless de Cloudflare, plan free).
 * Equivalente al JsonFeedbackStore de la version local.
 */
export class D1FeedbackStore implements FeedbackStorePort {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<TrackedFeedback[]> {
    const { results } = await this.db
      .prepare('SELECT data FROM feedback_records')
      .all<{ data: string }>();
    return (results ?? []).map((row) => JSON.parse(row.data) as TrackedFeedback);
  }

  async upsert(record: TrackedFeedback): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO feedback_records (issue_number, data) VALUES (?1, ?2)')
      .bind(record.issue.number, JSON.stringify(record))
      .run();
  }

  async getLastPollAt(): Promise<Date | null> {
    const row = await this.db
      .prepare('SELECT value FROM meta WHERE key = ?1')
      .bind('lastPollAt')
      .first<{ value: string }>();
    return row ? new Date(row.value) : null;
  }

  async setLastPollAt(at: Date): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)')
      .bind('lastPollAt', at.toISOString())
      .run();
  }
}
