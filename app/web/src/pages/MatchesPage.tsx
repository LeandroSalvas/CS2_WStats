import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { MatchListItem, Paginated } from "../types";
import { Pagination } from "../components/Pagination";
import { ErrorBox, Spinner, formatDate, formatDuration } from "../components/ui";

export function MatchesPage() {
  const { t } = useTranslation();
  const [mapFilter, setMapFilter] = useState("");
  const [maps, setMaps] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<MatchListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.matchMaps().then((r) => setMaps(r.maps)).catch(() => setMaps([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .matches(page, 12, mapFilter || undefined)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [page, mapFilter]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t("matches.title")}</h1>
        <select
          className="search-input"
          value={mapFilter}
          onChange={(e) => {
            setMapFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t("matches.allMaps")}</option>
          {maps.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {error && !data ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="match-grid">
            {data.items.map((m) => (
              <Link to={`/partidas/${m.id}`} key={m.id} className="card match-card">
                <div className="match-card-map">{m.mapName}</div>
                <div className="match-card-score">
                  <span className="score ct">{m.scoreCT}</span>
                  <span className="vs">—</span>
                  <span className="score tr">{m.scoreTR}</span>
                </div>
                <div className="match-card-meta">
                  <span>{formatDuration(m.durationSeconds)}</span>
                  <span>{formatDate(m.endedAt)}</span>
                </div>
                {m.mvpName && (
                  <div className="match-card-mvp">{t("matches.mvpShort", { name: m.mvpName, kills: m.mvpKills })}</div>
                )}
              </Link>
            ))}
            {data.items.length === 0 && <p className="empty-note">{t("matches.noneFound")}</p>}
          </div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
    </div>
  );
}
