/**
 * Configura el Interactions Endpoint URL de la app de Discord via API.
 * Discord envia un PING de verificacion al worker antes de aceptar la URL.
 * Uso: node scripts/set-interactions-endpoint.mjs <url>
 */
import process from 'node:process';
import 'dotenv/config';

const endpointUrl = process.argv[2];
if (!endpointUrl) {
  console.error(
    'Uso: node scripts/set-interactions-endpoint.mjs https://...workers.dev/interactions',
  );
  process.exit(1);
}

const response = await fetch(
  `https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ interactions_endpoint_url: endpointUrl }),
  },
);

const result = await response.json();
console.log('HTTP', response.status);
if (response.ok) {
  console.log('interactions_endpoint_url =>', result.interactions_endpoint_url);
  console.log('public key =>', result.verify_key ?? result.public_key);
} else {
  console.error(JSON.stringify(result).slice(0, 500));
  process.exit(1);
}
