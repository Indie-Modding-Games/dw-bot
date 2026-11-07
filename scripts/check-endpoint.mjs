import 'dotenv/config';

const r = await fetch(
  'https://discord.com/api/v10/applications/' + process.env.DISCORD_APPLICATION_ID,
  {
    headers: { Authorization: 'Bot ' + process.env.DISCORD_TOKEN },
  },
);
const a = await r.json();
console.log('endpoint:', a.interactions_endpoint_url);
console.log('event_types:', JSON.stringify(a.interactions_event_types ?? null));
