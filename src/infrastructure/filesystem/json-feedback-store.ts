import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import type { FeedbackStorePort, TrackedFeedback } from '../../core/feedback/types.js';

interface StoreFileShape {
  version: 1;
  /** El archivo pertenece a un repo; si cambia la config, se reinicia el estado. */
  repo: string;
  lastPollAt: string | null;
  records: TrackedFeedback[];
}

/**
 * Persistencia del seguimiento de feedback en JSON (data/feedback.json).
 * Suficiente para un backlog personal y sin dependencias; pendiente migrar
 * a SQLite junto al resto del modelo de dominio (Iteracion 2).
 */
export class JsonFeedbackStore implements FeedbackStorePort {
  private constructor(
    private readonly filePath: string,
    private state: StoreFileShape,
    private readonly logger: Logger,
  ) {}

  static async create(filePath: string, repo: string, logger: Logger): Promise<JsonFeedbackStore> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let state: StoreFileShape = { version: 1, repo, lastPollAt: null, records: [] };
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoreFileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error('formato inesperado del archivo de estado');
      }
      if (parsed.repo !== repo) {
        logger.warn(
          { event: 'feedback.store_repo_changed', stored: parsed.repo, configured: repo },
          'el estado de feedback corresponde a otro repo; se inicia en blanco',
        );
      } else {
        state = parsed;
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') {
        // Estado corrupto: conservarlo como respaldo y empezar de cero.
        const backupPath = `${filePath}.corrupt-${Date.now()}`;
        await fs.rename(filePath, backupPath).catch(() => undefined);
        logger.error(
          { err: error, event: 'feedback.store_corrupt', backupPath },
          'estado de feedback ilegible; se inicia en blanco',
        );
      }
    }

    return new JsonFeedbackStore(filePath, state, logger);
  }

  async list(): Promise<TrackedFeedback[]> {
    return this.state.records.map((record) => ({ ...record }));
  }

  async upsert(record: TrackedFeedback): Promise<void> {
    const index = this.state.records.findIndex((item) => item.issue.number === record.issue.number);
    if (index === -1) {
      this.state.records.push(record);
    } else {
      this.state.records[index] = record;
    }
    await this.persist();
  }

  async getLastPollAt(): Promise<Date | null> {
    return this.state.lastPollAt ? new Date(this.state.lastPollAt) : null;
  }

  async setLastPollAt(at: Date): Promise<void> {
    this.state.lastPollAt = at.toISOString();
    await this.persist();
  }

  private async persist(): Promise<void> {
    // Escritura cuasi-atomica: temporal + rename.
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}
