import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { mapImageUrl } from "../radar/mapRegistry";

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Data/hora no idioma ativo da interface (função pura — segura fora de componentes). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const lang = i18n.language || "en-US";
  return (
    d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatNumber(n: number): string {
  return n.toLocaleString(i18n.language || "en-US");
}

export function MapImage({ mapName, className }: { mapName: string | null; className?: string }) {
  const url = mapImageUrl(mapName);
  if (!url) return <div className={className} />;
  return (
    <div className={className} style={{ backgroundImage: `url(${url})` }}>
      <img src={url} alt={mapName ?? ""} onError={(e) => (e.currentTarget.style.display = "none")} />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box">
      ⚠ {message}
    </div>
  );
}

export function TeamBadge({ team }: { team: string }) {
  const cls = team === "CT" ? "badge-ct" : team === "TR" ? "badge-tr" : "";
  return <span className={`team-badge ${cls}`}>{team}</span>;
}

export function LiveButton() {
  const { t } = useTranslation();
  return (
    <Link to="/ao-vivo" className="live-button">
      <span className="pulse-dot" /> {t("dashboard.watchLive")}
    </Link>
  );
}
