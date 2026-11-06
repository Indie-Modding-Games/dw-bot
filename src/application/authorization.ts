/**
 * Autorizacion por allowlist (seccion 11, puntos 1 y 2).
 * Logica pura, sin dependencias de Discord: el adaptador traduce las
 * interacciones a estas funciones. Fail-closed por diseno.
 */

export interface AuthorizationConfig {
  allowedUserIds: string[];
  /** Si esta vacio, cualquier servidor donde este el bot es aceptado. */
  allowedGuildIds: string[];
}

export function isUserAllowed(config: AuthorizationConfig, userId: string): boolean {
  return config.allowedUserIds.includes(userId);
}

export function isGuildAllowed(config: AuthorizationConfig, guildId: string | null): boolean {
  if (config.allowedGuildIds.length === 0) return true;
  return guildId !== null && config.allowedGuildIds.includes(guildId);
}

export function canInteract(
  config: AuthorizationConfig,
  userId: string,
  guildId: string | null,
): boolean {
  return isUserAllowed(config, userId) && isGuildAllowed(config, guildId);
}
