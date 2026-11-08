/** Cliente minimo de la API REST de Discord sobre fetch (sin discord.js). */

const API = 'https://discord.com/api/v10';

export interface RestChannel {
  id: string;
  type: number;
  name?: string;
  parent_id?: string;
  available_tags?: Array<{ id: string; name: string }>;
  applied_tags?: string[];
  thread_metadata?: { archived?: boolean };
}

export interface RestAttachment {
  id: string;
  filename: string;
  url: string;
  content_type?: string;
  size?: number;
}

export interface RestMessage {
  id: string;
  content?: string;
  author?: { id?: string; username?: string; bot?: boolean };
  /** 0 = mensaje regular; el resto son mensajes del sistema. */
  type?: number;
  timestamp?: string;
  attachments?: RestAttachment[];
}

export class DiscordRest {
  constructor(private readonly token: string) {}

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Rate limit de Discord (429): respetar Retry-After y reintentar con
    // limites (muchos posts por ciclo puedenburstear la cuota global).
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, 5000);
      await new Promise((resolve) => setTimeout(resolve, waitMs + attempt * 500));
      return this.request<T>(method, path, body, attempt + 1);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Discord API fallo (${method} ${path}): HTTP ${response.status} ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  sendEmbed(channelId: string, embed: unknown): Promise<RestMessage> {
    return this.request('POST', `/channels/${channelId}/messages`, { embeds: [embed] });
  }

  sendText(channelId: string, content: string): Promise<RestMessage> {
    return this.request('POST', `/channels/${channelId}/messages`, { content });
  }

  editEmbed(channelId: string, messageId: string, embed: unknown): Promise<RestMessage> {
    return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, {
      embeds: [embed],
    });
  }

  getChannel(channelId: string): Promise<RestChannel> {
    return this.request('GET', `/channels/${channelId}`);
  }

  /** Hilos activos del servidor (incluye posts de foros); filtrar por parent_id. */
  async listActiveThreads(guildId: string): Promise<RestChannel[]> {
    const data = await this.request<{ threads: RestChannel[] }>(
      'GET',
      `/guilds/${guildId}/threads/active`,
    );
    return data.threads ?? [];
  }

  /**
   * Mensajes del hilo mas recientes que `afterId` (null = ultimos 100).
   * La API los envia del mas nuevo al mas viejo; se devuelven en orden
   * cronologico. Con `null` y <=100 mensajes, el primero es el starter del
   * post (los posts de este foro no superan 100 respuestas en la practica).
   */
  async fetchThreadMessages(threadId: string, afterId: string | null): Promise<RestMessage[]> {
    const query = afterId === null ? 'limit=100' : `after=${afterId}&limit=100`;
    const messages = await this.request<RestMessage[]>(
      'GET',
      `/channels/${threadId}/messages?${query}`,
    );
    if (!Array.isArray(messages)) return [];
    return [...messages].reverse();
  }

  /** Descarga un adjunto del CDN de Discord (los asset publicos no requieren token). */
  async downloadAttachment(url: string): Promise<ArrayBuffer | null> {
    const response = await fetch(url, { headers: { 'User-Agent': 'devbot-feedback' } });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  }

  setThreadAppliedTags(threadId: string, tagIds: string[]): Promise<unknown> {
    return this.request('PATCH', `/channels/${threadId}`, { applied_tags: tagIds });
  }

  /** Archiva (bloquea) un hilo: sale del foro activo y de las busquedas. */
  archiveThread(threadId: string): Promise<unknown> {
    return this.request('PATCH', `/channels/${threadId}`, { archived: true });
  }

  /** Registro de slash commands a nivel de servidor (propagacion inmediata). */
  putGuildCommands(guildId: string, applicationId: string, commands: unknown[]): Promise<unknown> {
    return this.request(
      'PUT',
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      commands,
    );
  }
}
