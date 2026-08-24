import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useLiveSocket } from "../hooks/useLiveSocket";
import { KillFeed } from "../components/KillFeed";
import { RadarRenderer } from "../radar/RadarRenderer";
import type { LiveSnapshot, ServerStatusDTO } from "../types";
import { ErrorBox, formatNumber } from "../components/ui";

export function LiveRadarPage() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RadarRenderer | null>(null);
  const { status: wsStatus, snapshot, delaySeconds, kills } = useLiveSocket();
  const [serverStatus, setServerStatus] = useState<ServerStatusDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Status do servidor (placar/timer quando não há snapshot ainda)
  useEffect(() => {
    const load = (): void => {
      api.serverStatus().then(setServerStatus).catch((e) => setError(String(e)));
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // Renderer lifecycle
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new RadarRenderer(canvasRef.current);
    rendererRef.current = renderer;
    renderer.start();
    return () => {
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  // Novo snapshot -> renderer
  useEffect(() => {
    if (!snapshot || !rendererRef.current) return;
    void rendererRef.current.setMap(snapshot.mapName ?? "unknown");
    rendererRef.current.push(snapshot);
  }, [snapshot]);

  const view = snapshot ?? null;
  const header = view ? view : serverStatusFallback(serverStatus);

  return (
    <div className="page live-page">
      <div className="page-header">
        <h1>
          {t("live.title")}{" "}
          <span className={`pill ${wsStatus === "open" ? "pill-green" : "pill-red"}`}>
            {wsStatus === "open"
              ? t("live.connected", { seconds: delaySeconds })
              : t("live.disconnected")}
          </span>
        </h1>
      </div>

      {error && <ErrorBox message={error} />}

      <div className="live-layout">
        <div className="radar-container">
          <canvas ref={canvasRef} className="radar-canvas" />
          {header.mapName && (
            <div className="radar-map-label">{header.mapName}</div>
          )}
        </div>

        <SidePanel
          snapshot={view}
          status={serverStatus}
          connected={wsStatus === "open"}
        />
      </div>

      <KillFeed kills={kills} />
    </div>
  );
}

function serverStatusFallback(s: ServerStatusDTO | null): Partial<LiveSnapshot> {
  if (!s) return {};
  return {
    mapName: s.mapName,
    scoreCT: s.scoreCT,
    scoreTR: s.scoreTR,
    phaseEndsIn: s.phaseEndsIn,
    phase: s.phase,
    roundNumber: s.roundNumber,
    bomb: { state: s.bombState, x: null, y: null, z: null },
    players: [],
    ts: 0,
  };
}

function SidePanel({
  snapshot,
  status,
  connected,
}: {
  snapshot: LiveSnapshot | null;
  status: ServerStatusDTO | null;
  connected: boolean;
}) {
  const { t } = useTranslation();
  const players = snapshot?.players ?? [];
  const ct = players.filter((p) => p.team === "CT");
  const tr = players.filter((p) => p.team === "TR");
  const unassigned = players.filter((p) => p.team === "UNASSIGNED");
  const aliveCt = ct.filter((p) => p.alive).length;
  const aliveTr = tr.filter((p) => p.alive).length;

  const timer =
    snapshot?.phaseEndsIn != null
      ? `${Math.floor(snapshot.phaseEndsIn / 60)}:${String(Math.floor(snapshot.phaseEndsIn % 60)).padStart(2, "0")}`
      : "--:--";

  const economyCt = ct.reduce((acc, p) => acc + (p.money ?? 0), 0);
  const economyTr = tr.reduce((acc, p) => acc + (p.money ?? 0), 0);

  return (
    <aside className="card side-panel">
      <div className="side-score">
        <div className="side-team ct">
          <span className="team-name">CT</span>
          <span className="team-alive">{connected && snapshot ? t("live.alive", { n: aliveCt }) : "—"}</span>
        </div>
        <div className="side-mid">
          <div className="side-timer">{timer}</div>
          <div className="side-scoreline">
            <span className="score ct">{snapshot?.scoreCT ?? status?.scoreCT ?? 0}</span>
            <span className="vs">:</span>
            <span className="score tr">{snapshot?.scoreTR ?? status?.scoreTR ?? 0}</span>
          </div>
          {snapshot?.bomb.state === "planted" && (
            <div className="bomb-planted">{t("live.bombPlanted")}</div>
          )}
        </div>
        <div className="side-team tr">
          <span className="team-name">TR</span>
          <span className="team-alive">{connected && snapshot ? t("live.alive", { n: aliveTr }) : "—"}</span>
        </div>
      </div>

      <PlayerList title={`CT (${aliveCt}/${ct.length})`} teamClass="ct" players={[...ct, ...unassigned]} />
      <PlayerList title={`TR (${aliveTr}/${tr.length})`} teamClass="tr" players={tr} />

      {(snapshot || connected) && (
        <div className="economy-row">
          <span>{t("live.ctEconomy", { amount: formatNumber(economyCt) })}</span>
          <span>{t("live.trEconomy", { amount: formatNumber(economyTr) })}</span>
        </div>
      )}

      {!connected && (
        <p className="empty-note">{t("live.waiting")}</p>
      )}
    </aside>
  );
}

function PlayerList({
  title,
  teamClass,
  players,
}: {
  title: string;
  teamClass: string;
  players: LivePlayerLike[];
}) {
  const { t } = useTranslation();
  if (players.length === 0) return null;
  return (
    <div className="player-list">
      <h4 className={teamClass}>{title}</h4>
      <ul>
        {[...players]
          .sort((a, b) => Number(b.alive) - Number(a.alive))
          .map((p) => (
            <li key={p.id} className={p.alive ? "" : "dead"}>
              <span className="hp-bar" style={{ width: `${Math.max(4, p.hp)}%` }} />
              <span className="pl-name">{p.name}</span>
              <span className="pl-hp">{p.alive ? `${p.hp}hp` : "☠"}</span>
              {p.weapon === "weapon_c4" && <span title={t("live.c4Carrier")}>💣</span>}
            </li>
          ))}
      </ul>
    </div>
  );
}

type LivePlayerLike = import("../types").LivePlayer;
