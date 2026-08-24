import type { PlayerRank } from "../types";
import { useTranslation } from "react-i18next";

/** Pódio do top 3 — 2º | 1º | 3º. */
export function Podium({ players }: { players: Array<PlayerRank & { medal: number }> }) {
  const { t } = useTranslation();
  if (players.length === 0) return null;
  const order = [players[1], players[0], players[2]].filter(Boolean);
  return (
    <div className="podium">
      {order.map((p) => (
        <div key={p.steamId} className={`podium-slot place-${p.medal}`}>
          <div className="medal">{medalEmoji(p.medal)}</div>
          <div className="avatar">{p.name.slice(0, 2).toUpperCase()}</div>
          <div className="podium-name" title={p.name}>{p.name}</div>
          <div className="podium-kills">{t("podium.killsCount", { count: p.totalKills })}</div>
          <div className="podium-kd">K/D {p.kd}</div>
        </div>
      ))}
    </div>
  );
}

function medalEmoji(place: number): string {
  switch (place) {
    case 1: return "🥇";
    case 2: return "🥈";
    default: return "🥉";
  }
}
