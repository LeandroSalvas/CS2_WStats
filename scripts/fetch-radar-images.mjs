#!/usr/bin/env node
/**
 * Baixa imagens de radar do CS2 e gera o mapRegistry.json com os parâmetros
 * oficiais de projeção (pos_x/pos_y/scale) extraídos dos overviews.
 *
 * Fonte: github.com/2mlml/cs2-radar-images (dump dos radars do jogo).
 *
 * Uso: node scripts/fetch-radar-images.mjs
 * Saída: app/web/public/maps/{mapa}.png + app/web/public/maps/mapRegistry.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://raw.githubusercontent.com/2mlml/cs2-radar-images/master";
const MAPS = [
  "de_dust2",
  "de_mirage",
  "de_inferno",
  "de_nuke",
  "de_overpass",
  "de_train",
  "de_vertigo",
  "de_ancient",
  "de_anubis",
  "de_cache",
  "cs_office",
  "cs_italy",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../app/web/public/maps");

await mkdir(outDir, { recursive: true });

const registry = {};
let okPngs = 0;
let okTxt = 0;

for (const map of MAPS) {
  try {
    const pngRes = await fetch(`${REPO}/${map}.png`);
    if (pngRes.ok) {
      const buf = Buffer.from(await pngRes.arrayBuffer());
      await writeFile(path.join(outDir, `${map}.png`), buf);
      okPngs++;
    } else {
      console.warn(`png ${map}: HTTP ${pngRes.status}`);
    }
  } catch (e) {
    console.warn(`png ${map}: ${e.message}`);
  }

  try {
    const txtRes = await fetch(`${REPO}/${map}.txt`);
    if (txtRes.ok) {
      const txt = await txtRes.text();
      const posX = txt.match(/"pos_x"\s+"(-?\d+(?:\.\d+)?)"/)?.[1];
      const posY = txt.match(/"pos_y"\s+"(-?\d+(?:\.\d+)?)"/)?.[1];
      const scale = txt.match(/"scale"\s+"(-?\d+(?:\.\d+)?)"/)?.[1];
      if (posX && posY && scale) {
        registry[map] = { posX: Number(posX), posY: Number(posY), scale: Number(scale) };
        okTxt++;
      } else {
        console.warn(`txt ${map}: parâmetros não encontrados`);
      }
    }
  } catch (e) {
    console.warn(`txt ${map}: ${e.message}`);
  }
}

await writeFile(
  path.join(outDir, "mapRegistry.json"),
  `${JSON.stringify(registry, null, 2)}\n`,
);
console.log(`OK: ${okPngs} PNGs baixados, ${okTxt} entradas de projeção -> ${outDir}`);
