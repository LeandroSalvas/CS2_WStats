using System.Globalization;
using System.IO;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Timers;

namespace CS2WStats;

public class CS2WStats : BasePlugin
{
    public override string ModuleName => "CS2WStats";
    public override string ModuleVersion => "1.3.3";
    public override string ModuleAuthor => "CS2WStats";

    private readonly HttpClient _http = new();
    private string _gsiUrl = "http://cs2-web-app:3000/api/gsi";
    private string _killsUrl = "http://cs2-web-app:3000/api/webhooks/kills";
    private string _roundEndUrl = "http://cs2-web-app:3000/api/webhooks/round-end";
    private string _matchEndUrl = "http://cs2-web-app:3000/api/webhooks/match-end";
    private string _secret = "";
    private CounterStrikeSharp.API.Modules.Timers.Timer? _gsiTimer;
    private DateTime _lastHeartbeat = DateTime.MinValue; // throttle do heartbeat local (healthcheck)

    // ---- Estado da partida corrente (por mapa) ----
    private string? _currentMap;
    private bool _matchSent;
    private bool _sawLiveRound; // já houve rodada real (não-warmup) neste mapa?
    private DateTime _matchStartUtc = DateTime.UtcNow;
    private int _scoreCT;
    private int _scoreTR;
    private int _roundNumber; // rodadas completadas
    private string _phase = "live";
    private DateTime? _phaseUntil;

    private sealed class Accum
    {
        public string Name = "";
        public string Team = "CT";

        // Scoreboard por partida (absoluto, vai no match-end como hoje).
        public int Kills, Deaths, Assists, Headshots;

        // Métricas estendidas — DELTAS desde o último flush (round-end/match-end).
        // O servidor apenas incrementa colunas globais com estes valores.
        public int dShotsFired, dShotsHit, dDamage, dTk, dPlants, dDefusions, dConnections;
        public double dSeconds;
    }

    private readonly Dictionary<string, Accum> _matchPlayers = new();

    public override void Load(bool hotReload)
    {
        _secret = Environment.GetEnvironmentVariable("WEBHOOK_SECRET") ?? "";
        var baseUrl = Environment.GetEnvironmentVariable("WSTATS_URL") ?? "http://cs2-web-app:3000";
        baseUrl = baseUrl.TrimEnd('/');
        _gsiUrl = $"{baseUrl}/api/gsi";
        _killsUrl = $"{baseUrl}/api/webhooks/kills";
        _roundEndUrl = $"{baseUrl}/api/webhooks/round-end";
        _matchEndUrl = $"{baseUrl}/api/webhooks/match-end";

        if (!string.IsNullOrEmpty(_secret))
            _http.DefaultRequestHeaders.Add("X-Webhook-Secret", _secret);
        _http.Timeout = TimeSpan.FromSeconds(5);

        Console.WriteLine($"[CS2WStats] loaded v{ModuleVersion}, gsiUrl={_gsiUrl} secret={(string.IsNullOrEmpty(_secret) ? "(none)" : "***")}");

        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire);
        RegisterEventHandler<EventBombPlanted>(OnBombPlanted);
        RegisterEventHandler<EventBombDefused>(OnBombDefused);
        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnectFull);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);
        RegisterEventHandler<EventRoundFreezeEnd>(OnRoundFreezeEnd);
        RegisterEventHandler<EventCsWinPanelMatch>(OnMatchEnd);

        _gsiTimer = AddTimer(0.5f, SendGsi, TimerFlags.REPEAT);
    }

    public override void Unload(bool hotReload)
    {
        _gsiTimer?.Kill();
    }

    /* ------------------------------ eventos ------------------------------ */

    private HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo info)
    {
        // A vítima pode ser bot: queremos reportar o kill de um HUMANO sobre um
        // bot (para tracking), mantendo o bot como não-jogador no app. Por isso
        // NÃO retornamos cedo quando victim.IsBot.
        var victim = @event.Userid;
        if (victim == null || !victim.IsValid || victim.IsHLTV) return HookResult.Continue;

        var attacker = @event.Attacker;
        var assister = @event.Assister;

        // Death só conta para humanos (bot não vira player).
        if (!victim.IsBot) GetAccum(victim).Deaths++;

        // Apenas um atacante HUMANO gera kill contabilizado e registro de abate.
        var humanAttacker = attacker != null && attacker.IsValid && !attacker.IsHLTV &&
                            !attacker.IsBot && attacker.Handle != victim.Handle;
        if (humanAttacker)
        {
            var accA = GetAccum(attacker);
            accA.Kills++;
            if (@event.Headshot) accA.Headshots++;

            // Teamkill: mesmo time (e time válido), sem ser suicídio.
            var tAtt = TeamStr(attacker.TeamNum);
            if (tAtt == TeamStr(victim.TeamNum) && tAtt != "UNASSIGNED")
                accA.dTk++;
        }

        if (assister != null && assister.IsValid && !assister.IsHLTV && !assister.IsBot &&
            assister.Handle != victim.Handle && (attacker == null || assister.Handle != attacker.Handle))
        {
            GetAccum(assister).Assists++;
        }

        // Reporta o abate toda vez que um HUMANO é o autor — a vítima pode ser
        // humana (steamId64) ou bot ("bot:<nome>"). O backend decide persistir.
        if (humanAttacker)
        {
            var payload = new
            {
                attacker = new
                {
                    steamId = PlayerKey(attacker),
                    name = attacker.PlayerName,
                    team = TeamStr(attacker.TeamNum)
                },
                victim = new
                {
                    steamId = PlayerKey(victim),
                    name = victim.PlayerName,
                    team = TeamStr(victim.TeamNum)
                },
                headshot = @event.Headshot,
                weapon = @event.Weapon
            };
            _ = PostJson(_killsUrl, payload);
        }
        return HookResult.Continue;
    }

    /// <summary>Tiros acertados + dano causado (exclui auto-dano).</summary>
    private HookResult OnPlayerHurt(EventPlayerHurt @event, GameEventInfo info)
    {
        var attacker = @event.Attacker;
        var victim = @event.Userid;
        if (attacker == null || !attacker.IsValid || attacker.IsHLTV || attacker.IsBot) return HookResult.Continue;
        if (victim == null || !victim.IsValid || victim.IsHLTV || victim.IsBot) return HookResult.Continue;
        if (attacker.Handle == victim.Handle) return HookResult.Continue;

        var acc = GetAccum(attacker);
        acc.dShotsHit++;
        acc.dDamage += Math.Max(0, @event.DmgHealth);
        return HookResult.Continue;
    }

    /// <summary>Tiros disparados (exclui faca, granadas e C4 — só balas contam para accuracy).</summary>
    private HookResult OnWeaponFire(EventWeaponFire @event, GameEventInfo info)
    {
        var shooter = @event.Userid;
        if (shooter == null || !shooter.IsValid || shooter.IsHLTV || shooter.IsBot) return HookResult.Continue;

        var weapon = @event.Weapon ?? "";
        if (weapon.StartsWith("weapon_knife") ||
            weapon is "weapon_hegrenade" or "weapon_flashbang" or "weapon_smokegrenade"
                or "weapon_molotov" or "weapon_incgrenade" or "weapon_decoy"
                or "weapon_c4" or "weapon_taser")
        {
            return HookResult.Continue;
        }

        GetAccum(shooter).dShotsFired++;
        return HookResult.Continue;
    }

    private HookResult OnBombPlanted(EventBombPlanted @event, GameEventInfo info)
    {
        var planter = @event.Userid;
        if (planter == null || !planter.IsValid || planter.IsHLTV || planter.IsBot) return HookResult.Continue;
        GetAccum(planter).dPlants++;
        return HookResult.Continue;
    }

    private HookResult OnBombDefused(EventBombDefused @event, GameEventInfo info)
    {
        var defuser = @event.Userid;
        if (defuser == null || !defuser.IsValid || defuser.IsHLTV || defuser.IsBot) return HookResult.Continue;
        GetAccum(defuser).dDefusions++;
        return HookResult.Continue;
    }

    private HookResult OnPlayerConnectFull(EventPlayerConnectFull @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid || player.IsHLTV || player.IsBot) return HookResult.Continue;
        GetAccum(player).dConnections++;
        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd @event, GameEventInfo info)
    {
        // Regra de negócio: vitórias em warmup NÃO contam — sem incremento de
        // placar, sem contagem de rodada e sem webhook de round-end.
        if (IsWarmup()) return HookResult.Continue;

        _roundNumber++;
        if (@event.Winner == 3) _scoreCT++;
        else if (@event.Winner == 2) _scoreTR++;
        _phase = "freezetime"; // próxima rodada começa em freeze

        var payload = new
        {
            mapName = Server.MapName,
            scoreCT = _scoreCT,
            scoreTR = _scoreTR,
            winner = @event.Winner == 3 ? "CT" : @event.Winner == 2 ? "TR" : null,
            reason = @event.Reason,
            stats = CollectStatDeltas()
        };
        _ = PostJson(_roundEndUrl, payload);
        return HookResult.Continue;
    }

    private HookResult OnRoundStart(EventRoundStart @event, GameEventInfo info)
    {
        if (IsWarmup()) return HookResult.Continue;
        _phase = "freezetime";
        var freeze = TryConVarFloat("mp_freezetime", 15f);
        _phaseUntil = DateTime.UtcNow.AddSeconds(freeze);
        return HookResult.Continue;
    }

    private HookResult OnRoundFreezeEnd(EventRoundFreezeEnd @event, GameEventInfo info)
    {
        if (IsWarmup()) return HookResult.Continue;
        _sawLiveRound = true;
        _phase = "live";
        _phaseUntil = null;
        return HookResult.Continue;
    }

    private HookResult OnMatchEnd(EventCsWinPanelMatch @event, GameEventInfo info)
    {
        SendMatchEnd(Server.MapName, "win-panel");
        return HookResult.Continue;
    }

    /* -------------------------------- GSI -------------------------------- */

    private void SendGsi()
    {
        try
        {
            var mapName = Server.MapName ?? "";

            // Detecção de troca de mapa: grava a partida anterior e reinicia acumuladores.
            if (_currentMap == null)
            {
                StartNewMap(mapName);
            }
            else if (!string.IsNullOrEmpty(mapName) && mapName != _currentMap)
            {
                SendMatchEnd(_currentMap, "map-change");
                StartNewMap(mapName);
            }

            // Transição automática freezetime -> live.
            if (_phase == "freezetime" && _phaseUntil.HasValue && DateTime.UtcNow >= _phaseUntil.Value)
            {
                _phase = "live";
                _phaseUntil = null;
            }

            // Warmup tem precedência sobre a fase interna (o painel exibe "aquecimento").
            var phase = IsWarmup() ? "warmup" : _phase;

            var allplayers_id = new Dictionary<string, object>();
            var allplayers_position = new Dictionary<string, string>();
            var allplayers_state = new Dictionary<string, object>();
            var allplayers_match_stats = new Dictionary<string, object>();
            var allplayers_teams = new Dictionary<string, string>();

            foreach (var p in Utilities.GetPlayers())
            {
                if (!p.IsValid || p.IsHLTV || p.IsBot) continue;
                var pawn = p.PlayerPawn.Value;
                if (pawn == null || !pawn.IsValid) continue;

                var origin = pawn.AbsOrigin;
                var angles = pawn.EyeAngles;
                if (origin == null) continue;

                // Slot estável por conexão.
                var slot = (p.UserId ?? 64).ToString();

                allplayers_id[slot] = new
                {
                    name = p.PlayerName,
                    steamid = p.IsBot || p.SteamID == 0 ? (object?)null : p.SteamID.ToString()
                };
                // Formato GSI nativo: "x y z;pitch yaw roll"
                allplayers_position[slot] =
                    $"{origin.X:F2} {origin.Y:F2} {origin.Z:F2};{angles.X:F2} {angles.Y:F2} 0";
                allplayers_state[slot] = new
                {
                    health = pawn.Health,
                    armor = pawn.ArmorValue,
                    helmet = (pawn.ItemServices as CCSPlayer_ItemServices)?.HasHelmet ?? false,
                    money = p.InGameMoneyServices?.Account ?? 0,
                    weapon = pawn.WeaponServices?.ActiveWeapon.Value?.DesignerName ?? "unknown"
                };
                allplayers_teams[slot] = TeamStr(p.TeamNum);
                allplayers_match_stats[slot] = new
                {
                    kills = p.ActionTrackingServices?.MatchStats.Kills ?? 0,
                    deaths = p.ActionTrackingServices?.MatchStats.Deaths ?? 0,
                    assists = p.ActionTrackingServices?.MatchStats.Assists ?? 0
                };

                // Mantém o scoreboard da partida atualizado com todos presentes
                // e amostra tempo de sessão (+0.5 s por tick presente no servidor).
                var acc = GetAccum(p);
                acc.dSeconds += 0.5;
            }

            // Bomba
            string bombState = "carried";
            string? bombPos = null;
            var planted = Utilities.FindAllEntitiesByDesignerName<CPlantedC4>("planted_c4").FirstOrDefault(e => e.IsValid);
            if (planted != null)
            {
                bombState = planted.BombTicking ? "planted" : "defused";
                var o = planted.AbsOrigin;
                if (o != null) bombPos = $"{o.X:F2} {o.Y:F2} {o.Z:F2}";
            }
            else
            {
                var dropped = Utilities.FindAllEntitiesByDesignerName<CBaseEntity>("weapon_c4")
                    .FirstOrDefault(e => e.IsValid);
                if (dropped != null)
                {
                    var o = dropped.AbsOrigin;
                    if (o != null) bombPos = $"{o.X:F2} {o.Y:F2} {o.Z:F2}";
                    bombState = "dropped";
                }
            }

            var phaseEndsIn = _phase == "freezetime" && _phaseUntil.HasValue
                ? Math.Max(0f, (float)(_phaseUntil.Value - DateTime.UtcNow).TotalSeconds)
                : 0f;

            var payload = new
            {
                auth = new { token = _secret },
                provider = new { name = "Counter-Strike 2", appid = 730, timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() },
                map = new
                {
                    name = mapName,
                    phase,
                    round = _roundNumber + 1,
                    team_ct = new { score = _scoreCT },
                    team_t = new { score = _scoreTR }
                },
                bomb = new { state = bombState, position = bombPos },
                phase_countdowns = new { phase, phase_ends_in = phaseEndsIn.ToString("0.0", CultureInfo.InvariantCulture) },
                allplayers_id,
                allplayers_position,
                allplayers_state,
                allplayers_match_stats,
                allplayers_teams
            };

            // Heartbeat local para o healthcheck do container: sinaliza que o
            // plugin está gerando snapshots. Escrita throttled a cada 5 s;
            // falha de IO nunca pode afetar o loop de telemetria.
            if ((DateTime.UtcNow - _lastHeartbeat).TotalSeconds >= 5)
            {
                _lastHeartbeat = DateTime.UtcNow;
                try
                {
                    File.WriteAllText(
                        "/tmp/cs2wstats.heartbeat",
                        DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
                }
                catch { /* /tmp indisponível: ignora */ }
            }

            _ = PostJson(_gsiUrl, payload);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CS2WStats] GSI error: {ex.Message}");
        }
    }

    /* ----------------------------- persistência ---------------------------- */

    private void StartNewMap(string mapName)
    {
        _currentMap = mapName;
        _matchSent = false;
        _sawLiveRound = false;
        _matchStartUtc = DateTime.UtcNow;
        _scoreCT = 0;
        _scoreTR = 0;
        _roundNumber = 0;
        _phase = "live";
        _phaseUntil = null;
        _matchPlayers.Clear();
        Console.WriteLine($"[CS2WStats] nova partida em '{mapName}'");
    }

    private void SendMatchEnd(string? mapName, string reason)
    {
        if (_matchSent || _currentMap == null || string.IsNullOrEmpty(mapName)) return;
        if (_matchPlayers.Count == 0) return;

        // Nunca houve rodada real: era tudo warmup — não persiste "partida".
        if (!_sawLiveRound)
        {
            Console.WriteLine($"[CS2WStats] match-end ({reason}) ignorado: mapa '{mapName}' nunca saiu do warmup");
            _matchSent = true; // evita reenvio em cascata no mesmo mapa
            return;
        }
        _matchSent = true;

        var players = _matchPlayers
            .Select(kv => new
            {
                steamId = kv.Key,
                name = kv.Value.Name,
                team = kv.Value.Team,
                kills = kv.Value.Kills,
                deaths = kv.Value.Deaths,
                assists = kv.Value.Assists,
                headshots = kv.Value.Headshots
            })
            .ToList();

        var payload = new
        {
            mapName,
            scoreCT = _scoreCT,
            scoreTR = _scoreTR,
            durationSeconds = Math.Max(0, (int)(DateTime.UtcNow - _matchStartUtc).TotalSeconds),
            players,
            stats = CollectStatDeltas()
        };
        Console.WriteLine($"[CS2WStats] match-end ({reason}): mapa={mapName} placar {_scoreCT}x{_scoreTR} jogadores={players.Count}");
        _ = PostJson(_matchEndUrl, payload);
    }

    /// <summary>
    /// Consolida os DELTAS de métricas estendidas desde o último flush.
    /// Zera os contadores após coletar (o servidor faz increment puro).
    /// </summary>
    private List<object> CollectStatDeltas()
    {
        var list = new List<object>();
        foreach (var kv in _matchPlayers)
        {
            var a = kv.Value;
            if (a.dShotsFired == 0 && a.dShotsHit == 0 && a.dDamage == 0 && a.dTk == 0 &&
                a.dPlants == 0 && a.dDefusions == 0 && a.dConnections == 0 && a.dSeconds < 1)
            {
                continue;
            }

            list.Add(new
            {
                steamId = kv.Key,
                name = a.Name,
                team = a.Team,
                shotsFired = a.dShotsFired,
                shotsHit = a.dShotsHit,
                damage = a.dDamage,
                tk = a.dTk,
                plants = a.dPlants,
                defusions = a.dDefusions,
                connections = a.dConnections,
                secondsPlayed = (int)a.dSeconds
            });

            a.dShotsFired = 0;
            a.dShotsHit = 0;
            a.dDamage = 0;
            a.dTk = 0;
            a.dPlants = 0;
            a.dDefusions = 0;
            a.dConnections = 0;
            a.dSeconds -= (int)a.dSeconds; // preserva fração pendente (<1 s)
        }
        return list;
    }

    /* ------------------------------- helpers ------------------------------- */

    /// <summary>m_bWarmupPeriod do jogo — true durante mp_warmup.</summary>
    private static bool IsWarmup()
    {
        try
        {
            var proxy = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules")
                .FirstOrDefault(e => e.IsValid);
            return proxy?.GameRules?.WarmupPeriod ?? false;
        }
        catch
        {
            return false;
        }
    }

    /// Humanos usam SteamID64; bots recebem identidade estável por persona ("bot:<nome>").
    private static string PlayerKey(CCSPlayerController p) =>
        p.IsBot || p.SteamID == 0
            ? $"bot:{p.PlayerName.Trim().ToLowerInvariant()}"
            : p.SteamID.ToString();

    private Accum GetAccum(CCSPlayerController p)
    {
        var key = PlayerKey(p);
        if (!_matchPlayers.TryGetValue(key, out var acc))
        {
            acc = new Accum { Name = p.PlayerName, Team = TeamStr(p.TeamNum) };
            _matchPlayers[key] = acc;
        }
        else
        {
            acc.Name = p.PlayerName;
            var t = TeamStr(p.TeamNum);
            if (t != "UNASSIGNED") acc.Team = t;
        }
        return acc;
    }

    private static string TeamStr(int teamNum) =>
        teamNum == 3 ? "CT" : teamNum == 2 ? "TR" : "UNASSIGNED";

    private static float TryConVarFloat(string name, float fallback)
    {
        try
        {
            var cvar = ConVar.Find(name);
            return cvar != null ? cvar.GetPrimitiveValue<float>() : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private async Task PostJson(string url, object payload)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload);
            using var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
            using var resp = await _http.PostAsync(url, content);
            if (!resp.IsSuccessStatusCode && resp.StatusCode != System.Net.HttpStatusCode.NoContent)
            {
                var body = await resp.Content.ReadAsStringAsync();
                Console.WriteLine($"[CS2WStats] POST {url} -> {(int)resp.StatusCode} {body}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CS2WStats] POST failed {url}: {ex.Message}");
        }
    }
}
