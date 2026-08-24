import { useTranslation } from "react-i18next";
import type { KillFeedItem } from "../hooks/useLiveSocket";

/** Emoji por família de arma (fallback: pistola/rifle genérico). */
function weaponIcon(weapon: string | null): string {
  if (!weapon) return "🔫";
  const w = weapon.toLowerCase();
  if (w.includes("knife")) return "🔪";
  if (w.includes("hegrenade")) return "🧨";
  if (w.includes("molotov") || w.includes("incgrenade")) return "🔥";
  if (w.includes("flashbang") || w.includes("smoke") || w.includes("decoy")) return "💨";
  if (w.includes("awp") || w.includes("ssg08") || w.includes("scout") || w.includes("scar20") || w.includes("g3sg1"))
    return "🎯";
  if (w.includes("taser")) return "⚡";
  if (w === "world" || w.includes("fall")) return "💀";
  return "🔫";
}

const teamClass = (team: string | null): string =>
  team === "CT" ? "kf-ct" : team === "TR" ? "kf-tr" : "kf-un";

export function KillFeed({ kills }: { kills: KillFeedItem[] }) {
  const { t } = useTranslation();
  return (
    <section className="card kill-feed-panel">
      <h3>🔫 {t("killfeed.title")}</h3>
      {kills.length === 0 ? (
        <p className="muted kill-feed-empty">{t("killfeed.empty")}</p>
      ) : (
        <ul className="kill-feed">
          {kills.map((k) => (
            <li key={k.id} className="kf-row">
              <span className={`kf-name ${teamClass(k.attackerTeam)}`}>
                {k.attackerName ?? t("killfeed.world")}
              </span>
              <span className="kf-arrow">→</span>
              <span className={`kf-name ${teamClass(k.victimTeam)}`}>{k.victimName}</span>
              <span className="kf-icon">
                {weaponIcon(k.weapon)}
                {k.isHeadshot && <span className="kf-hs" title={t("killfeed.headshot")}>💥</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
