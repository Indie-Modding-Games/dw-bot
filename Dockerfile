# syntax=docker/dockerfile:1
# DevBot — imagen multi-etapa. Compatible linux/amd64 y linux/arm64 (Oracle A1).
# better-sqlite3 trae precompilados para ambas arquitecturas en Debian slim;
# no requiere toolchain de compilacion.

# ---------- build: compila TypeScript ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime: solo produccion, user no-root (arquitectura §11.11) ----------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# El bind-mount de ./data debe poder escribirse como uid 1000 (node).
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "dist/index.js"]
