/**
 * Diagnostico temporal: lista los GitHub Projects v2 que ve el token
 * (viewer + organizacion del repo) para encontrar "dwe backlog".
 * Uso: node scripts/debug-github-projects.mjs
 * No imprime el token.
 */
import 'dotenv/config';

const API = 'https://api.github.com/graphql';
const token = process.env.DEVBOT_GITHUB_TOKEN;
const repo = process.env.DEVBOT_GITHUB_REPO;

if (!token) {
  console.error('Falta DEVBOT_GITHUB_TOKEN en .env');
  process.exit(1);
}

const viewerQuery = `query {
  viewer {
    login
    projectsV2(first: 20) {
      nodes { id title url public createdAt }
    }
  }
}`;

async function graphql(query, variables = {}) {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'devbot-debug-projects',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 800));
  return body.data;
}

try {
  const viewer = await graphql(viewerQuery);
  const vProjects = viewer.viewer?.projectsV2?.nodes ?? [];
  console.log(`Proyectos V2 del viewer (${viewer.viewer?.login}): ${vProjects.length}`);
  for (const p of vProjects) {
    console.log(`- id=${p.id} | "${p.title}" | ${p.url}`);
  }

  // Si hay repo, consultar organizacion
  if (repo) {
    const [owner] = repo.split('/');
    const orgQuery = `query($login: String!) {
      organization(login: $login) {
        login
        projectsV2(first: 20) {
          nodes { id title url public createdAt }
        }
      }
    }`;
    const org = await graphql(orgQuery, { login: owner });
    const oProjects = org.organization?.projectsV2?.nodes ?? [];
    console.log(`\nProyectos V2 de la organizacion ${owner}: ${oProjects.length}`);
    for (const p of oProjects) {
      console.log(`- id=${p.id} | "${p.title}" | ${p.url}`);
    }

    // Tambien proyectos vinculados al repositorio
    const repoQuery = `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        nameWithOwner
        projectsV2(first: 20) {
          nodes { id title url public }
        }
      }
    }`;
    const [own, name] = repo.split('/');
    const repoData = await graphql(repoQuery, { owner: own, repo: name });
    const rProjects = repoData.repository?.projectsV2?.nodes ?? [];
    console.log(`\nProyectos V2 vinculados al repo ${repo}: ${rProjects.length}`);
    for (const p of rProjects) {
      console.log(`- id=${p.id} | "${p.title}" | ${p.url}`);
    }
  }

  if (vProjects.length === 0) {
    console.log('\nEl token no ve ningun proyecto V2. Revisa que el PAT tenga acceso a Projects.');
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
