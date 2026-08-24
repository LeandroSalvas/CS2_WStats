import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, type RconPlayer } from "../api/client";
import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorBox, Spinner } from "../components/ui";

const QUICK_COMMANDS = ["status", "users", "stats", "mp_warmup_end", "changelevel de_dust2"];

interface CommandDoc {
  cmd: string;
  args: string;
  desc: string;
}

const COMMAND_REFERENCE: CommandDoc[] = [
  { cmd: "status", args: "", desc: "Jogadores conectados, mapa e versão do servidor." },
  { cmd: "users", args: "", desc: "Players currently connected (CS2)." },
  { cmd: "stats", args: "", desc: "K/D dos jogadores na partida atual." },
  { cmd: "kickid", args: "<userid>", desc: "Desconecta o jogador pelo userid." },
  { cmd: "banid", args: "<min> <userid>", desc: "Bane por minutos (0 = permanente)." },
  { cmd: "writeid", args: "", desc: "Persiste a lista de banidos em banned_user.cfg." },
  { cmd: "removeid", args: "<steamid>", desc: "Remove um banimento da lista." },
  { cmd: "mp_warmup_end", args: "", desc: "Encerra o aquecimento e inicia a partida." },
  { cmd: "mp_restartgame", args: "<segundos>", desc: "Reinicia a partida (placar zerado)." },
  { cmd: "mp_maxrounds", args: "<n>", desc: "Define o número máximo de rounds." },
  { cmd: "mp_freezetime", args: "<segundos>", desc: "Duração do freezetime por round." },
  { cmd: "changelevel", args: "<mapa>", desc: "Troca de mapa (ex.: de_mirage)." },
  { cmd: "sv_cheats", args: "<0|1>", desc: "Ativa cheats de servidor (treino)." },
  { cmd: "bot_kick", args: "", desc: "Remove todos os bots." },
  { cmd: "bot_add_ct", args: "", desc: "Adiciona bot no time CT." },
  { cmd: "bot_add_t", args: "", desc: "Adiciona bot no time TR." },
  { cmd: "tv_enable", args: "<0|1>", desc: "Liga/desliga GOTV." },
  { cmd: "hostname", args: "<nome>", desc: "Altera o nome do servidor." },
];

export function AdminRconPage() {
  const { t, i18n } = useTranslation();
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [players, setPlayers] = useState<RconPlayer[] | null>(null);
  const [playersError, setPlayersError] = useState<string | null>(null);

  const [history, setHistory] = useState<{ command: string; at: Date }[]>([]);
  const [refSearch, setRefSearch] = useState("");

  const [kickTarget, setKickTarget] = useState<RconPlayer | null>(null);
  const [banTarget, setBanTarget] = useState<RconPlayer | null>(null);
  const [banMinutes, setBanMinutes] = useState<number>(1440);
  const [banReason, setBanReason] = useState("");
  const [modalBusy, setModalBusy] = useState(false);

  const termRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [lines]);

  const refreshPlayers = useCallback(async () => {
    try {
      const data = await api.rconPlayers();
      setPlayers(data.players);
      setPlayersError(null);
    } catch (err) {
      setPlayersError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshPlayers();
    const t = setInterval(() => void refreshPlayers(), 5_000);
    return () => clearInterval(t);
  }, [refreshPlayers]);

  async function runCommand(cmd: string): Promise<void> {
    const trimmed = cmd.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.rconExec(trimmed);
      setLines((prev) => [
        ...prev,
        `> ${trimmed}`,
        ...(res.response ? res.response.split(/\r?\n/) : ["(sem saída)"]),
      ]);
      setHistory((prev) => [{ command: trimmed, at: new Date() }, ...prev].slice(0, 50));
      setCommand("");
      void refreshPlayers();
    } catch (err) {
      setLines((prev) => [...prev, `> ${trimmed}`, `ERRO: ${err instanceof Error ? err.message : String(err)}`]);
      if (!(err instanceof Error)) setError(String(err));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function confirmKick(): Promise<void> {
    if (!kickTarget) return;
    setModalBusy(true);
    try {
      await api.rconKick(kickTarget.userid);
      setKickTarget(null);
      await refreshPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModalBusy(false);
    }
  }

  async function confirmBan(): Promise<void> {
    if (!banTarget) return;
    setModalBusy(true);
    try {
      await api.rconBan(banTarget.userid, banMinutes, banReason.trim() || undefined);
      setBanTarget(null);
      setBanReason("");
      await refreshPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModalBusy(false);
    }
  }

  const filteredRef = COMMAND_REFERENCE.filter(
    (d) =>
      refSearch === "" ||
      d.cmd.toLowerCase().includes(refSearch.toLowerCase()) ||
      t(`rcon.ref.${d.cmd}`).toLowerCase().includes(refSearch.toLowerCase()),
  );

  return (
    <div className="page admin-rcon-page">
      <div className="admin-grid">
        {/* ------------------------- Console ------------------------- */}
        <section className="panel console-panel">
          <form
            className="console-form"
            onSubmit={(e) => {
              e.preventDefault();
              void runCommand(command);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="console-input"
              placeholder={t("rcon.placeholder")}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="btn-exec" disabled={busy || !command.trim()}>
              {busy ? t("rcon.executing") : t("rcon.execute")}
            </button>
          </form>
          <div className="quick-row">
            {QUICK_COMMANDS.map((q) => (
              <button
                key={q}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => void runCommand(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="terminal" ref={termRef}>
            {lines.length === 0 ? (
              <div className="terminal-empty">
                <Trans
                  i18nKey="rcon.terminalHint"
                  components={{ code: <code /> }}
                />
              </div>
            ) : (
              lines.map((l, i) => (
                <div key={i} className={l.startsWith("> ") ? "t-cmd" : l.startsWith("ERRO") ? "t-err" : ""}>
                  {l}
                </div>
              ))
            )}
          </div>
          {error && <ErrorBox message={error} />}
        </section>

        {/* -------------------- Histórico + referência -------------------- */}
        <aside className="side-col">
          <section className="panel history-panel">
            <h3>{t("rcon.history")}</h3>
            {history.length === 0 ? (
              <p className="muted">{t("rcon.historyEmpty")}</p>
            ) : (
              <ul>
                {history.map((h, i) => (
                  <li key={i}>
                    <button type="button" className="hist-item" onClick={() => void runCommand(h.command)}>
                      <code>{h.command}</code>
                      <span className="muted">
                        {h.at.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel reference-panel">
            <h3>{t("rcon.reference")}</h3>
            <input
              type="search"
              className="ref-search"
              placeholder={t("rcon.searchRef")}
              value={refSearch}
              onChange={(e) => setRefSearch(e.target.value)}
            />
            <ul className="ref-list">
              {filteredRef.map((d) => (
                <li key={d.cmd}>
                  <button
                    type="button"
                    className="ref-item"
                    onClick={() => {
                      setCommand(d.args ? `${d.cmd} ` : d.cmd);
                      inputRef.current?.focus();
                    }}
                  >
                    <code>{d.cmd}</code>{" "}
                    {d.args && <span className="ref-args">{d.args}</span>}
                    <span className="ref-desc">{t(`rcon.ref.${d.cmd}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {/* --------------------------- Jogadores --------------------------- */}
      <section className="panel players-panel">
        <h3>{t("rcon.playersTitle")}</h3>
        {playersError ? (
          <ErrorBox message={t("rcon.queryFailed", { error: playersError })} />
        ) : players == null ? (
          <Spinner label={t("rcon.querying")} />
        ) : players.length === 0 ? (
          <p className="muted">{t("rcon.nobodyConnected")}</p>
        ) : (
          <table className="data-table players-table">
            <thead>
              <tr>
                <th>{t("rcon.colUserid")}</th>
                <th>{t("rcon.colName")}</th>
                <th>{t("rcon.colTeam")}</th>
                <th>{t("rcon.colKda")}</th>
                <th>{t("rcon.colPing")}</th>
                <th>{t("rcon.colConnected")}</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={`${p.userid}-${p.name}`}>
                  <td className="mono">{p.userid || "—"}</td>
                  <td>
                    <span className="player-name">{p.name}</span>
                    {p.isBot && <span className="tag-bot">BOT</span>}
                  </td>
                  <td>{p.team ?? "—"}</td>
                  <td className="mono">
                    {p.kills ?? "?"} / {p.deaths ?? "?"} / {p.assists ?? "?"}
                  </td>
                  <td className="mono">{p.ping ?? "—"}</td>
                  <td className="mono">{p.connectedTime ?? "—"}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="btn-small"
                      disabled={!p.userid}
                      onClick={() => setKickTarget(p)}
                    >
                      {t("rcon.kick")}
                    </button>
                    <button
                      type="button"
                      className="btn-small btn-danger-outline"
                      disabled={!p.userid}
                      onClick={() => setBanTarget(p)}
                    >
                      {t("rcon.ban")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ----------------------------- Modais ----------------------------- */}
      {kickTarget && (
        <ConfirmModal
          title={t("rcon.kickModalTitle")}
          confirmLabel={t("rcon.kickConfirm")}
          danger
          busy={modalBusy}
          onConfirm={() => void confirmKick()}
          onCancel={() => setKickTarget(null)}
        >
          <Trans
            i18nKey="rcon.kickModalBody"
            values={{ name: kickTarget.name }}
            components={{ strong: <strong /> }}
          />
        </ConfirmModal>
      )}

      {banTarget && (
        <ConfirmModal
          title={t("rcon.banModalTitle")}
          confirmLabel={t("rcon.banConfirm")}
          danger
          busy={modalBusy}
          onConfirm={() => void confirmBan()}
          onCancel={() => {
            setBanTarget(null);
            setBanReason("");
          }}
        >
          <p>
            <Trans
              i18nKey="rcon.banModalBody"
              values={{ name: banTarget.name }}
              components={{ strong: <strong /> }}
            />
          </p>
          <label className="field">
            <span>{t("rcon.duration")}</span>
            <select
              value={banMinutes}
              onChange={(e) => setBanMinutes(Number(e.target.value))}
            >
              <option value={30}>{t("rcon.durations.m30")}</option>
              <option value={60}>{t("rcon.durations.h1")}</option>
              <option value={1440}>{t("rcon.durations.d1")}</option>
              <option value={10080}>{t("rcon.durations.w1")}</option>
              <option value={0}>{t("rcon.durations.permanent")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("rcon.reason")}</span>
            <input
              type="text"
              value={banReason}
              maxLength={200}
              placeholder={t("rcon.reasonPlaceholder")}
              onChange={(e) => setBanReason(e.target.value)}
            />
          </label>
          <p className="muted modal-note">
            <Trans i18nKey="rcon.banNote" components={{ code: <code /> }} />
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
