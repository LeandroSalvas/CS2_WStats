# syntax=docker/dockerfile:1

############################
# Stage 1 — build (server + web)
############################
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Manifests primeiro para aproveitar o cache de dependências
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Código-fonte
COPY server/ server/
COPY web/ web/

# Build: compila TS do servidor e bundle do Vite
RUN npm run build -w server \
    && npm run build -w web

# Remove dependências de desenvolvimento (tsx, typescript, vite...)
# IMPORTANTE: rodar ANTES do prisma generate — o npm prune apaga o client
# gerado (.prisma é considerado extraneous pelo npm).
RUN npm prune --omit=dev

# Regenera o Prisma Client + copia os engines para dentro de node_modules
RUN cd server && npx prisma generate

############################
# Stage 2 — runtime enxuto
############################
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# OpenSSL é necessário pelo engine do Prisma no Debian slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/web/dist ./web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
