"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 640,
  maxWidth: "92vw",
  background: "rgba(0, 8, 16, 0.92)",
  border: "1px solid rgba(6, 182, 212, 0.4)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 12,
  letterSpacing: "0.05em",
  padding: 16,
  zIndex: 100,
};

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(6, 182, 212, 0.5)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 10,
  letterSpacing: "0.1em",
  padding: "3px 8px",
  cursor: "pointer",
};

interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  boundingBox: [number, number, number, number];
}

interface MapViewProps {
  onSpeak?: (text: string) => void;
  onLog?: (msg: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export interface MapViewHandle {
  showCity: (city: string) => void;
  cancel: () => void;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { onSpeak, onLog, onOpenChange },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Panel açıldığında Leaflet haritasını oluştur, kapandığında yok et
  useEffect(() => {
    if (!open || !mapContainerRef.current || mapRef.current) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      // Bundler altında varsayılan marker ikon yolları kırılıyor — CDN'den yükle
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapContainerRef.current).setView([41.015, 28.979], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap katkıda bulunanlar",
      }).addTo(map);
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [open]);

  async function showCity(city: string) {
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/services/geocode?q=${encodeURIComponent(city)}`);
      const data = (await res.json()) as Partial<GeocodeResult> & { error?: string };
      if (data.error || data.lat == null || data.lon == null) {
        setError(`${city} bulunamadı.`);
        onSpeak?.(`${city} için harita bulamadım.`);
        return;
      }
      setDisplayName(data.displayName ?? city);
      onLog?.(`◈ ${data.displayName ?? city} haritası gösteriliyor.`);
      onSpeak?.(`${city} haritasını gösteriyorum.`);

      // Leaflet henüz hazır değilse hazır olana kadar bekle
      const L = await import("leaflet");
      let tries = 0;
      while (!mapRef.current && tries < 40) {
        await new Promise((r) => setTimeout(r, 50));
        tries++;
      }
      const map = mapRef.current;
      if (!map) return;
      const [south, north, west, east] = data.boundingBox as [number, number, number, number];
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [20, 20] },
      );
      L.marker([data.lat, data.lon]).addTo(map);
    } catch {
      setError("Harita yüklenemedi.");
      onSpeak?.(`${city} haritasını yükleyemedim.`);
    } finally {
      setLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({
    showCity(city: string) {
      void showCity(city);
    },
    cancel() {
      setOpen(false);
    },
  }));

  if (!open) return null;

  return (
    <div style={panelStyle} className="holo-enter">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          // HARİTA {displayName ? `— ${displayName}` : ""}
        </div>
        <button
          type="button"
          style={{ ...btnStyle, fontSize: 9, padding: "1px 6px" }}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6 }}>⟳ YÜKLENİYOR…</div>
      )}
      {error && (
        <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 6 }}>{error}</div>
      )}

      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: 420,
          border: "1px solid rgba(6,182,212,0.2)",
        }}
      />
    </div>
  );
});

export default MapView;
