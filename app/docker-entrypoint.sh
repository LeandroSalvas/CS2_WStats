#!/usr/bin/env bash
# Entrypoint do cs2-web-app: espera o Postgres, aplica migrações e sobe a API.
set -euo pipefail
# O schema.prisma fica em /app/server/prisma; o CLI resolve a partir daqui.
cd /app/server

ATTEMPTS="${DB_CONNECT_ATTEMPTS:-30}"
echo "[entrypoint] Aplicando migrações do Prisma (tentativas restantes: ${ATTEMPTS})..."
until npx --yes prisma migrate deploy; do
  ATTEMPTS=$((ATTEMPTS - 1))
  if [ "${ATTEMPTS}" -le 0 ]; then
    echo "[entrypoint] ERRO: banco de dados indisponível após várias tentativas."
    exit 1
  fi
  echo "[entrypoint] Postgres ainda não disponível; tentando novamente em 2s (${ATTEMPTS} restantes)..."
  sleep 2
done

echo "[entrypoint] Iniciando servidor em ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node dist/index.js
