# --- build stage: compile TypeScript, build native deps (better-sqlite3) ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

# --- runtime stage: prod node_modules + compiled output only ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV PORT=8787 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/revenuedog.db
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Persist the SQLite database outside the container layer.
VOLUME ["/data"]
EXPOSE 8787
# Healthcheck hits the unauthenticated /health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
