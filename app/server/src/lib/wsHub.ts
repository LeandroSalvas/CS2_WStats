import type { WebSocket } from "ws";

/**
 * Hub simples de conexões WebSocket por canal.
 * Mantém as conexões em memória; broadcast ignora sockets fechados.
 */
export class WsHub {
  private channels = new Map<string, Set<WebSocket>>();

  join(channel: string, socket: WebSocket): void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(socket);

    socket.once("close", () => {
      set?.delete(socket);
      if (set && set.size === 0) this.channels.delete(channel);
    });
    socket.once("error", () => {
      set?.delete(socket);
    });
  }

  broadcast<T>(channel: string, type: string, data: T): void {
    const set = this.channels.get(channel);
    if (!set || set.size === 0) return;
    const message = JSON.stringify({ type, data });
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.send(message);
        } catch {
          set.delete(socket);
        }
      }
    }
  }

  count(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}
