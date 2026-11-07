import { describe, expect, it } from 'vitest';
import { PostIngestor } from '../src/application/services/post-ingestor.js';
import {
  type FeedbackStorePort,
  type ForumPost,
  type ForumPostSourcePort,
  type IssueSnapshot,
  type IssueTrackerPort,
  type PostSyncPlan,
  type TrackedFeedback,
} from '../src/core/feedback/types.js';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

function makePost(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    channelId: 'ch-proposals',
    threadId: 'th-1',
    title: 'Modo oscuro para el launcher',
    description: 'Se agradece un toggle de tema',
    authorName: 'usuario1',
    postUrl: 'https://discord.com/channels/g/ch-proposals/th-1',
    ...overrides,
  };
}

class FakeForumSource implements ForumPostSourcePort {
  /** posts por canal; la fuente real ya filtra por etiqueta. */
  byChannel = new Map<string, ForumPost[]>();
  calls: Array<{ channelId: string; requiredTag: string }> = [];

  async fetchPosts(channelId: string, requiredTag: string): Promise<ForumPost[]> {
    this.calls.push({ channelId, requiredTag });
    return this.byChannel.get(channelId) ?? [];
  }
}

class RecordingTracker implements IssueTrackerPort {
  created: Array<{ title: string; kind: string }> = [];
  private seq = 100;

  async createIssue(report: { title: string; kind: string }): Promise<IssueSnapshot> {
    this.seq += 1;
    this.created.push({ title: report.title, kind: report.kind });
    return {
      number: this.seq,
      title: report.title,
      state: 'open',
      stateReason: null,
      labels: [],
      url: `https://github.com/acme/dw-engine/issues/${this.seq}`,
      updatedAt: '2026-11-07T00:00:00Z',
      closedAt: null,
    };
  }
  async listIssuesUpdatedSince(): Promise<IssueSnapshot[]> {
    return [];
  }
  async getIssue(): Promise<IssueSnapshot | null> {
    return null;
  }
}

class InMemoryStore implements FeedbackStorePort {
  records = new Map<number, TrackedFeedback>();

  async list(): Promise<TrackedFeedback[]> {
    return [...this.records.values()];
  }
  async upsert(record: TrackedFeedback): Promise<void> {
    this.records.set(record.issue.number, record);
  }
  async getLastPollAt(): Promise<Date | null> {
    return null;
  }
  async setLastPollAt(): Promise<void> {
    /* noop */
  }
}

const proposalsPlan: PostSyncPlan = {
  kind: 'suggestion',
  channelId: 'ch-proposals',
  requiredTag: 'Aceptado',
  doneTag: 'Hecho',
};

const bugsPlan: PostSyncPlan = {
  kind: 'bug',
  channelId: 'ch-bugs',
  requiredTag: 'En revisión',
  doneTag: null,
};

function makeIngestor() {
  const source = new FakeForumSource();
  const tracker = new RecordingTracker();
  const store = new InMemoryStore();
  const ingestor = new PostIngestor(source, tracker, store, silentLogger);
  return { ingestor, source, tracker, store };
}

describe('PostIngestor', () => {
  it('ingiere los posts etiquetados como issues con enlace al post', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    source.byChannel.set('ch-bugs', [makePost({ channelId: 'ch-bugs', threadId: 'th-9' })]);

    const summary = await ingestor.ingestNewPosts([proposalsPlan, bugsPlan]);

    expect(summary).toEqual({ scanned: 2, created: 2 });
    expect(tracker.created).toEqual([
      { title: 'Modo oscuro para el launcher', kind: 'suggestion' },
      { title: 'Modo oscuro para el launcher', kind: 'bug' },
    ]);
    const saved = await store.list();
    const proposalRecord = saved.find((r) => r.post?.threadId === 'th-1');
    expect(proposalRecord?.report.description).toContain(
      '[Ver post original en Discord](https://discord.com/channels/g/ch-proposals/th-1)',
    );
    expect(proposalRecord?.post?.doneTag).toBe('Hecho');
    // Sin ficha en el canal de backlog: el post ES la ficha.
    expect(proposalRecord?.discordMessageId).toBeNull();
  });

  it('es idempotente: un post ya ingerido no se duplica', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);

    await ingestor.ingestNewPosts([proposalsPlan]);
    const second = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(second).toEqual({ scanned: 1, created: 0 });
    expect(tracker.created).toHaveLength(1);
  });

  it('usa la etiqueta requerida de cada plan al leer el foro', async () => {
    const { ingestor, source } = makeIngestor();

    await ingestor.ingestNewPosts([proposalsPlan, bugsPlan]);

    expect(source.calls).toEqual([
      { channelId: 'ch-proposals', requiredTag: 'Aceptado' },
      { channelId: 'ch-bugs', requiredTag: 'En revisión' },
    ]);
  });

  it('un fallo en un foro no impide procesar el otro', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-bugs', [makePost({ channelId: 'ch-bugs', threadId: 'th-9' })]);
    const original = source.fetchPosts.bind(source);
    source.fetchPosts = async (channelId, tag) => {
      if (channelId === 'ch-proposals') throw new Error('canal borrado');
      return original(channelId, tag);
    };

    const summary = await ingestor.ingestNewPosts([proposalsPlan, bugsPlan]);

    expect(summary.created).toBe(1);
    expect(tracker.created).toHaveLength(1);
  });
});
