import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { PlayerProfile } from "../types";
import { ErrorBox, formatNumber, Spinner } from "../components/ui";

/** Série com acumulados para os gráficos de evolução. */
interface SeriesPoint {
  day: string;
  killsDia: number;
  killsTotal: number;
  skill: number;
  kd: number;
}

function buildSeries(profile: PlayerProfile): SeriesPoint[] {
  let kills = 0;
  let deaths = 0;
  let headshots = 0;
  return profile.series.map((d) => {
    kills += d.kills;
    deaths += d.deaths;
    headshots += d.headshots;
    // Mesma fórmula do servidor: k*2 + hs - d.
    const skill = kills * 2 + headshots - deaths;
    const kd = deaths > 0 ? kills / deaths : kills > 0 ? kills : 0;
    return {
      day: d.day.slice(5), // MM-DD
      killsDia: d.kills,
      killsTotal: kills,
      skill,
      kd: Math.round(kd * 100) / 100,
    };
  });
}

export function PlayerProfilePage() {
  const { t, i18n } = useTranslation();
  const { steamId = "" } = useParams<{ steamId: string }>();
  const [data, setData] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .player(steamId)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [steamId]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const series = buildSeries(data);
  const fmtDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  const fmtNum = (n: number | string): string =>
    typeof n === "number" ? n.toLocaleString(i18n.language) : Number(n).toLocaleString(i18n.language);

  const combatCards: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: t("profile.combat.kills"), value: fmtNum(data.combat.kills) },
    { label: t("profile.combat.deaths"), value: fmtNum(data.combat.deaths) },
    { label: t("profile.combat.headshots"), value: fmtNum(data.combat.headshots) },
    { label: t("profile.combat.kd"), value: String(data.combat.kd), accent: true },
    { label: t("profile.combat.skill"), value: fmtNum(data.combat.skill), accent: true },
    {
      label: t("profile.combat.accuracy"),
      value:
        data.combat.accuracyPercent != null
          ? `${data.combat.accuracyPercent}%`
          : t("profile.noDataYet"),
    },
    { label: t("profile.combat.assists"), value: fmtNum(data.combat.assists) },
    { label: t("profile.combat.tk"), value: fmtNum(data.combat.tk) },
    { label: t("profile.combat.damage"), value: fmtNum(data.combat.damageTotal) },
  ];

  const bombCards = [
    { label: t("profile.bomb.plants"), value: fmtNum(data.bomb.plants), icon: "💣" },
    { label: t("profile.bomb.defused"), value: fmtNum(data.bomb.defusions), icon: "🛡️" },
  ];

  const timeCards = [
    { label: t("profile.time.hours"), value: String(data.time.hoursPlayed) },
    { label: t("profile.time.connections"), value: fmtNum(data.time.connections) },
    { label: t("profile.time.firstSeen"), value: fmtDate(data.time.firstSeenAt) },
    {
      label: t("profile.time.lastMap"),
      value: data.time.lastMapName ?? t("profile.noDataYet"),
    },
  ];

  return (
    <div className="page profile-page">
      {/* ------------------------- Cabeçalho ------------------------- */}
      <div className="page-header profile-header">
        <div>
          <h1 className="profile-nick">{data.identity.name}</h1>
          <span className="mono profile-steamid">{data.identity.steamId}</span>
        </div>
        <span className="pill pill-cyan">
          #{data.identity.rank} · {t("profile.rankLabel")}
        </span>
      </div>

      {/* -------------------------- COMBATE -------------------------- */}
      <section className="panel">
        <h3>{t("profile.combat.title")}</h3>
        <div className="metric-grid">
          {combatCards.map((c) => (
            <div key={c.label} className={`metric-card ${c.accent ? "accent" : ""}`}>
              <span className="metric-label">{c.label}</span>
              <span className="metric-value">{c.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------- BOMBA --------------------------- */}
      <section className="panel">
        <h3>{t("profile.bomb.title")}</h3>
        <div className="metric-grid metric-grid-4">
          {bombCards.map((c) => (
            <div key={c.label} className="metric-card">
              <span className="metric-label">
                {c.icon} {c.label}
              </span>
              <span className="metric-value">{c.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------- TEMPO & SESSÃO ----------------------- */}
      <section className="panel">
        <h3>{t("profile.time.title")}</h3>
        <div className="metric-grid metric-grid-4">
          {timeCards.map((c) => (
            <div key={c.label} className="metric-card">
              <span className="metric-label">{c.label}</span>
              <span className="metric-value">{c.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------ Gráficos ------------------------ */}
      <div className="charts-row">
        <section className="panel chart-panel">
          <h3>{t("profile.charts.killsTitle")}</h3>
          {series.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradKills" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f05a22" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#f05a22" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#181412", border: "1px solid #2e241f", borderRadius: 10 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  formatter={(value) => [formatNumber(Number(value)), undefined]}
                />
                <Area
                  type="monotone"
                  dataKey="killsDia"
                  name={t("profile.charts.killsDay")}
                  stroke="#f05a22"
                  strokeWidth={2}
                  fill="url(#gradKills)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-note">{t("profile.noSeriesYet")}</p>
          )}
        </section>

        <section className="panel chart-panel">
          <h3>{t("profile.charts.skillKdTitle")}</h3>
          {series.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis yAxisId="skill" stroke="#a78bfa" fontSize={11} allowDecimals={false} />
                <YAxis yAxisId="kd" orientation="right" stroke="#f05a22" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "#181412", border: "1px solid #2e241f", borderRadius: 10 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  yAxisId="skill"
                  type="monotone"
                  dataKey="skill"
                  name={t("table.skill")}
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="kd"
                  type="monotone"
                  dataKey="kd"
                  name={t("table.kd")}
                  stroke="#f05a22"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted empty-note">{t("profile.noSeriesYet")}</p>
          )}
        </section>
      </div>

      {/* -------------------- Histórico recente -------------------- */}
      <section className="panel">
        <h3>{t("profile.recentTitle")}</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("profile.table.date")}</th>
              <th>{t("status.map")}</th>
              <th className="num">{t("table.kills")}</th>
              <th className="num">{t("table.deaths")}</th>
              <th className="num">HS</th>
              <th className="num">{t("table.skill")}</th>
            </tr>
          </thead>
          <tbody>
            {data.matches.map((m) => (
              <tr key={m.matchId}>
                <td>{fmtDate(m.endedAt)}</td>
                <td>{m.mapName}</td>
                <td className="num">{m.kills}</td>
                <td className="num">{m.deaths}</td>
                <td className="num">{m.headshots}</td>
                <td className="num skill">{m.kills * 2 + m.headshots - m.deaths}</td>
              </tr>
            ))}
            {data.matches.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">{t("matches.noneFound")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
