import type { D1Database } from '@cloudflare/workers-types';

/** Variables y secrets del worker (wrangler.toml + wrangler secret put). */
export interface Env {
  // --- Secrets ---
  DISCORD_TOKEN: string;
  /** Public key del app (General Information -> PublicKey / verify_key). */
  DISCORD_PUBLIC_KEY: string;
  DEVBOT_GITHUB_TOKEN: string;

  // --- Vars (no secretas) ---
  DEVBOT_GUILD_ID: string;
  DEVBOT_ALLOWED_USER_IDS: string;
  DEVBOT_FEEDBACK_CHANNEL_ID: string;
  DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID?: string;
  DEVBOT_FEEDBACK_BUGS_CHANNEL_ID?: string;
  DEVBOT_PROPOSALS_REQUIRED_TAG: string;
  DEVBOT_PROPOSALS_DONE_TAG: string;
  DEVBOT_BUGS_REQUIRED_TAG: string;
  DEVBOT_BUGS_DONE_TAG?: string;
  DEVBOT_GITHUB_REPO: string;
  DEVBOT_BUG_LABELS: string;
  DEVBOT_SUGGESTION_LABELS: string;
  /** '1' (default) anuncia la version nueva en Discord tras cada deploy; '0' lo apaga. */
  DEVBOT_ANNOUNCE_ON_UPDATE?: string;

  // --- Bindings ---
  D1: D1Database;
}

export function csvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
