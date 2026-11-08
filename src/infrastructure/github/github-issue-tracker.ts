import type { Logger } from 'pino';
import { buildIssueBody } from '../../core/feedback/issue-body.js';
import {
  type FeedbackReport,
  type IssueSnapshot,
  type IssueTrackerPort,
  type UploadedFile,
} from '../../core/feedback/types.js';

export interface GithubTrackerConfig {
  token: string;
  /** `owner/repo` del backlog. */
  repo: string;
  bugLabels: string[];
  suggestionLabels: string[];
  /** ID de GraphQL del proyecto (Projects v2) donde asignar cada issue.
   * Vacío = no asignar a proyecto (el bot sigue funcionando igual). */
  projectId?: string;
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
  /** Nodo global del issue (necesario para projectV2_addItem). */
  node_id?: string;
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
  private repoId?: string;

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
    // Asignar al proyecto por defecto (best-effort: si falla, la issue se crea igual).
    await this.assignToProject(data.node_id ?? '');
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

  async updateIssue(
    number: number,
    patch: { title?: string; body?: string },
  ): Promise<IssueSnapshot> {
    const payload: Record<string, string> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.body !== undefined) payload.body = patch.body;
    const response = await fetch(`${this.baseUrl}/issues/${number}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    const raw = (await this.readJson(response, `actualizar issue #${number}`)) as RawGithubIssue;
    await this.assignToProject(raw.node_id ?? '');
    return toSnapshot(raw);
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });
    await this.readJson(response, `comentar issue #${issueNumber}`);
  }

  /**
   * Sube una captura como asset de usuario de GitHub (el mismo flujo que el
   * drag-and-drop de la web y `gh --attach`). Endpoint no documentado pero
   * estable: devuelve la URL `github.com/user-attachments/assets/...`.
   */
  async uploadAttachment(file: UploadedFile): Promise<string> {
    const repoId = await this.getRepoId();
    const url = new URL('https://uploads.github.com/user-attachments/assets');
    url.searchParams.set('name', file.name);
    url.searchParams.set('content_type', file.contentType);
    url.searchParams.set('repository_id', repoId);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'devbot-feedback',
      },
      body: file.bytes,
    });
    const data = (await this.readJson(
      response,
      `subir adjunto ${file.name} (${file.bytes.byteLength} bytes)`,
    )) as { url?: string };
    if (!data.url) {
      throw new Error(`GitHub no devolvio URL de asset al subir ${file.name}`);
    }
    this._logger.info(
      { event: 'github.attachment_uploaded', name: file.name, bytes: file.bytes.byteLength },
      'captura subida a GitHub',
    );
    return data.url;
  }

  /** ID numerico del repo (el upload de assets lo exige); se resuelve una vez. */
  private async getRepoId(): Promise<string> {
    if (this.repoId !== undefined) return this.repoId;
    const response = await fetch(this.baseUrl, { headers: this.headers() });
    const data = (await this.readJson(response, `leer repo ${this.config.repo}`)) as {
      id?: number;
    };
    if (typeof data.id !== 'number') {
      throw new Error(`no se pudo obtener el ID numerico del repo ${this.config.repo}`);
    }
    this.repoId = String(data.id);
    return this.repoId;
  }

  /**
   * Consulta GraphQL de GitHub (Projects v2 usa GraphQL; la API REST de
   * proyectos esta deprecada). Lanza si hay errores de HTTP o de GraphQL.
   */
  private async graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'devbot-feedback',
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `GraphQL HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
      );
    }
    if (body.errors) {
      throw new Error(`GraphQL errores: ${JSON.stringify(body.errors).slice(0, 500)}`);
    }
    return body.data;
  }

  /**
   * Asigna la issue (por su node_id global) al proyecto por defecto del repo.
   * Best-effort: cualquier fallo se registra y no bloquea la creacion/actualizacion
   * de la issue.
   */
  private async assignToProject(nodeId: string): Promise<void> {
    if (!this.config.projectId || !nodeId) return;
    const query = `mutation($projectId: ID!, $contentId: ID!) {
      projectV2_addItem(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }`;
    try {
      await this.graphql(query, {
        projectId: this.config.projectId,
        contentId: nodeId,
      });
      this._logger.info(
        {
          event: 'github.project_assigned',
          contentId: nodeId,
          projectId: this.config.projectId,
        },
        'issue asignada al proyecto GitHub',
      );
    } catch (error) {
      this._logger.warn(
        {
          err: error,
          event: 'github.project_assign_failed',
          contentId: nodeId,
          projectId: this.config.projectId,
        },
        'no se pudo asignar la issue al proyecto; la issue se crea igual',
      );
    }
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
