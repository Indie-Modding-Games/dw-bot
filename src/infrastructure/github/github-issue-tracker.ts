import type { Logger } from 'pino';
import {
  type FeedbackReport,
  type IssueSnapshot,
  type IssueTrackerPort,
} from '../../core/feedback/types.js';

export interface GithubTrackerConfig {
  token: string;
  /** `owner/repo` del backlog. */
  repo: string;
  bugLabels: string[];
  suggestionLabels: string[];
}

interface RawGithubLabel {
  name: string;
}

interface RawGithubIssue {
  number: number;
  title: string;
  state: string;
  state_reason?: string | null;
  html_url: string;
  labels: RawGithubLabel[];
  updated_at: string;
  closed_at?: string | null;
  /** El endpoint /issues tambien devuelve pull requests: se filtran. */
  pull_request?: unknown;
}

/**
 * Adaptador de GitHub Issues sobre la API REST v3 usando fetch nativo.
 * Sin dependencia extra (principio de seccion 6: no anadir dependencias
 * que una solucion pequena y mantenible cubre).
 *
 * TODO (detalles pendientes): migrar a webhook si el bot queda expuesto
 * publicamente; hoy se hace polling desde el scheduler.
 */
export class GithubIssueTracker implements IssueTrackerPort {
  private readonly baseUrl: string;

  constructor(
    private readonly config: GithubTrackerConfig,
    private readonly _logger: Logger,
  ) {
    this.baseUrl = `https://api.github.com/repos/${this.config.repo}`;
  }

  async createIssue(report: FeedbackReport): Promise<IssueSnapshot> {
    const labels = report.kind === 'bug' ? this.config.bugLabels : this.config.suggestionLabels;
    const response = await fetch(`${this.baseUrl}/issues`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ title: report.title, body: buildIssueBody(report), labels }),
    });
    const data = (await this.readJson(response, 'crear issue')) as RawGithubIssue;
    return toSnapshot(data);
  }

  async listIssuesUpdatedSince(since: Date): Promise<IssueSnapshot[]> {
    const issues: IssueSnapshot[] = [];
    const maxPages = 5; // Limite conservador: el backlog personal no da para mas.

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`${this.baseUrl}/issues`);
      url.searchParams.set('state', 'all');
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('direction', 'desc');
      url.searchParams.set('since', since.toISOString());
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));

      const response = await fetch(url, { headers: this.headers() });
      const items = (await this.readJson(response, 'listar issues actualizadas')) as unknown;
      if (!Array.isArray(items)) {
        throw new Error('Respuesta inesperada de GitHub: se esperaba una lista de issues');
      }
      const rawItems = items as RawGithubIssue[];
      for (const item of rawItems) {
        if (item.pull_request) continue;
        issues.push(toSnapshot(item));
      }
      if (rawItems.length < 100) break;
    }

    return issues;
  }

  async getIssue(number: number): Promise<IssueSnapshot | null> {
    const response = await fetch(`${this.baseUrl}/issues/${number}`, { headers: this.headers() });
    if (response.status === 404) return null;
    const raw = (await this.readJson(response, `leer issue #${number}`)) as RawGithubIssue;
    return toSnapshot(raw);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devbot-feedback',
      'Content-Type': 'application/json',
    };
  }

  private async readJson(response: Response, operation: string): Promise<unknown> {
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`GitHub API fallo al ${operation}: HTTP ${response.status} ${detail}`);
    }
    return response.json();
  }
}

function toSnapshot(raw: RawGithubIssue): IssueSnapshot {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state === 'closed' ? 'closed' : 'open',
    stateReason: raw.state_reason ?? null,
    labels: raw.labels.map((label) => label.name),
    url: raw.html_url,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
  };
}

function buildIssueBody(report: FeedbackReport): string {
  const heading = report.kind === 'bug' ? 'Bug report' : 'Suggestion';
  return [
    `### ${heading} (via DevBot)`,
    '',
    report.description,
    '',
    '---',
    `Reportado por: ${report.reportedByName} (\`${report.reportedById}\`)`,
    `Fecha: ${new Date().toISOString()}`,
    '_Creado automaticamente por DevBot desde Discord._',
  ].join('\n');
}
