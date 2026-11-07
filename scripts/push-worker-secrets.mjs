/**
 * Sube los secretos del worker leidos del .env local via stdin (no quedan
 * en historial de comandos ni en archivos). Ejecutar: node scripts/push-worker-secrets.mjs
 */
import { execSync } from 'node:child_process';
import process from 'node:process';
import 'dotenv/config';

const PUBLIC_KEY =
  process.env.DISCORD_PUBLIC_KEY ??
  'f024c5d6384ca06f24fb6f54e7afa7b50023297f56cd5ab74079a28372f60f95';

const secrets = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DEVBOT_GITHUB_TOKEN: process.env.DEVBOT_GITHUB_TOKEN,
  DISCORD_PUBLIC_KEY: PUBLIC_KEY,
};

for (const [name, value] of Object.entries(secrets)) {
  if (!value) {
    console.error(`Falta ${name} en .env — abortando`);
    process.exit(1);
  }
  console.log(`Subiendo secreto: ${name}`);
  execSync('npx --yes wrangler secret put ' + name, {
    input: value + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}
console.log('Secretos del worker listos.');
