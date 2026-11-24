import type { StyleSpecification } from "maplibre-gl";

/**
 * Base map. Defaults to CARTO's dark raster basemap built on OpenStreetMap
 * data (attribution shown on the map). Override with NEXT_PUBLIC_MAP_STYLE_URL
 * (a MapLibre style JSON) or NEXT_PUBLIC_MAP_TILE_URL (an XYZ raster template).
 */
export function baseStyle(): string | StyleSpecification {
  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (styleUrl) return styleUrl;
  const tiles = process.env.NEXT_PUBLIC_MAP_TILE_URL
    ? [process.env.NEXT_PUBLIC_MAP_TILE_URL]
    : ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`);
  return {
    version: 8,
    glyphs: process.env.NEXT_PUBLIC_MAP_GLYPHS_URL ?? "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      base: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution:
          process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b0f0e" } },
      { id: "base", type: "raster", source: "base", paint: { "raster-opacity": 0.9, "raster-saturation": -0.3 } },
    ],
  };
}

export function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return coords;
}
