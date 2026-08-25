# Changelog / Registro de mudanças

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) ·
Versionamento [SemVer](https://semver.org/lang/pt-BR/) — política:
**PATCH** = correção · **MINOR** = funcionalidade compatível ·
**MAJOR** = quebra contratual (rotas API, protocolo WS, webhooks do plugin,
env do compose, schema do banco).

Processo: toda mudança entra em `[Não publicado]`; no commit, a seção é
promovida a versão com data e recebe tag anotada `vX.Y.Z`.
Each change lands under `[Unreleased]`; on commit it is promoted to a
dated version with an annotated tag.

## [Não publicado] / [Unreleased]
_(nada ainda / nothing yet)_

## [1.2.0] – 2026-08-25
### Adicionado
- Healthcheck duplo do CS2: RCON TCP :27015 na interface interna **e**
  heartbeat de snapshots (`/tmp/cs2wstats.heartbeat`, plugin v1.2.1,
  cadência 5 s, idade ≤ 15 s)
- Ordem de subida garantida via `depends_on.service_healthy`:
  cs2wstats → postgres → cs2-web-app
- Added: dual-condition CS2 healthcheck (internal-interface RCON TCP +
  snapshot-generation heartbeat from plugin v1.2.1) enforcing the startup
  order CS2 → postgres → web app

## [1.1.0] – 2026-08-25
### Alterado
- Tema visual CS 1.6: paleta quente completa (#0e0c0a/#181412/#f05a22),
  fonte Inter, pódio 1º lugar com glow laranja, radar canvas e Recharts
  retintados, favicon laranja; marca/título intocados
- Changed: full CS 1.6 warm-palette rebrand (Inter font, orange podium,
  retinted radar canvas and profile charts); brand/title untouched

## [1.0.1] – 2026-08-25
### Alterado
- Rodapé "CS2 Server Stats © 2026 — Estatísticas e Telemetria em tempo
  real." com byline centralizada (chaves i18n `footer.text`/`footer.by`)
- Changed: new footer message with centered author byline (i18n keys)

## [1.0.0] – 2026-08-25
### Adicionado
- Plataforma completa: servidor CS2 dedicado em Docker (GOTV, bots, GSI),
  API Fastify+Prisma/PostgreSQL (ranking, partidas, perfil do jogador,
  status), WebSocket com buffer FIFO de 30 s (radar 2D + kill feed),
  RBAC com OAuth Google e painel RCON auditado, plugin CounterStrikeSharp
  v1.2.0 (DLL versionada; vitórias em warmup não contam), SPA bilíngue
  PT-BR/EN-US, deploy em sub-path `/cs2/` atrás de proxy reverso
- Added: full platform — dedicated CS2 server (Docker/GOTV/GSI),
  Fastify+Prisma API, live 2D radar + kill feed with 30 s delay buffer,
  RBAC auth with Google OAuth, audited RCON panel, CounterStrikeSharp
  plugin v1.2.0 and bilingual React SPA behind a reverse proxy sub-path
