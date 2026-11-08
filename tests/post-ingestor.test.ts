import { describe, expect, it } from 'vitest';
import { PostIngestor } from '../src/application/services/post-ingestor.js';
import {
  type FeedbackReport,
  type FeedbackStorePort,
  type ForumPost,
  type ForumPostSourcePort,
  type ForumThreadMessage,
  type IssueSnapshot,
  type IssueTrackerPort,
  type PostAttachment,
  type PostSyncPlan,
  type TrackedFeedback,
  type UploadedFile,
} from '../src/core/feedback/types.js';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

function makeAttachment(id: string, filename = `${id}.png`): PostAttachment {
  return {
    id,
    filename,
    url: `https://cdn.discordapp.com/attachments/${id}`,
    contentType: null, // el resolver usa la extension (fallback real de Discord)
    size: 1024,
  };
}

function makePost(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    channelId: 'ch-proposals',
    threadId: 'th-1',
    title: 'Modo oscuro para el launcher',
    description: 'Se agradece un toggle de tema',
    authorName: 'usuario1',
    postUrl: 'https://discord.com/channels/g/ch-proposals/th-1',
    attachments: [],
    starterMessageId: 'm-1',
    messages: [],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ForumThreadMessage> = {}): ForumThreadMessage {
  return {
    id: 'm-2',
    content: 'Tambien hace falta en el editor',
    authorName: 'otro',
    createdAt: '2026-11-08T10:00:00.000Z',
    isBot: false,
    type: 0,
    attachments: [],
    ...overrides,
  };
}

class FakeForumSource implements ForumPostSourcePort {
  /** posts por canal; la fuente real ya filtra por etiqueta. */
  byChannel = new Map<string, ForumPost[]>();
  calls: Array<{ channelId: string; requiredTag: string }> = [];
  downloads: string[] = [];

  async fetchPosts(channelId: string, requiredTag: string): Promise<ForumPost[]> {
    this.calls.push({ channelId, requiredTag });
    return this.byChannel.get(channelId) ?? [];
  }

  async fetchAttachmentBytes(url: string) {
    this.downloads.push(url);
    return new ArrayBuffer(8);
  }
}

class RecordingTracker implements IssueTrackerPort {
  created: Array<{ title: string; kind: string; body: string }> = [];
  updates: Array<{ number: number; title?: string; body?: string }> = [];
  comments: Array<{ number: number; body: string }> = [];
  uploads: UploadedFile[] = [];
  failUpload = false;
  private seq = 100;

  async createIssue(report: FeedbackReport): Promise<IssueSnapshot> {
    this.seq += 1;
    this.created.push({ title: report.title, kind: report.kind, body: report.description });
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
  async updateIssue(
    number: number,
    patch: { title?: string; body?: string },
  ): Promise<IssueSnapshot> {
    this.updates.push({ number, ...patch });
    return {
      number,
      title: patch.title ?? 'issue',
      state: 'open',
      stateReason: null,
      labels: [],
      url: `https://github.com/acme/dw-engine/issues/${number}`,
      updatedAt: '2026-11-08T00:00:00Z',
      closedAt: null,
    };
  }
  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    this.comments.push({ number: issueNumber, body });
  }
  async uploadAttachment(file: UploadedFile): Promise<string> {
    if (this.failUpload) throw new Error('uploads.github.com 401');
    this.uploads.push(file);
    return `https://github.com/user-attachments/assets/${file.name}`;
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

describe('PostIngestor: creacion', () => {
  it('ingiere los posts etiquetados como issues con enlace al post', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    source.byChannel.set('ch-bugs', [makePost({ channelId: 'ch-bugs', threadId: 'th-9' })]);

    const summary = await ingestor.ingestNewPosts([proposalsPlan, bugsPlan]);

    expect(summary).toEqual({ scanned: 2, created: 2, updated: 0, comments: 0 });
    expect(tracker.created).toHaveLength(2);
    expect(tracker.created[0]).toMatchObject({
      title: 'Modo oscuro para el launcher',
      kind: 'suggestion',
    });
    const saved = await store.list();
    const proposalRecord = saved.find((r) => r.post?.threadId === 'th-1');
    expect(proposalRecord?.report.description).toContain(
      '[Ver post original en Discord](https://discord.com/channels/g/ch-proposals/th-1)',
    );
    expect(proposalRecord?.post?.doneTag).toBe('Hecho');
    // Sin ficha en el canal de backlog: el post ES la ficha.
    expect(proposalRecord?.discordMessageId).toBeNull();
    // Marca de agua fijada en el mensaje inicial: el historial no se reenvia.
    expect(proposalRecord?.post?.lastCommentId).toBe('m-1');
  });

  it('sube las capturas del post a GitHub y las embebe en la issue', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [
      makePost({ attachments: [makeAttachment('att-1'), makeAttachment('att-2', 'video.mp4')] }),
    ]);

    await ingestor.ingestNewPosts([proposalsPlan]);

    expect(tracker.uploads.map((u) => u.name)).toEqual(['att-1.png', 'video.mp4']);
    expect(tracker.uploads[1]?.contentType).toBe('video/mp4');
    const saved = await store.list();
    const record = saved.find((r) => r.post?.threadId === 'th-1');
    expect(record?.report.description).toContain(
      '![att-1.png](https://github.com/user-attachments/assets/att-1.png)',
    );
    expect(record?.report.description).toContain(
      '[video.mp4](https://github.com/user-attachments/assets/video.mp4)',
    );
    expect(record?.uploadedAttachments?.['att-1']).toBe(
      'https://github.com/user-attachments/assets/att-1.png',
    );
  });

  it('es idempotente: un post ya ingerido no se duplica', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);

    await ingestor.ingestNewPosts([proposalsPlan]);
    const second = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(second).toEqual({ scanned: 1, created: 0, updated: 0, comments: 0 });
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

describe('PostIngestor: sincronizacion continua', () => {
  it('detecta la edicion de un post y actualiza la issue en GitHub', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    await ingestor.ingestNewPosts([proposalsPlan]);

    // El autor edita titulo y texto del post en Discord.
    source.byChannel.set('ch-proposals', [
      makePost({ title: 'Modo oscuro (v2)', description: 'Ahora con hora programada' }),
    ]);
    const summary = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(summary.updated).toBe(1);
    expect(tracker.updates).toHaveLength(1);
    expect(tracker.updates[0]?.title).toBe('Modo oscuro (v2)');
    expect(tracker.updates[0]?.body).toContain('Ahora con hora programada');
    const saved = await store.list();
    const record = saved.find((r) => r.post?.threadId === 'th-1');
    expect(record?.report.title).toBe('Modo oscuro (v2)');
    // Un tercer ciclo sin cambios no vuelve a tocar GitHub.
    await ingestor.ingestNewPosts([proposalsPlan]);
    expect(tracker.updates).toHaveLength(1);
  });

  it('un post no legible este ciclo NO toca la issue (y el siguiente la repara)', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    await ingestor.ingestNewPosts([proposalsPlan]);

    // Ciclo con lectura fallida (p. ej. 429): description y messages null.
    source.byChannel.set('ch-proposals', [
      makePost({ description: null, messages: null, starterMessageId: null }),
    ]);
    const bad = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(bad.updated).toBe(0);
    expect(tracker.updates).toHaveLength(0);

    // Ciclo legible con texto nuevo: se actualiza con el contenido real.
    source.byChannel.set('ch-proposals', [makePost({ description: 'texto real actual' })]);
    const good = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(good.updated).toBe(1);
    expect(tracker.updates[0]?.body).toContain('texto real actual');
  });

  it('un post ilegible al crear crea el ticket y se rellena al poder leerse', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [
      makePost({ description: null, messages: null, starterMessageId: null }),
    ]);

    const first = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(first.created).toBe(1);
    expect(tracker.created[0]?.body).toContain('_(post sin texto)_');
    const afterCreate = await store.list();
    expect(afterCreate[0]?.post?.contentHash).toBeUndefined();

    source.byChannel.set('ch-proposals', [makePost()]);
    const second = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(second.updated).toBe(1);
    expect(tracker.updates[0]?.body).toContain('Se agradece un toggle de tema');
  });

  it('reenvia las respuestas nuevas del hilo como comentarios (ignorando bots/sistema)', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    await ingestor.ingestNewPosts([proposalsPlan]);

    source.byChannel.set('ch-proposals', [
      makePost({
        messages: [
          makeMessage({ id: 'm-0', content: 'anterior al ticket' }), // watermark lo excluye
          makeMessage({ id: 'm-1', content: 'starter' }),
          makeMessage({ id: 'm-2', content: 'Tambien hace falta en el editor' }),
          makeMessage({ id: 'm-3', content: 'fixeado', isBot: true }),
          makeMessage({ id: 'm-4', type: 3 }), // mensaje del sistema
          makeMessage({ id: 'm-5', content: '', attachments: [makeAttachment('att-9')] }),
        ],
      }),
    ]);
    const summary = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(summary.comments).toBe(2);
    expect(tracker.comments.map((c) => c.number)).toEqual([101, 101]);
    expect(tracker.comments[0]?.body).toContain('Tambien hace falta en el editor');
    expect(tracker.comments[0]?.body).toContain('*otro*');
    expect(tracker.comments[1]?.body).toContain(
      '![att-9.png](https://github.com/user-attachments/assets/att-9.png)',
    );
    // La misma respuesta no se reenvia dos veces.
    const second = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(second.comments).toBe(0);
    expect(tracker.comments).toHaveLength(2);
  });

  it('las respuestas anteriores al ticket no se reenvian (marca de agua)', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    source.byChannel.set('ch-proposals', [
      makePost({
        starterMessageId: 'm-50',
        messages: [
          makeMessage({ id: 'm-10', content: 'hablando antes de tiempo' }),
          makeMessage({ id: 'm-40', content: 'offtopic' }),
          makeMessage({ id: 'm-50', content: 'starter del post' }),
        ],
      }),
    ]);

    const summary = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(summary.comments).toBe(0);
    expect(tracker.comments).toHaveLength(0);
  });

  it('un registro heredado (sin marca de agua) no spamea el historial', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    await store.upsert({
      report: {
        kind: 'bug',
        title: 't',
        description: 'd',
        reportedById: '0',
        reportedByName: 'post: x',
      },
      issue: {
        number: 7,
        title: 't',
        state: 'open',
        stateReason: null,
        labels: [],
        url: 'u',
        updatedAt: '2026-11-07T00:00:00Z',
        closedAt: null,
      },
      discordMessageId: null,
      // sin contentHash ni watermark: registro anterior a esta funcionalidad
      post: { channelId: 'ch-proposals', threadId: 'th-1', requiredTag: 'Aceptado', doneTag: null },
    });
    // Historial preexistente en el hilo: NO debe reenviarse como comentarios.
    source.byChannel.set('ch-proposals', [
      makePost({
        messages: [
          makeMessage({ id: 'm-1', content: 'comentario viejo 1' }),
          makeMessage({ id: 'm-2', content: 'comentario viejo 2' }),
        ],
      }),
    ]);

    const summary = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(summary.comments).toBe(0);
    expect(tracker.comments).toHaveLength(0);
    // Primera pasada: fija la marca de agua en el ultimo mensaje y la firma
    // (migracion del cuerpo al nuevo formato), sin reenviar nada.
    const saved = await store.list();
    expect(saved[0]?.post?.lastCommentId).toBe('m-2');

    // Y en el ciclo siguiente, una respuesta SI se reenvia.
    source.byChannel.set('ch-proposals', [
      makePost({
        messages: [
          makeMessage({ id: 'm-1', content: 'comentario viejo 1' }),
          makeMessage({ id: 'm-2', content: 'comentario viejo 2' }),
          makeMessage({ id: 'm-3', content: 'respuesta nueva' }),
        ],
      }),
    ]);
    const second = await ingestor.ingestNewPosts([proposalsPlan]);
    expect(second.comments).toBe(1);
    expect(tracker.comments[0]?.body).toContain('respuesta nueva');
  });

  it('no actualiza el contenido de una issue cerrada por ediciones del post', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [makePost()]);
    await ingestor.ingestNewPosts([proposalsPlan]);
    await store.upsert({
      ...(await store.list()).find((r) => r.post?.threadId === 'th-1')!,
      issue: {
        ...(await store.list()).find((r) => r.post?.threadId === 'th-1')!.issue,
        state: 'closed',
        stateReason: 'completed',
      },
    });

    source.byChannel.set('ch-proposals', [makePost({ title: 'editado tras cerrar' })]);
    const summary = await ingestor.ingestNewPosts([proposalsPlan]);

    expect(summary.updated).toBe(0);
    expect(tracker.updates).toHaveLength(0);
  });

  it('si la subida de una captura falla, reintenta el proximo tick sin duplicar las ok', async () => {
    const { ingestor, source, tracker, store } = makeIngestor();
    source.byChannel.set('ch-proposals', [
      makePost({ attachments: [makeAttachment('a'), makeAttachment('b')] }),
    ]);

    tracker.failUpload = true;
    await ingestor.ingestNewPosts([proposalsPlan]);
    const afterFail = await store.list();
    expect(afterFail[0]?.post?.contentHash).toBeUndefined();

    tracker.failUpload = false;
    await ingestor.ingestNewPosts([proposalsPlan]);
    const afterOk = await store.list();
    expect(afterOk[0]?.post?.contentHash).toBeDefined();
    // Cada captura se subio una sola vez (los reintentos no duplican uploads ok).
    expect(tracker.uploads.map((u) => u.name)).toEqual(['a.png', 'b.png']);
    // ...y la signature pendiente provoco una actualizacion de cuerpo con las imagenes.
    expect(tracker.updates).toHaveLength(1);
    expect(tracker.updates[0]?.body).toContain('![b.png]');
  });

  it('descarta a proposito adjuntos demasiado grandes o de tipo no soportado', async () => {
    const { ingestor, source, tracker } = makeIngestor();
    const huge = { ...makeAttachment('big'), size: 11 * 1024 * 1024 };
    const weird = {
      ...makeAttachment('file', 'data.bin'),
      contentType: 'application/octet-stream',
    };
    source.byChannel.set('ch-proposals', [
      makePost({ attachments: [makeAttachment('ok'), huge, weird] }),
    ]);

    await ingestor.ingestNewPosts([proposalsPlan]);

    expect(tracker.uploads.map((u) => u.name)).toEqual(['ok.png']);
    expect(tracker.created[0]?.body).toContain('`data.bin`');
    expect(tracker.created[0]?.body).toContain('`big.png`');
  });
});
