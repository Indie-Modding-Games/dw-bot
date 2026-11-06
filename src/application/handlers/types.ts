/**
 * Contrato neutro entre el adaptador de Discord y los handlers de aplicacion.
 * Permite que la logica de casos de uso no importe discord.js (seccion 5).
 */

export interface CommandContext {
  /** Snowflake del usuario autorizado que invoco el comando. */
  userId: string;
  /** Nombre visible del usuario (ya validado por el adaptador). */
  userName: string;
  /** Responde al usuario. `ephemeral` solo lo ve el invocante. */
  reply(content: string, options?: { ephemeral?: boolean }): Promise<void>;
}

export interface BotStatus {
  uptimeMs: number;
  webSocketPingMs: number;
  guildCount: number;
  readyAt: Date | null;
}
