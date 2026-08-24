import { useEffect, useRef, useState } from "react";
import { connectLiveSocket } from "../api/client";
import type { KillFeedEntry, LiveSnapshot, WsMessage } from "../types";

export interface KillFeedItem extends KillFeedEntry {
  /** Identificador único para keys do React. */
  id: number;
}

export interface LiveSocketState {
  status: "connecting" | "open" | "closed";
  snapshot: LiveSnapshot | null;
  delaySeconds: number;
  /** ms desde a chegada do último snapshot; null se nenhum. */
  lastReceivedAt: number | null;
  /** Últimos abatimentos (máx 4), removidos automaticamente após ~5 s. */
  kills: KillFeedItem[];
}

const KILL_FEED_MAX = 4;
const KILL_TTL_MS = 5000;

/** Conecta em /ws/live e expõe o último snapshot recebido (pós-delay). */
export function useLiveSocket(): LiveSocketState {
  const [state, setState] = useState<LiveSocketState>({
    status: "connecting",
    snapshot: null,
    delaySeconds: 30,
    lastReceivedAt: null,
    kills: [],
  });
  const mounted = useRef(true);
  const killSeq = useRef(0);

  useEffect(() => {
    const close = connectLiveSocket(
      (msg) => {
        if (!mounted.current) return;
        const m = msg as unknown as WsMessage;
        if (m.type === "snapshot") {
          setState((s) => ({
            ...s,
            snapshot: m.data,
            lastReceivedAt: Date.now(),
          }));
        } else if (m.type === "hello") {
          setState((s) => ({ ...s, delaySeconds: m.data.delaySeconds }));
        } else if (m.type === "kill") {
          const item: KillFeedItem = { ...m.data, id: ++killSeq.current };
          setState((s) => ({
            ...s,
            // Máx 4: descarta os mais antigos imediatamente.
            kills: [...s.kills, item].slice(-KILL_FEED_MAX),
          }));
          window.setTimeout(() => {
            if (!mounted.current) return;
            setState((s) => ({ ...s, kills: s.kills.filter((k) => k.id !== item.id) }));
          }, KILL_TTL_MS);
        }
      },
      (status) => {
        if (!mounted.current) return;
        setState((s) => ({ ...s, status, ...(status !== "open" ? { kills: [] } : {}) }));
      },
    );
    return () => {
      mounted.current = false;
      close();
    };
  }, []);

  return state;
}
