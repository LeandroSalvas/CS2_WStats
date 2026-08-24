import type { ServerStatusDTO } from "../types";
import { useTranslation } from "react-i18next";
import { MapImage } from "./ui";

export function StatusCard({ server }: { server: ServerStatusDTO }) {
  const { t } = useTranslation();
  return (
    <section className={`card status-card ${server.online ? "online" : "offline"}`}>
      <MapImage mapName={server.mapName} className="status-map-bg" />
      <div className="status-content">
        <div className="status-header">
          <span className={`status-dot ${server.online ? "on" : "off"}`} />
          <h2>{server.serverName}</h2>
          <span className={`pill ${server.online ? "pill-green" : "pill-red"}`}>
            {server.online ? t("status.online") : t("status.offline")}
          </span>
        </div>
        <div className="status-body">
          <div className="status-map">
            <span className="label">{t("status.map")}</span>
            <span className="value">{server.mapName ?? "—"}</span>
            {server.roundNumber != null && (
              <span className="sub">{t("status.round", { n: server.roundNumber })}</span>
            )}
          </div>
          <div className="status-score">
            <span className="score ct">{server.scoreCT}</span>
            <span className="vs">{t("common.vs")}</span>
            <span className="score tr">{server.scoreTR}</span>
          </div>
          <div className="status-players">
            <span className="label">{t("status.players")}</span>
            <span className="value">{server.playersOnline}</span>
            {server.phase && (
              <span className="sub">{phaseLabel(server.phase, t)}</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function phaseLabel(phase: string, t: (key: string) => string): string {
  switch (phase) {
    case "live": return t("status.phaseLive");
    case "freezetime": return t("status.phaseFreeze");
    case "warmup": return t("status.phaseWarmup");
    case "gameover": return t("status.phaseOver");
    default: return phase;
  }
}
