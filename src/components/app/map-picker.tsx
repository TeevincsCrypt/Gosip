"use client";

import * as React from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { baseStyle } from "./map-style";

/** Click-to-place location picker for the reporting form. */
export function MapPicker({
  value,
  onChange,
  className,
}: {
  value: { latitude: number; longitude: number } | null;
  onChange: (v: { latitude: number; longitude: number }) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<MlMap | null>(null);
  const marker = React.useRef<Marker | null>(null);
  const lib = React.useRef<typeof import("maplibre-gl") | null>(null);
  const cb = React.useRef(onChange);
  React.useEffect(() => {
    cb.current = onChange;
  });

  React.useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
      if (disposed || !ref.current) return;
      lib.current = maplibre;
      const m = new maplibre.Map({ container: ref.current, style: baseStyle(), center: [3.9, 7.4], zoom: 3, attributionControl: { compact: true } });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      m.on("click", (e) => cb.current({ latitude: Number(e.lngLat.lat.toFixed(6)), longitude: Number(e.lngLat.lng.toFixed(6)) }));
      m.getCanvas().style.cursor = "crosshair";
      map.current = m;
    })();
    return () => {
      disposed = true;
      map.current?.remove();
    };
  }, []);

  React.useEffect(() => {
    const m = map.current;
    const maplibre = lib.current;
    if (!m || !maplibre) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const el = document.createElement("div");
      el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#9bcb8b;border:3px solid #0b0f0e;box-shadow:0 0 0 2px #9bcb8b";
      marker.current = new maplibre.Marker({ element: el }).setLngLat([value.longitude, value.latitude]).addTo(m);
    } else marker.current.setLngLat([value.longitude, value.latitude]);
    if (!m.getBounds().contains([value.longitude, value.latitude]) || m.getZoom() < 10) {
      m.flyTo({ center: [value.longitude, value.latitude], zoom: Math.max(m.getZoom(), 13), duration: 600 });
    }
  }, [value]);

  return <div ref={ref} className={className} data-testid="map-picker" />;
}
