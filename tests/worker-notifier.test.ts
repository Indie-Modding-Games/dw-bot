import { describe, expect, it } from 'vitest';
import { WorkerBacklogNotifier } from '../worker/src/notifier.js';
import type { Env } from '../worker/src/env.js';
import { type IssueSnapshot, type TrackedPostInfo } from '../src/core/feedback/types.js';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

class FakeRest {
  forumTags = [
    { id: 'tag-req', name: '🟡 En revisión' },
    { id: 'tag-done', name: '✅ Arreglado' },
  ];
  appliedTags = ['tag-req'];
  tagsSet: string[] | null = null;
  texts: string[] = [];
  archived = false;
  failArchive = false;

  async getChannel(id: string) {
    if (id === 'th-1') return { id, type: 11, applied_tags: this.appliedTags };
    return { id, type: 15, name: 'bugs', available_tags: this.forumTags };
  }
  async setThreadAppliedTags(_id: string, tags: string[]) {
    this.tagsSet = tags;
    this.appliedTags = tags;
  }
  async sendText(_id: string, content: string) {
    this.texts.push(content);
    return { id: 'm-x' };
  }
  async archiveThread(_id: string) {
    if (this.failArchive) throw new Error('Discord API fallo: HTTP 403');
    this.archived = true;
    return {};
  }
}

function makeNotifier() {
  const rest = new FakeRest();
  const env = { DEVBOT_FEEDBACK_CHANNEL_ID: 'ch-backlog', DEVBOT_GUILD_ID: 'g-1' } as Env;
  const notifier = new WorkerBacklogNotifier(rest as never, env, silentLogger);
  return { rest, notifier };
}

const doneIssue: IssueSnapshot = {
  number: 42,
  title: 'Fix launcher',
  state: 'closed',
  stateReason: 'completed',
  labels: ['bug'],
  url: 'https://github.com/acme/dw-engine/issues/42',
  updatedAt: '2026-11-08T10:00:00Z',
  closedAt: '2026-11-08T10:00:00Z',
};

const post: TrackedPostInfo = {
  channelId: 'ch-bugs',
  threadId: 'th-1',
  requiredTag: '🟡 En revisión',
  doneTag: '✅ Arreglado',
};

describe('WorkerBacklogNotifier.markPostDone', () => {
  it('cambia la etiqueta, comenta el cierre y ARCHIVA el post', async () => {
    const { rest, notifier } = makeNotifier();

    await notifier.markPostDone(post, doneIssue, '✅ Arreglado');

    // quita requiredTag y pone doneTag
    expect(rest.tagsSet).toEqual(['tag-done']);
    expect(rest.texts).toHaveLength(1);
    expect(rest.texts[0]).toContain('#42');
    // el post queda archivado (fuera del foro activo y de las busquedas)
    expect(rest.archived).toBe(true);
  });

  it('si la etiqueta de done no existe en el foro, falla sin archivar', async () => {
    const { rest, notifier } = makeNotifier();

    await expect(notifier.markPostDone(post, doneIssue, 'Inventada')).rejects.toThrow(
      'no existe en el foro',
    );
    expect(rest.tagsSet).toBeNull();
    expect(rest.archived).toBe(false);
  });

  it('un fallo al archivar propaga (el service deja el swap pendiente y reintenta)', async () => {
    const { rest, notifier } = makeNotifier();
    rest.failArchive = true;

    await expect(notifier.markPostDone(post, doneIssue, '✅ Arreglado')).rejects.toThrow('403');
    expect(rest.tagsSet).toEqual(['tag-done']); // la etiqueta ya fue puesta
    expect(rest.archived).toBe(false);

    // Reintento del proximo tick: idempotente con la etiqueta ya cambiada.
    rest.failArchive = false;
    await notifier.markPostDone(post, doneIssue, '✅ Arreglado');
    expect(rest.archived).toBe(true);
    expect(rest.tagsSet).toEqual(['tag-done']);
  });
});
