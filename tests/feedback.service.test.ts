import { describe, expect, it } from 'vitest';
import { FeedbackService } from '../src/application/services/feedback.service.js';
import {
  snapshotsEqual,
  statusChanged,
  type BacklogNotifierPort,
  type FeedbackReport,
  type FeedbackStorePort,
  type IssueSnapshot,
  type IssueTrackerPort,
  type TrackedFeedback,
} from '../src/core/feedback/types.js';

/**
 * El service usa puertos, asi que se prueba con dobles en memoria:
 * ninguna llamada real a GitHub ni a Discord (seccion 13).
 */

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

function makeIssue(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    number: 42,
    title: 'El build falla con el worker detenido',
    state: 'open',
    stateReason: null,
    labels: ['bug'],
    url: 'https://github.com/acme/backlog/issues/42',
    updatedAt: '2026-11-06T10:00:00Z',
    closedAt: null,
    ...overrides,
  };
}

function makeReport(): FeedbackReport {
  return {
    kind: 'bug',
    title: 'El build falla',
    description: 'Steps: apagar worker y correr make',
    reportedById: '111111111111111111',
    reportedByName: 'seba',
  };
}

class FakeTracker implements IssueTrackerPort {
  created: FeedbackReport[] = [];
  updatedList: IssueSnapshot[] = [];
  sinceQueries: Date[] = [];

  async createIssue(report: FeedbackReport): Promise<IssueSnapshot> {
    this.created.push(report);
    return makeIssue();
  }
  async listIssuesUpdatedSince(since: Date): Promise<IssueSnapshot[]> {
    this.sinceQueries.push(since);
    return this.updatedList;
  }
}

class FakeNotifier implements BacklogNotifierPort {
  published: Array<{ report: FeedbackReport; issue: IssueSnapshot }> = [];
  edits: Array<{ messageId: string; issue: IssueSnapshot }> = [];
  statusNotices: Array<{ issue: IssueSnapshot; previous: IssueSnapshot }> = [];
  failPublish = false;
  messageSeq = 0;

  async publishIssueCard(report: FeedbackReport, issue: IssueSnapshot): Promise<string> {
    if (this.failPublish) throw new Error('discord down');
    this.published.push({ report, issue });
    this.messageSeq += 1;
    return `msg-${this.messageSeq}`;
  }
  async updateIssueCard(messageId: string, issue: IssueSnapshot): Promise<void> {
    this.edits.push({ messageId, issue });
  }
  async notifyStatusChange(issue: IssueSnapshot, previous: IssueSnapshot): Promise<void> {
    this.statusNotices.push({ issue, previous });
  }
}

class InMemoryStore implements FeedbackStorePort {
  records = new Map<number, TrackedFeedback>();
  lastPollAt: Date | null = null;

  async list(): Promise<TrackedFeedback[]> {
    return [...this.records.values()];
  }
  async upsert(record: TrackedFeedback): Promise<void> {
    this.records.set(record.issue.number, record);
  }
  async getLastPollAt(): Promise<Date | null> {
    return this.lastPollAt;
  }
  async setLastPollAt(at: Date): Promise<void> {
    this.lastPollAt = at;
  }
}

function makeService(overrides?: {
  tracker?: FakeTracker;
  store?: InMemoryStore;
  notifier?: FakeNotifier;
}) {
  const tracker = overrides?.tracker ?? new FakeTracker();
  const store = overrides?.store ?? new InMemoryStore();
  const notifier = overrides?.notifier ?? new FakeNotifier();
  const service = new FeedbackService(tracker, store, notifier, silentLogger);
  return { service, tracker, store, notifier };
}

describe('FeedbackService.submitReport', () => {
  it('crea la issue, publica la ficha y guarda el mensaje para poder editarlo', async () => {
    const { service, tracker, store, notifier } = makeService();

    const record = await service.submitReport(makeReport());

    expect(tracker.created).toHaveLength(1);
    expect(notifier.published).toHaveLength(1);
    expect(record.discordMessageId).toBe('msg-1');
    expect(record.issue.number).toBe(42);
    const saved = await store.list();
    expect(saved[0]?.issue.number).toBe(42);
    expect(saved[0]?.discordMessageId).toBe('msg-1');
  });

  it('si Discord falla, la issue queda registrada sin ficha', async () => {
    const { service, store, notifier } = makeService();
    notifier.failPublish = true;

    const record = await service.submitReport(makeReport());

    expect(record.issue.number).toBe(42);
    expect(record.discordMessageId).toBeNull();
    const saved = await store.list();
    expect(saved[0]?.discordMessageId).toBeNull();
  });
});

describe('FeedbackService.syncUpdatedIssues', () => {
  it('sin registros no consulta GitHub', async () => {
    const { service, tracker } = makeService();

    const summary = await service.syncUpdatedIssues();

    expect(summary).toEqual({ checked: 0, cardUpdates: 0, stateChanges: 0 });
    expect(tracker.sinceQueries).toHaveLength(0);
  });

  it('edita la ficha y avisa cuando una issue pasa a cerrada', async () => {
    const { service, tracker, store, notifier } = makeService();
    await service.submitReport(makeReport());
    tracker.updatedList = [
      makeIssue({ state: 'closed', stateReason: 'completed', closedAt: '2026-11-06T12:00:00Z' }),
    ];

    const summary = await service.syncUpdatedIssues();

    expect(summary.cardUpdates).toBe(1);
    expect(summary.stateChanges).toBe(1);
    expect(notifier.edits[0]?.messageId).toBe('msg-1');
    expect(notifier.statusNotices[0]?.previous.state).toBe('open');
    const saved = await store.list();
    expect(saved[0]?.issue.state).toBe('closed');
    expect(store.lastPollAt).toBeInstanceOf(Date);
  });

  it('un cambio de etiquetas edita la ficha pero no notifica estado', async () => {
    const { service, tracker, store, notifier } = makeService();
    await service.submitReport(makeReport());
    tracker.updatedList = [makeIssue({ labels: ['bug', 'wontfix'] })];

    const summary = await service.syncUpdatedIssues();

    expect(summary.cardUpdates).toBe(1);
    expect(summary.stateChanges).toBe(0);
    expect(notifier.statusNotices).toHaveLength(0);
    const saved = await store.list();
    expect(saved[0]?.issue.labels).toEqual(['bug', 'wontfix']);
  });

  it('ignora issues no monitorizadas y sin cambios reales', async () => {
    const { service, tracker, notifier } = makeService();
    await service.submitReport(makeReport());
    tracker.updatedList = [
      makeIssue(), // mismo snapshot: sin cambios
      makeIssue({ number: 99 }), // no esta en el store
    ];

    const summary = await service.syncUpdatedIssues();

    expect(notifier.edits).toHaveLength(0);
    expect(notifier.statusNotices).toHaveLength(0);
    expect(summary.cardUpdates).toBe(0);
  });
});

describe('dominio: snapshotsEqual y statusChanged', () => {
  it('etiquetas se comparan sin importar el orden', () => {
    expect(
      snapshotsEqual(makeIssue({ labels: ['a', 'b'] }), makeIssue({ labels: ['b', 'a'] })),
    ).toBe(true);
  });

  it('updatedAt solo no cuenta como cambio', () => {
    expect(snapshotsEqual(makeIssue(), makeIssue({ updatedAt: '2026-11-07T00:00:00Z' }))).toBe(
      true,
    );
  });

  it('statusChanged detecta cierre, motivo y reapertura', () => {
    expect(statusChanged(makeIssue(), makeIssue({ state: 'closed' }))).toBe(true);
    expect(statusChanged(makeIssue(), makeIssue({ stateReason: 'not_planned' }))).toBe(true);
    expect(statusChanged(makeIssue(), makeIssue({ labels: ['otra'] }))).toBe(false);
  });
});
