import { BASE } from "../base";

/**
 * Parâmetros de projeção dos mapas (estilo resource/overviews do CS).
 *
 *   imgX = (worldX - posX) / scale
 *   imgY = (posY - worldY) / scale      // eixo Y invertido na imagem
 *
 * Valores aproximados para os mapas competitivos padrão.
 * Para calibrar ou adicionar mapas, crie `public/maps/mapRegistry.json`
 * no mesmo formato — ele sobrepõe estes defaults em runtime.
 */
export interface MapOverview {
  posX: number;
  posY: number;
  /** Unidades de mundo por pixel da imagem do radar. */
  scale: number;
}

const DEFAULTS: Record<string, MapOverview> = {
  de_dust2: { posX: -2296, posY: 1856, scale: 4.8 },
  de_mirage: { posX: -1984, posY: 1648, scale: 5 },
  de_inferno: { posX: -2081, posY: 3200, scale: 4.4 },
  de_nuke: { posX: -3376, posY: 2312, scale: 5.8 },
  de_overpass: { posX: -3968, posY: 1024, scale: 5.2 },
  de_train: { posX: -2496, posY: 1952, scale: 3.5 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 5 },
  de_ancient: { posX: -2952, posY: 2262, scale: 5 },
  de_anubis: { posX: -2256, posY: 2576, scale: 5 },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5 },
};

let overridesPromise: Promise<Record<string, MapOverview>> | null = null;

function loadOverrides(): Promise<Record<string, MapOverview>> {
  if (!overridesPromise) {
    overridesPromise = fetch(`${BASE}maps/mapRegistry.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return overridesPromise;
}

export async function getOverview(mapName: string): Promise<MapOverview> {
  const overrides = await loadOverrides();
  return overrides[mapName] ?? DEFAULTS[mapName] ?? autoFallback(mapName);
}

/** Mapa desconhecido: projeta em torno da média das posições com escala fixa. */
function autoFallback(_mapName: string): MapOverview {
  return { posX: -2500, posY: 2500, scale: 5 };
}

/** Caminho da imagem do radar; o usuário pode soltar PNGs em web/public/maps/. */
export function mapImageUrl(mapName: string | null): string | null {
  if (!mapName) return null;
  const clean = mapName.trim().toLowerCase();
  return `${BASE}maps/${clean}.png`;
}
