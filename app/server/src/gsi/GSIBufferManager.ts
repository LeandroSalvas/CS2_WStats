/**
 * Buffer FIFO em memória RAM que segura pacotes por `delayMs`
 * antes de liberá-los, em ordem de chegada, via callback.
 * Genérico: transmite snapshots do radar E eventos de kill feed
 * (ambos respeitando exatamente o mesmo delay).
 * NENHUM dado aqui toca o banco de dados.
 */
export class GSIBufferManager<T> {
  private queue: Array<{ releaseAt: number; item: T }> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: {
    /** Delay em ms entre a recepção e a retransmissão. */
    delayMs: () => number;
    /** Limite de segurança para não estourar a RAM se ninguém consumir. */
    maxItems: number;
    /** Chamado (em ordem FIFO) para cada pacote cujo delay expirou. */
    onRelease: (item: T) => void;
    sweepIntervalMs?: number;
  }) {}

  push(item: T): void {
    this.queue.push({ releaseAt: Date.now() + this.opts.delayMs(), item });
    if (this.queue.length > this.opts.maxItems) {
      // Descarta os mais antigos para conter memória (servidor sem espectadores, etc).
      this.queue.splice(0, this.queue.length - this.opts.maxItems);
    }
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.sweepIntervalMs ?? 100;
    this.timer = setInterval(() => this.sweep(), interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get size(): number {
    return this.queue.length;
  }

  get delaySeconds(): number {
    return this.opts.delayMs() / 1000;
  }

  private sweep(): void {
    const now = Date.now();
    while (this.queue.length > 0 && this.queue[0].releaseAt <= now) {
      const pkt = this.queue.shift();
      if (!pkt) break;
      try {
        this.opts.onRelease(pkt.item);
      } catch (err) {
        // Nunca derruba o sweep por erro num consumidor.
        console.error("[GSIBuffer] erro ao liberar pacote:", err);
      }
    }
  }
}
