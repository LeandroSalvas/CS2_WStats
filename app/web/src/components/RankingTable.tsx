import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PlayerRank } from "../types";
import { formatNumber } from "./ui";

interface Props {
  players: PlayerRank[];
  /** Exibir coluna de posição calculada pelo servidor. */
  showRank?: boolean;
  compact?: boolean;
}

export function RankingTable({ players, showRank = true, compact = false }: Props) {
  const { t } = useTranslation();
  return (
    <table className="data-table">
      <thead>
        <tr>
          {showRank && <th className="col-rank">#</th>}
          <th>{t("table.player")}</th>
          <th className="num">{t("table.kills")}</th>
          <th className="num">{t("table.deaths")}</th>
          {!compact && <th className="num">{t("table.hsPercent")}</th>}
          <th className="num">{t("table.kd")}</th>
          <th className="num">{t("table.skill")}</th>
          {!compact && <th className="num">{t("table.matches")}</th>}
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.steamId}>
            {showRank && (
              <td className="col-rank">
                <RankCell rank={p.rank} />
              </td>
            )}
            <td>
              <Link className="player-link" to={`/jogador/${encodeURIComponent(p.steamId)}`}>
                {p.name}
              </Link>
            </td>
            <td className="num">{p.totalKills}</td>
            <td className="num">{p.totalDeaths}</td>
            {!compact && <td className="num">{p.hsPercent}%</td>}
            <td className="num kd">{p.kd}</td>
            <td className="num skill">{formatNumber(p.skill)}</td>
            {!compact && <td className="num">{p.totalMatches}</td>}
          </tr>
        ))}
        {players.length === 0 && (
          <tr>
            <td colSpan={showRank ? 8 : 7} className="empty-row">{t("table.emptyPlayers")}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function RankCell({ rank }: { rank: number }) {
  const { t } = useTranslation();
  if (rank === 1) return <span title={t("table.place1")}>🥇 1</span>;
  if (rank === 2) return <span title={t("table.place2")}>🥈 2</span>;
  if (rank === 3) return <span title={t("table.place3")}>🥉 3</span>;
  return <>{rank}</>;
}
