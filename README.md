# CS2 WStats

Estatísticas persistentes + **radar 2D ao vivo (com delay)** para servidores dedicados de **Counter-Strike 2**, tudo em uma única stack Docker.

| Serviço | Descrição |
|---|---|
| `cs2wstats` | Servidor dedicado de CS2 (`cm2network/cs2`) |
| `cs2-web-app` | API Fastify + Dashboard React (radar 2D em Canvas) |
| `postgres` | Banco de dados das estatísticas (Prisma ORM) |

Todos os serviços compartilham a rede interna `cs2-network`. O servidor CS2 fala com a aplicação via resolução de nomes do Docker: `http://cs2-web-app:3000`.

---

## Arquitetura / Fluxos de dados

```
┌───────────────────────────── Docker network: cs2-network ─────────────────────────────┐
│                                                                                       │
│  ┌──────────────────┐   POST /api/gsi (telemetria, RAM apenas)    ┌────────────────┐  │
│  │                  │ ──────────────────────────────────────────► │                │  │
│  │   cs2wstats      │   POST /api/webhooks/kills                  │  cs2-web-app   │  │
│  │   (CS2 dedicado) │ ──────────────┐  POST .../round-end         │  (Fastify+React│  │
│  │                  │ ──────────────┤  POST .../match-end         │   na porta 3000│  │
│  └──────────────────┘               │                             │       ▲        │  │
│                                     ▼                             │       │ WS     │  │
│                            ┌────────────────┐        ┌─────────┐ │  /ws/live      │  │
│                            │    postgres    │◄───────►│ Prisma  │ │       ▼        │  │
│                            │ (persistência) │         └─────────┘ │  Navegador     │  │
│                            └────────────────┘                     └────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Fluxo 1 — Estatísticas persistidas (PostgreSQL):**
- `/api/webhooks/kills` → incrementa agregados globais dos jogadores em tempo real.
- `/api/webhooks/round-end` → atualiza o placar corrente do dashboard (memória).
- `/api/webhooks/match-end` → cria a partida + scoreboard individual + `totalMatches`.

**Fluxo 2 — Radar ao vivo (NUNCA vai para o banco):**
- `/api/gsi` recebe os payloads do Game State Integration.
- O `GSIBufferManager` segura cada pacote **exatamente `GSI_DELAY_SECONDS` (padrão 30s)** em um buffer FIFO na RAM.
- Ao expirar o delay, o pacote é transmitido via WebSocket (`/ws/live`) para a página `/ao-vivo`.
- Se ninguém estiver assistindo, os pacotes simplesmente expiram no buffer (com teto de memória).

---

## 🚀 Como subir a stack

### Pré-requisitos
- Docker 24+ com plugin `docker compose`
- Token de GSLT do Steam (para o servidor aparecer na lista): gere em <https://steamcommunity.com/dev/managegameservers> (AppID 730)

### Passo a passo

```bash
# 1. Clone/entre no repositório
cd CS2_WStats

# 2. Crie seu .env a partir do exemplo e preencha os segredos
cp .env.example .env
nano .env   # defina SRCDS_TOKEN, RCON_PASSWORD, WEBHOOK_SECRET, POSTGRES_PASSWORD...

# 3. (Opcional) Ajuste o GSI_DELAY_SECONDS e demais variáveis no .env.
#    O WEBHOOK_SECRET é sincronizado automaticamente: o entry.sh do CS2 injeta
#    o valor do .env no gamestate_integration_custom.cfg ao subir.
#    Evite os caracteres | & \ no segredo. Ao trocá-lo, recrie ambos:
#    docker compose up -d --force-recreate cs2wstats cs2-web-app

# 4. Suba tudo (primeira vez baixa ~70GB do CS2)
docker compose up --build -d

# 5. Acompanhe o boot do servidor de jogo
docker compose logs -f cs2wstats
# espere a linha "player server started"

# 6. Abra o painel
# http://localhost:8090
```

> O `entry.sh` copia + injeta o `WEBHOOK_SECRET` do `.env` no `gamestate_integration_custom.cfg` (template com `{{WEBHOOK_SECRET}}`) ao subir. Em servidores já provisionados, reinicie o container do CS2 uma vez para que o arquivo seja instalado.

### Portas

| Host | Container | Uso |
|---|---|---|
| `8090` | 3000 | Painel web + API + WebSocket |
| `27035` | 27015 | Game (CS2) |
| `27036` | 27016 | GOTV |

Para trocar a porta do painel, ajuste `APP_PORT` no `.env`.

---

## 🗺️ Imagens de radar (opcional, recomendado)

O radar funciona sem imagens (grade procedural), mas fica muito melhor com o overview real do mapa:

1. Obtenha PNGs de radar top-down dos mapas (qualquer render top-down serve).
2. Salve como `app/web/public/maps/de_dust2.png`, `de_mirage.png`, etc.
3. Rebuild: `docker compose up -d --build cs2-web-app`

### Calibração da projeção

A conversão mundo→tela usa parâmetros estilo `resource/overviews`:

```
imgX = (worldX - posX) / scale
imgY = (posY - worldY) / scale
```

Os defaults estão em `app/web/src/radar/mapRegistry.ts`. Para calibrar **sem rebuild**, crie `app/web/public/maps/mapRegistry.json`:

```json
{
  "de_dust2": { "posX": -2296, "posY": 1856, "scale": 4.8 },
  "meu_mapa_custom": { "posX": -2500, "posY": 2200, "scale": 5 }
}
```

Calibração rápida: ligue os cones de visão de dois jogadores posicionados em cantos opostos do mapa e ajuste `posX/posY/scale` até alinhar.

---

## 🔌 Contrato dos endpoints internos (para plugins)

Autenticação: header `X-Webhook-Secret: <WEBHOOK_SECRET>` (ou bloco `"auth"` no payload GSI). Sem segredo configurado, os endpoints ficam abertos.

### POST /api/webhooks/kills
```jsonc
{
  "attacker": { "steamId": "76561198...", "name": "Nick", "team": "CT" }, // opcional (morte por mundo)
  "victim":   { "steamId": "76561198...", "name": "Nick2", "team": "TR" },
  "assister": { "steamId": "...", "name": "Nick3" },                      // opcional
  "headshot": true,
  "weapon": "ak47"
}
// Formato plano também aceito: attackerSteamId/attackerName/victimSteamId/victimName/headshot
```

### POST /api/webhooks/round-end
```json
{ "mapName": "de_dust2", "scoreCT": 5, "scoreTR": 3, "winner": "CT",
  "players": [ { "steamId": "...", "team": "CT" } ] }  // players é opcional (aprende times p/ o radar)
```

### POST /api/webhooks/match-end
```json
{
  "mapName": "de_dust2", "scoreCT": 16, "scoreTR": 12,
  "durationSeconds": 3547,
  "players": [
    { "steamId": "76561198...", "name": "Nick", "team": "CT",
      "kills": 24, "deaths": 15, "assists": 6, "headshots": 11 }
  ]
}
```
Resposta: `201 { "matchId": 42 }`.

### POST /api/gsi
Payload padrão do Game State Integration do CS2 (seções `map`, `round`, `bomb`, `phase_countdowns`, `allplayers_id/position/state/match_stats`). Opcionalmente aceita o campo extra `allplayers_teams` para mapear o time de cada jogador — útil porque o GSI vanilla nem sempre informa o time; sem ele, o radar aprende os times pelos eventos de kill/round-end dos webhooks.

Teste manual rápido:
```bash
curl -X POST http://localhost:8090/api/gsi \
  -H 'content-type: application/json' -H 'x-webhook-secret: SEU_SEGREDO' \
  -d '{"auth":{"token":"SEU_SEGREDO"},"map":{"name":"de_mirage","phase":"live","round":1,"team_ct":{"score":1},"team_t":{"score":0}}}'
```

---

## 🧪 Testando sem o servidor de CS2 (mock feed)

O projeto inclui um simulador que injeta GSI + kills + partida completa:

```bash
# contra a stack rodando
docker exec -w /app/server cs2-wstats-cs2-web-app-1 \
  node dist/scripts/mock-feed.js --url http://localhost:3000 --secret SEU_SEGREDO --rounds 5

# ou em desenvolvimento local (npm install prévio)
cd app && npm run mock -- --url http://localhost:3000
```

Abra `http://localhost:8090/ao-vivo` durante o mock: jogadores circulando pela dust2, bomba plantando no meio da rodada, placares subindo e, ~30s depois (delay), tudo aparecendo no radar.

---

## 📡 API REST consumida pelo frontend

| Endpoint | Descrição |
|---|---|
| `GET /api/server-status` | Online/offline, nome, mapa, placar, jogadores (fonte: heartbeat GSI em memória) |
| `GET /api/dashboard` | Agregado da home: métricas globais, última partida + MVP, pódio top 3, ranking resumido |
| `GET /api/ranking?page=&limit=&search=` | Ranking paginado com busca por nome/SteamID |
| `GET /api/players?page=&limit=&search=` | Lista de jogadores |
| `GET /api/players/:steamId` | Perfil + últimas 20 partidas |
| `GET /api/matches?map=&page=&limit=` | Histórico de partidas (filtro por mapa) |
| `GET /api/matches/:id` | Detalhe + scoreboard CT/TR + MVP |
| `GET /api/maps` | Mapas distintos (filtro do histórico) |
| `GET /api/health` | Healthcheck (API + banco) |
| `WS /ws/live` | Snapshots do radar pós-delay (`{type:"snapshot", data}`) |

**Fórmulas:** `K/D = kills/deaths` · `HS% = headshots/kills` · `Skill = kills*2 + headshots − deaths` · **MVP** = maior `kills*2 + assists` da partida.

---

## ⏱️ Configurações relevantes (.env)

| Variável | Padrão | Descrição |
|---|---|---|
| `GSI_DELAY_SECONDS` | `30` | Delay do radar ao vivo (buffer FIFO em RAM). `0` desativa o delay. |
| `WEBHOOK_SECRET` | *(vazio)* | Segredo dos webhooks/GSI. Vazio = endpoints abertos. |
| `APP_PORT` | `8090` | Porta do host para o painel. |
| `MAX_BUFFER_ITEMS` | `900` | Teto de pacotes na RAM (proteção de memória). |
| `HEARTBEAT_TIMEOUT_SECONDS` | `30` | Sem GSI por este tempo ⇒ status offline. |
| `LOG_LEVEL` | `info` | `debug` mostra cada payload recebido. |

---

## 💻 Desenvolvimento local (sem Docker)

```bash
cd app
npm install                       # workspaces: server + web

# terminal 1 — Postgres qualquer + API
docker run -d --name wstats-dev-pg -e POSTGRES_USER=wstats -e POSTGRES_PASSWORD=wstats \
  -e POSTGRES_DB=wstats -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgresql://wstats:wstats@localhost:5432/wstats npm run db:migrate -w server
GSI_DELAY_SECONDS=3 npm run dev:server

# terminal 2 — frontend com hot reload (proxy /api e /ws para :3000)
npm run dev:web                   # http://localhost:5173
```

Migrações: edite `app/server/prisma/schema.prisma` → `npm run db:migrate -w server` aplica em produção; use `prisma migrate dev` para gerar novas migrações.

---

## ❓ Troubleshooting

- **Servidor não aparece no painel / status offline** — confira se o `.cfg` GSI está em `game/csgo/cfg/` dentro do volume (`docker compose exec cs2wstats ls ../cs2-dedicated/game/csgo/cfg/`), se a URL aponta para `http://cs2-web-app:3000/api/gsi` e se `LOG_LEVEL=debug` mostra recepções nos logs da app.
- **401 nos webhooks** — o `token` do bloco `auth` do `.cfg` é gerado automaticamente do `WEBHOOK_SECRET` no `.env` pelo `entry.sh`. Se trocou o segredo, recrie os dois containers: `docker compose up -d --force-recreate cs2wstats cs2-web-app`.
- **Radar sem cores de time** — o GSI vanilla não envia time por jogador; o sistema aprende pelos webhooks (`kills`/`round-end` com campos `team`). Plugins tipo MatchZy/CounterStrikeSharp podem enriquecer via `allplayers_teams`.
- **Radar desalinhado** — calibre `posX/posY/scale` conforme seção acima.
- **Resetar as estatísticas** — `docker compose down && docker volume rm cs2-wstats_postgres_data`.
