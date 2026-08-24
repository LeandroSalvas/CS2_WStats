import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { StatusCard } from "../components/StatusCard";
import { Podium } from "../components/Podium";
import { RankingTable } from "../components/RankingTable";
import { ErrorBox, LiveButton, Spinner, formatDate, formatDuration, formatNumber, MapImage } from "../components/ui";

const REFRESH_MS = 15000;

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, error, loading } = usePolling(() => api.dashboard(), REFRESH_MS);

  if (loading && !data) return <Spinner label={t("dashboard.loadingDashboard")} />;
  if (error && !data) return <ErrorBox message={t("dashboard.loadError", { error })} />;
  if (!data) return null;

  const { server, metrics, lastMatch, podium, recentRanking } = data;

  return (
    <div className="page">
      <div className="dashboard-grid">
        <StatusCard server={server} />

        <section className="card last-match-card">
          <h3>{t("dashboard.lastMatch")}</h3>
          {lastMatch ? (
            <Link to={`/partidas/${lastMatch.id}`} className="last-match-body">
              <MapImage mapName={lastMatch.mapName} className="last-match-map" />
              <div>
                <div className="last-match-score">
                  <span className="score ct">{lastMatch.scoreCT}</span>
                  <span className="vs">—</span>
                  <span className="score tr">{lastMatch.scoreTR}</span>
                </div>
                <div className="last-match-info">
                  <span className="map-name">{lastMatch.mapName}</span>
                  <span>{formatDuration(lastMatch.durationSeconds)}</span>
                  <span>{formatDate(lastMatch.endedAt)}</span>
                </div>
                {lastMatch.mvp && (
                  <div className="mvp-line">
                    ⭐ MVP: <strong>{lastMatch.mvp.name}</strong>{" "}
                    <small>({t("podium.killsCount", { count: lastMatch.mvp.kills })})</small>
                  </div>
                )}
              </div>
            </Link>
          ) : (
            <p className="empty-note">{t("dashboard.noMatchesYet")}</p>
          )}
        </section>

        <LiveButton />

        <section className="card metrics-row">
          <MetricTile label={t("dashboard.registeredPlayers")} value={formatNumber(metrics.players)} icon="👥" />
          <MetricTile label={t("dashboard.totalKills")} value={formatNumber(metrics.kills)} icon="💀" />
          <MetricTile label={t("dashboard.mapsPlayed")} value={formatNumber(metrics.maps)} icon="🗺️" />
        </section>

        <section className="card podium-card">
          <h3>{t("dashboard.seasonPodium")}</h3>
          {podium.length > 0 ? <Podium players={podium} /> : <p className="empty-note">{t("dashboard.notEnoughPlayers")}</p>}
        </section>

        <section className="card table-card">
          <h3>{t("dashboard.recentStats")}</h3>
          <RankingTable players={recentRanking} compact />
        </section>
      </div>
    </div>
  );
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="metric-tile">
      <span className="metric-icon">{icon}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
