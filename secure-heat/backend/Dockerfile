# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# No lockfile is committed with this project; commit package-lock.json and switch to `npm ci` for reproducible builds.
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Full node_modules are kept because the entrypoint runs the Prisma CLI (migrate deploy).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json docker-entrypoint.sh ./
# Shared volume location for the one-time sensor credentials written by the seed (owned by the app user so named volumes inherit it).
RUN mkdir -p /creds && chown node:node /creds && chmod +x docker-entrypoint.sh
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
