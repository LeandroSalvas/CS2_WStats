import type { LivePlayer, LiveSnapshot } from "../types";
import { getOverview, mapImageUrl, type MapOverview } from "./mapRegistry";

interface TimedSnapshot {
  snapshot: LiveSnapshot;
  arrival: number; // performance.now()
}

interface DeathMarker {
  x: number;
  y: number;
  at: number; // performance.now()
}

interface KillVector {
  from: { x: number; y: number };
  to: { x: number; y: number };
  at: number;
}

const TEAM_COLORS: Record<string, string> = {
  CT: "#3b82f6",
  TR: "#f59e0b",
  UNASSIGNED: "#94a3b8",
};

const DEATH_FADE_MS = 4000;
const KILL_VECTOR_MS = 2500;

/**
 * Renderizador 2D do radar ao vivo em HTML5 Canvas.
 * - Interpola posições entre snapshots (suaviza o throttle do GSI);
 * - Desenha jogadores por time, cone de visão, HP, bomba,
 *   marcadores de morte e vetores de kill;
 * - Usa a imagem de radar do mapa quando disponível (/maps/{mapa}.png),
 *   com fallback para grade procedural.
 */
export class RadarRenderer {
  private ctx: CanvasRenderingContext2D;
  private prev: TimedSnapshot | null = null;
  private latest: TimedSnapshot | null = null;
  private overview: MapOverview | null = null;
  private mapImage: HTMLImageElement | null = null;
  private mapName: string | null = null;
  private imageCache = new Map<string, HTMLImageElement>();
  private deaths: DeathMarker[] = [];
  private killVectors: KillVector[] = [];
  private rafId = 0;
  private running = false;
  private resizeObserver: ResizeObserver | null = null;

  // Enquadramento dinâmico (usado quando não há imagem de radar):
  // bounding box suavizada das posições observadas, garantindo que
  // nenhum jogador saia da área exibida.
  private dynCX = 0;
  private dynCY = 0;
  private dynSpanX = 4000;
  private dynSpanY = 4000;
  private dynInitialized = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D não suportado neste navegador");
    this.ctx = ctx;
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resizeCanvas();
  }

  /** Troca de mapa: carrega imagem e parâmetros de projeção. */
  async setMap(mapName: string): Promise<void> {
    if (this.mapName === mapName) return;
    this.mapName = mapName;
    this.overview = await getOverview(mapName);

    const url = mapImageUrl(mapName);
    let img = url ? this.imageCache.get(url) : undefined;
    if (!img && url) {
      img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        // Sem imagem disponível — o renderizador usa a grade procedural.
      }
      if (img.naturalWidth > 0) this.imageCache.set(url, img);
      else img = undefined;
    }
    if (this.mapName === mapName) this.mapImage = img ?? null;
  }

  push(snapshot: LiveSnapshot): void {
    const now = performance.now();

    // Detecta mortes e kills comparando com o snapshot anterior.
    const before = new Map(this.prev?.snapshot.players.map((p) => [p.id, p]) ?? []);
    for (const player of snapshot.players) {
      const old = before.get(player.id);
      if (old && old.alive && !player.alive) {
        this.deaths.push({ x: player.x, y: player.y, at: now });
        // Quem pontuou entre os vivos inimigos mais próximo vira origem do vetor.
        const killer = this.guessKiller(before.get(player.id) as LivePlayer, snapshot.players);
        if (killer && killer.x !== 0 && killer.y !== 0) {
          this.killVectors.push({
            from: { x: killer.x, y: killer.y },
            to: { x: player.x, y: player.y },
            at: now,
          });
        }
      }
    }

    this.prev = this.latest;
    this.latest = { snapshot, arrival: now };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      this.render(performance.now());
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
  }

  /* ------------------------------ internals ------------------------------ */

  private guessKiller(victim: LivePlayer | undefined, players: LivePlayer[]): LivePlayer | null {
    if (!victim) return null;
    const victimIsCT = victim.team === "CT";
    let best: LivePlayer | null = null;
    let bestDist = Infinity;
    for (const p of players) {
      if (!p.alive || !victim.steamId || p.id === victim.id) continue;
      const enemy = victim.team !== "UNASSIGNED" ? (victimIsCT ? p.team === "TR" : p.team === "CT") : true;
      if (!enemy) continue;
      const dist = (p.x - victim.x) ** 2 + (p.y - victim.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return bestDist < 3500 * 3500 ? best : null;
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? this.canvas.clientWidth;
    const h = parent?.clientHeight ?? this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Parâmetros do ajuste da imagem (real ou lógica 1024px) ao canvas. */
  private computeTransform(): { ox: number; oy: number; fit: number; refW: number; refH: number } {
    const { width: cw, height: ch } = this.ctx.canvas;
    const refW = this.mapImage?.naturalWidth ?? 1024;
    const refH = this.mapImage?.naturalHeight ?? 1024;
    const fit = Math.min(cw / refW, ch / refH) * 0.97;
    return {
      ox: cw / 2 - (refW * fit) / 2,
      oy: ch / 2 - (refH * fit) / 2,
      fit,
      refW,
      refH,
    };
  }

  /** Converte coordenadas de mundo -> pixels da tela. */
  private worldToScreen(x: number, y: number): { sx: number; sy: number } {
    if (this.mapImage) {
      const ov = this.overview ?? { posX: -2500, posY: 2500, scale: 5 };
      const ix = (x - ov.posX) / ov.scale;
      const iy = (ov.posY - y) / ov.scale; // eixo Y invertido na imagem
      const t = this.computeTransform();
      return { sx: t.ox + ix * t.fit, sy: t.oy + iy * t.fit };
    }
    // Sem imagem: projeção dinâmica centrada no bounding box observado.
    const { width: cw, height: ch } = this.ctx.canvas;
    const k = Math.min(cw / this.dynSpanX, ch / this.dynSpanY);
    return { sx: cw / 2 + (x - this.dynCX) * k, sy: ch / 2 - (y - this.dynCY) * k };
  }

  /**
   * Atualiza o bounding box dinâmico com as posições do snapshot atual.
   * Suavizado por lerp para evitar "pulos" de câmera entre frames.
   */
  private updateDynBounds(snap: LiveSnapshot): void {
    if (this.mapImage) return;
    const pts: Array<{ x: number; y: number }> = snap.players
      .filter((p) => p.alive)
      .map((p) => ({ x: p.x, y: p.y }));
    if (snap.bomb.x != null && snap.bomb.y != null) pts.push({ x: snap.bomb.x, y: snap.bomb.y });
    if (pts.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const targetCX = (minX + maxX) / 2;
    const targetCY = (minY + maxY) / 2;
    const targetSpanX = Math.max(2200, (maxX - minX) * 1.35); // margem de ~17%
    const targetSpanY = Math.max(2200, (maxY - minY) * 1.35);

    if (!this.dynInitialized) {
      this.dynCX = targetCX;
      this.dynCY = targetCY;
      this.dynSpanX = targetSpanX;
      this.dynSpanY = targetSpanY;
      this.dynInitialized = true;
      return;
    }
    const a = 0.06; // suavização por frame (~60fps)
    this.dynCX += (targetCX - this.dynCX) * a;
    this.dynCY += (targetCY - this.dynCY) * a;
    this.dynSpanX += (targetSpanX - this.dynSpanX) * a;
    this.dynSpanY += (targetSpanY - this.dynSpanY) * a;
  }

  private render(now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.drawBackground(ctx);

    if (!this.latest) {
      this.drawWaitingText(ctx);
      return;
    }

    const snap = this.interpolate(now);
    if (snap.mapName && snap.mapName !== this.mapName) void this.setMap(snap.mapName);
    this.updateDynBounds(snap);

    // Limpa marcadores expirados.
    this.deaths = this.deaths.filter((d) => now - d.at < DEATH_FADE_MS);
    this.killVectors = this.killVectors.filter((k) => now - k.at < KILL_VECTOR_MS);

    for (const kv of this.killVectors) this.drawKillVector(ctx, kv, now);
    for (const d of this.deaths) this.drawDeathMarker(ctx, d, now);

    const sorted = [...snap.players].sort((a, b) => Number(a.alive) - Number(b.alive));
    for (const p of sorted) this.drawPlayer(ctx, p, now);

    this.drawBomb(ctx, snap.bomb, now);
  }

  /** Interpola posições entre prev/latest conforme o ritmo real dos pacotes. */
  private interpolate(now: number): LiveSnapshot {
    if (!this.prev || !this.latest) return this.latest!.snapshot;
    const interval = this.latest.snapshot.ts - this.prev.snapshot.ts;
    if (!(interval > 0)) return this.latest.snapshot;

    const alpha = Math.min(1, (now - this.latest.arrival) / interval);
    const out: LiveSnapshot = structuredClone(this.latest.snapshot);

    const prevById = new Map(this.prev.snapshot.players.map((p) => [p.id, p]));
    for (const p of out.players) {
      const pp = prevById.get(p.id);
      if (!pp) continue;
      const dx = p.x - pp.x;
      const dy = p.y - pp.y;
      // Teleporte/respawn: não interpola.
      if (dx * dx + dy * dy > 2500 * 2500) continue;
      p.x = pp.x + dx * alpha;
      p.y = pp.y + dy * alpha;
    }
    return out;
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    if (this.mapImage) {
      const t = this.computeTransform();
      ctx.drawImage(this.mapImage, t.ox, t.oy, t.refW * t.fit, t.refH * t.fit);
      return;
    }
    // Grade procedural escura quando não há imagem de radar para o mapa.
    const { width: cw, height: ch } = ctx.canvas;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    ctx.beginPath();
    for (let x = 0; x < cw; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = 0; y < ch; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();
    if (this.mapName) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.15)";
      ctx.font = `700 ${Math.max(18, cw / 28)}px Rajdhani, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(this.mapName.toUpperCase(), cw / 2, ch / 2);
    }
  }

  private drawWaitingText(ctx: CanvasRenderingContext2D): void {
    const { width: cw, height: ch } = ctx.canvas;
    ctx.fillStyle = "#22d3ee";
    ctx.font = `600 ${Math.max(14, cw / 45)}px Rajdhani, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(
      "Aguardando telemetria… (delay configurado)",
      cw / 2,
      ch / 2 + 40,
    );
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: LivePlayer, _now: number): void {
    const { sx, sy } = this.worldToScreen(p.x, p.y);
    const color = TEAM_COLORS[p.team] ?? TEAM_COLORS.UNASSIGNED;
    const r = Math.max(6, ctx.canvas.width / 190);

    if (!p.alive) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, r / 3);
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r);
      ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx + r, sy - r);
      ctx.lineTo(sx - r, sy + r);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Cone de visão
    if (p.yaw != null) {
      const yawRad = (-p.yaw * Math.PI) / 180;
      const coneLen = r * 4.5;
      ctx.fillStyle = hexWithAlpha(color, 0.16);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, coneLen, yawRad - Math.PI / 9, yawRad + Math.PI / 9);
      ctx.closePath();
      ctx.fill();
    }

    // Círculo do jogador
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Anel de HP (verde -> vermelho)
    if (p.hp > 0) {
      const hpColor = `hsl(${Math.round(p.hp * 1.2)}, 85%, 50%)`;
      ctx.strokeStyle = hpColor;
      ctx.lineWidth = Math.max(2, r / 2.8);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, -Math.PI / 2, -Math.PI / 2 + (p.hp / 100) * Math.PI * 2);
      ctx.stroke();
    }

    // Nome
    const fontPx = Math.max(10, ctx.canvas.width / 130);
    ctx.font = `600 ${fontPx}px Rajdhani, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(p.name, sx + 1, sy - r - 7 + 1);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(p.name, sx, sy - r - 7);

    // Bomba na mão
    if (p.weapon === "weapon_c4") {
      ctx.font = `${Math.max(11, r)}px sans-serif`;
      ctx.fillText("💣", sx + r + 8, sy + r / 2);
    }
  }

  private drawBomb(ctx: CanvasRenderingContext2D, bomb: LiveSnapshot["bomb"], now: number): void {
    if (bomb.state !== "planted" && bomb.state !== "dropped") return;
    if (bomb.x == null || bomb.y == null) return;
    const { sx, sy } = this.worldToScreen(bomb.x, bomb.y);
    const pulse = 10 + Math.sin(now / 150) * 3;

    ctx.save();
    if (bomb.state === "planted") {
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, pulse + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
      ctx.fill();
    } else if (bomb.state === "dropped") {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 6, sy - 6, 12, 12);
    }
    ctx.restore();
  }

  private drawDeathMarker(ctx: CanvasRenderingContext2D, d: DeathMarker, now: number): void {
    const age = (now - d.at) / DEATH_FADE_MS;
    const { sx, sy } = this.worldToScreen(d.x, d.y);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age) * 0.7;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 8);
    ctx.lineTo(sx + 8, sy + 8);
    ctx.moveTo(sx + 8, sy - 8);
    ctx.lineTo(sx - 8, sy + 8);
    ctx.stroke();
    ctx.restore();
  }

  private drawKillVector(ctx: CanvasRenderingContext2D, kv: KillVector, now: number): void {
    const age = (now - kv.at) / KILL_VECTOR_MS;
    const a = this.worldToScreen(kv.from.x, kv.from.y);
    const b = this.worldToScreen(kv.to.x, kv.to.y);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age) * 0.9;
    const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
    grad.addColorStop(0, "#facc15");
    grad.addColorStop(1, "#ef4444");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
    // seta na vítima
    const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.sx, b.sy);
    ctx.lineTo(b.sx - 12 * Math.cos(ang - 0.4), b.sy - 12 * Math.sin(ang - 0.4));
    ctx.lineTo(b.sx - 12 * Math.cos(ang + 0.4), b.sy - 12 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.restore();
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
