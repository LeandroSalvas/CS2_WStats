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

## [1.3.3] – 2026-08-27
### Adicionado
- **Tracking de vítimas (KillRecord)**: o plugin agora reporta, para cada
  abate, quem o jogador matou (humano ou bot), com arma, headshot e
  momento. Bots nunca são criados como player — a vítima bot é registrada
  apenas como `bot:<nome>` denormalizado
- Kills em bots contam no `totalKills`/`totalDeaths` do jogador (decisão
  de produto: kills de bot contam como kills normais)
- Kill feed ao vivo: vítimas bot exibem badge `[BOT]`
- Perfil do jogador: nova seção "Abates Recentes" (vítima, arma, HS, data),
  com os 20 abates mais recentes
- Limite de 500 abates persistidos por jogador (FIFO por data — abates mais
  antigos são podados automaticamente)
- NOVO schema: tabela `kill_records` (migração `kill_record` aplicada)
- Kill tracking: plugin reports every frag's victim (human or bot), weapon,
  headshot and time. Bots are never created as players — a bot victim is
  stored denormalized as `bot:<name>`. Bot kills count toward totalKills;
  `[BOT]` badge in live kill feed; new "Recent Kills" section on the player
  profile (20 most recent); per-player cap of 500 persisted kills (FIFO
  prune). New `kill_records` table via `kill_record` migration.

### Corrigido
- Erro 502 ao consultar jogadores via RCON causado por `RCON_PORT` obsoleto
  no container web-app (`docker-compose restart` não reaplica o `.env`) —
  corrigido recriando o container para reaplicar `RCON_PORT=27035`
- Fixed: RCON 502 error caused by a stale `RCON_PORT` in the web-app
  container (`docker-compose restart` does not reapply `.env`) — container
  recreated to reapply `RCON_PORT=27035`

## [1.3.2] – 2026-08-25
### Corrigido
- Porta do servidor CS2: `CS2_PORT` alinhada de 27015 para 27035 (porta
  interna = externa), eliminando conflito com CS 1.6 na porta 27015;
  healthcheck e RCON_PORT atualizados para 27035
- Região do servidor: `sv_region` corrigido de 2 (Europa) para 1
  (América do Sul) — servidor aparece na região correta no server browser
- Fixed: CS2 port aligned to 27035 (internal = external), resolving
  conflict with CS 1.6 on host port 27015; healthcheck and RCON_PORT
  updated; server region corrected to South America

## [1.3.1] – 2026-08-25
### Alterado
- Plugin v1.3.1: filtros `IsBot` adicionados em todos os handlers
  (PlayerDeath, PlayerHurt, WeaponFire, BombPlanted, BombDefused,
  PlayerConnectFull) e no loop GSI — bots existem no jogo (treino,
  utilitários) mas são completamente invisíveis no app
- Bots adicionados via RCON `bot_add` não geram stats, ranking, kill
  feed nem registros no banco
- Plugin v1.3.1: `IsBot` guards added across all event handlers and the
  GSI loop — bots play on the server but are fully invisible to the app

## [1.3.0] – 2026-08-25
### Removido
- Bots do servidor CS2: `bot_quota 0` em runtime via RCON, linhas
  `bot_*` comentadas em `server.cfg`, blocos de env vars removidos do
  `entry.sh` (prevenção contra recriação no próximo boot)
- 28 jogadores bot (`bot:<nome>`) e 6 partidas órfãs (bot-only)
  purgados do banco de dados
- Código morto removido: badge `isBot` do painel RCON, campo `isBot`
  do type `ConnectedPlayer` (server e client)
- Renamed: `.tag-bot` → `.tag-admin` (classe reutilizada pelo painel
  de usuários para badge de admin)
- Removed: bots from CS2 server (`bot_quota 0`), 28 bot players and
  6 orphan bot-only matches purged from database; dead bot code cleaned
  from RCON panel and types; `.tag-bot` renamed to `.tag-admin`

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
