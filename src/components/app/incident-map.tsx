"use client";

import * as React from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { cn } from "@/lib/client/utils";
import { baseStyle, circlePolygon } from "./map-style";

export interface MapReport {
  id: string;
  reference: string;
  title: string;
  category: string;
  latitude: number;
  longitude: number;
  severity: string | null;
  verification_status: string;
  investigation_status: string;
  location_precision: string;
  cluster_id: string | null;
  is_synthetic: boolean;
}

export interface MapCluster {
  id: string;
  reference: string;
  title: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  report_count: number;
}

interface Props {
  reports: MapReport[];
  clusters: MapCluster[];
  selectedId?: string | null;
  selectedClusterId?: string | null;
  onSelectReport?: (id: string) => void;
  onSelectCluster?: (id: string) => void;
  showHeat?: boolean;
  className?: string;
  /** Extra left padding when auto-fitting (e.g. for an overlay panel). */
  fitPaddingLeft?: number;
}

function reportsGeoJSON(reports: MapReport[]) {
  return {
    type: "FeatureCollection" as const,
    features: reports.map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [Number(r.longitude), Number(r.latitude)] },
      properties: {
        id: r.id,
        reference: r.reference,
        title: r.title,
        severity: r.severity ?? "NONE",
        verification: r.verification_status,
        approx: r.location_precision === "approximate",
        weight: r.severity === "CRITICAL" ? 4 : r.severity === "HIGH" ? 3 : r.severity === "MODERATE" ? 2 : 1,
      },
    })),
  };
}

function clustersGeoJSON(clusters: MapCluster[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [circlePolygon(Number(c.longitude), Number(c.latitude), Math.max(Number(c.radius_m), 300) * 1.15)] },
      properties: { id: c.id, reference: c.reference, title: c.title, count: c.report_count },
    })),
  };
}

const SEVERITY_EXPR = [
  "match",
  ["get", "severity"],
  "CRITICAL", "#ff5a4e",
  "HIGH", "#e06b5f",
  "MODERATE", "#d9a441",
  "LOW", "#7fa38f",
  "#8fb3c9",
] as unknown as ExpressionSpecification;

export function IncidentMap({ reports, clusters, selectedId, selectedClusterId, onSelectReport, onSelectCluster, showHeat, className, fitPaddingLeft = 60 }: Props) {
  const container = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MlMap | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const handlers = React.useRef({ onSelectReport, onSelectCluster });
  React.useEffect(() => {
    handlers.current = { onSelectReport, onSelectCluster };
  });
  const fitted = React.useRef(false);

  React.useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
      maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
        if (disposed || !container.current) return;
        const map = new maplibre.Map({
          container: container.current,
          style: baseStyle(),
          center: [3.9, 7.4],
          zoom: 2,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
        map.on("load", () => {
          map.addSource("clusters", { type: "geojson", data: clustersGeoJSON([]) });
          map.addLayer({ id: "cluster-fill", type: "fill", source: "clusters", paint: { "fill-color": "#9bcb8b", "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.16, 0.07] } });
          map.addLayer({ id: "cluster-line", type: "line", source: "clusters", paint: { "line-color": "#9bcb8b", "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.8 } });

          map.addSource("reports", { type: "geojson", data: reportsGeoJSON([]), cluster: true, clusterRadius: 42, clusterMaxZoom: 11 });
          map.addLayer({
            id: "heat",
            type: "heatmap",
            source: "reports",
            maxzoom: 9,
            layout: { visibility: "none" },
            paint: {
              "heatmap-weight": ["coalesce", ["get", "weight"], 1],
              "heatmap-intensity": 1,
              "heatmap-radius": 28,
              "heatmap-opacity": 0.65,
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.3, "#2c4a33", 0.6, "#d9a441", 1, "#e06b5f"],
            },
          });
          map.addLayer({
            id: "point-clusters",
            type: "circle",
            source: "reports",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#151d19",
              "circle-stroke-color": "#9bcb8b",
              "circle-stroke-width": 1.5,
              "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 20, 24],
            },
          });
          map.addLayer({
            id: "point-cluster-count",
            type: "symbol",
            source: "reports",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": [process.env.NEXT_PUBLIC_MAP_FONT ?? "Noto Sans Bold"] },
            paint: { "text-color": "#e8eee9" },
          });
          map.addLayer({
            id: "points-halo",
            type: "circle",
            source: "reports",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "approx"], true]],
            paint: { "circle-radius": 14, "circle-color": SEVERITY_EXPR, "circle-opacity": 0.12, "circle-stroke-width": 1, "circle-stroke-color": SEVERITY_EXPR, "circle-stroke-opacity": 0.4 },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "reports",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 9, 6],
              "circle-color": SEVERITY_EXPR,
              "circle-stroke-width": ["match", ["get", "verification"], "verified", 2.5, "corroborated", 2, 1],
              "circle-stroke-color": ["match", ["get", "verification"], "verified", "#9bcb8b", "corroborated", "#8fb3c9", "disputed", "#d9a441", "#0b0f0e"],
            },
          });

          map.on("click", "points", (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) handlers.current.onSelectReport?.(String(id));
          });
          map.on("click", "point-clusters", async (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const src = map.getSource("reports") as GeoJSONSource;
            const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id);
            map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
          map.on("click", "cluster-fill", (e) => {
            const hitPoint = map.queryRenderedFeatures(e.point, { layers: ["points", "point-clusters"] }).length > 0;
            const id = e.features?.[0]?.properties?.id;
            if (!hitPoint && id) handlers.current.onSelectCluster?.(String(id));
          });
          for (const layer of ["points", "point-clusters", "cluster-fill"]) {
            map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          }
          setReady(true);
        });
        map.on("error", (e) => {
          if (String(e?.error?.message ?? "").includes("Failed to fetch")) setError("Map tiles could not be loaded. Incident data is still shown.");
        });
      } catch (err) {
        setError(`Map failed to initialise: ${(err as Error).message}`);
      }
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Data updates
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("reports") as GeoJSONSource).setData(reportsGeoJSON(reports));
    (map.getSource("clusters") as GeoJSONSource).setData(clustersGeoJSON(clusters));
    if (!fitted.current && reports.length) {
      fitted.current = true;
      const lngs = reports.map((r) => Number(r.longitude));
      const lats = reports.map((r) => Number(r.latitude));
      const wide = (container.current?.clientWidth ?? 0) > 900;
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: { top: 60, bottom: 60, right: wide ? 80 : 40, left: wide ? fitPaddingLeft : 40 },
        maxZoom: 12,
        duration: 0,
      });
    }
  }, [ready, reports, clusters, fitPaddingLeft]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("heat", "visibility", showHeat ? "visible" : "none");
  }, [ready, showHeat]);

  // Fly to the selected report / cluster
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const r = reports.find((x) => x.id === selectedId);
    if (r) map.flyTo({ center: [Number(r.longitude), Number(r.latitude)], zoom: Math.max(map.getZoom(), 12.5), duration: 700 });
  }, [ready, selectedId, reports]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const c = clusters.find((x) => x.id === selectedClusterId);
    if (c) map.flyTo({ center: [Number(c.longitude), Number(c.latitude)], zoom: 12, duration: 700 });
  }, [ready, selectedClusterId, clusters]);

  return (
    <div className={cn("relative", className)}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} data-testid="incident-map" />
      {error && <div className="absolute bottom-8 left-1/2 z-[5] -translate-x-1/2 whitespace-nowrap rounded border border-warn/40 bg-panel/95 px-3 py-1.5 text-[11px] text-warn">{error}</div>}
    </div>
  );
}
