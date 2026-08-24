import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { MatchDetail, MatchStatRow } from "../types";
import { ErrorBox, Spinner, formatDate, formatDuration } from "../components/ui";

export function MatchDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!id) return;
    api
      .match(id)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const winner = data.match.scoreCT >= data.match.scoreTR ? "CT" : "TR";

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          {t("matches.matchNo", { id: data.match.id })}{" "}
          <span className="accent">{data.match.mapName}</span>
        </h1>
      </div>

      <section className="card match-detail-head">
        <div className="match-card-score big">
          <span className={`score ct ${winner === "CT" ? "win" : ""}`}>{data.match.scoreCT}</span>
          <span className="vs">—</span>
          <span className={`score tr ${winner === "TR" ? "win" : ""}`}>{data.match.scoreTR}</span>
        </div>
        <div className="match-card-meta">
          <span>⏱ {formatDuration(data.match.durationSeconds)}</span>
          <span>📅 {formatDate(data.match.endedAt)}</span>
          <span className={`pill ${winner === "CT" ? "pill-blue" : "pill-orange"}`}>
            {t("matches.victory", { team: winner })}
          </span>
        </div>
        {data.mvp && (
          <div className="mvp-line">
            ⭐ MVP: <strong>{data.mvp.name}</strong>{" "}
            <small>
              ({data.mvp.kills}k / {data.mvp.deaths}d / {data.mvp.assists}a)
            </small>
          </div>
        )}
      </section>

      <div className="scoreboards">
        <Scoreboard title={t("matches.ctTitle")} teamClass="ct" rows={data.ct} />
        <Scoreboard title={t("matches.tTitle")} teamClass="tr" rows={data.tr} />
      </div>
    </div>
  );
}

function Scoreboard({
  title,
  teamClass,
  rows,
}: {
  title: string;
  teamClass: string;
  rows: MatchStatRow[];
}) {
  const { t } = useTranslation();
  return (
    <section className="card">
      <h3 className={teamClass}>{title}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("table.player")}</th>
            <th className="num">K</th>
            <th className="num">D</th>
            <th className="num">A</th>
            <th className="num">HS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.steamId}>
              <td>{r.name}</td>
              <td className="num">{r.kills}</td>
              <td className="num">{r.deaths}</td>
              <td className="num">{r.assists}</td>
              <td className="num">{r.headshots}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">{t("matches.noData")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
