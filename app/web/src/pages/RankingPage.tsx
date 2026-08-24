import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Paginated, PlayerRank } from "../types";
import { RankingTable } from "../components/RankingTable";
import { Pagination } from "../components/Pagination";
import { ErrorBox, Spinner } from "../components/ui";

export function RankingPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PlayerRank> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .ranking(page, 20, debounced)
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
  }, [page, debounced]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t("rankingPage.title")}</h1>
        <input
          className="search-input"
          placeholder={t("rankingPage.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && !data ? (
        <ErrorBox message={error} />
      ) : loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <RankingTable players={data.items} />
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
    </div>
  );
}
