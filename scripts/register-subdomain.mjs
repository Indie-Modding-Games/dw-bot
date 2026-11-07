/**
 * Registra el subdominio workers.dev de la cuenta usando el token OAuth local
 * de wrangler (el token de plantilla de API no tiene ese alcance).
 * Nunca imprime el token. Uso: node scripts/register-subdomain.mjs <nombre>
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const candidates = [
  path.join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
  path.join(process.env.APPDATA ?? '', '.wrangler', 'config', 'default.toml'),
  path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
];

const configFile = candidates.find((c) => c && existsSync(c));
if (!configFile) {
  console.error('No encontre la config de wrangler (¿corriste `wrangler login`?)');
  process.exit(1);
}

const raw = readFileSync(configFile, 'utf8');
const tokenMatch = raw.match(/^[ \t]*oauth_token[ \t]*=[ \t]*"([^"]+)"/m);
const accMatch = raw.match(/^[ \t]*account_id[ \t]*=[ \t]*"([^"]+)"/m);
const accountId = accMatch ? accMatch[1] : '3b028cc92fcfbe3f57713e580a3596d4';
if (!tokenMatch) {
  console.error('Falta oauth_token en la config de wrangler');
  process.exit(1);
}

const subdomain = process.argv[2];
if (!subdomain) {
  console.error('Uso: node scripts/register-subdomain.mjs <subdominio>');
  process.exit(1);
}

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${tokenMatch[1]}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ subdomain }),
});
const result = await response.json();
console.log('HTTP', response.status, '| success:', result.success);
if (!result.success) {
  console.log('errors:', JSON.stringify(result.errors));
  console.log('messages:', JSON.stringify(result.messages));
  process.exit(1);
}
console.log('subdominio:', result.result?.subdomain);
console.log('preview:', result.result?.default_preview_url ?? '(no devuelto)');
