"use client";

interface EditModeUIProps {
  selectedCount: number;
  modelCount: number;
  hoveredModelName?: string;
}

export function EditModeUI({
  selectedCount,
  modelCount,
  hoveredModelName,
}: EditModeUIProps) {
  return (
    <div className="hud-panel" style={{ top: 90, left: 24 }}>
      <div className="hud-panel-title">EDIT MODE</div>
      <div style={{ marginTop: 10, display: "flex", gap: 20 }}>
        <div>
          <div className="hud-panel-value">{modelCount}</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>MODELS</div>
        </div>
        <div>
          <div className="hud-panel-value accent">{selectedCount}</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>SEÇİLİ</div>
        </div>
      </div>
      {hoveredModelName && (
        <div style={{ marginTop: 8, color: "#fbbf24", fontSize: 11 }}>
          {hoveredModelName}
        </div>
      )}
      <div className="hud-hint-lines">
        <div><span className="key">SERBEST EL</span> döndür</div>
        <div><span className="key">1-PINCH</span> sürükle</div>
        <div><span className="key">2-PINCH</span> zoom</div>
        <div><span className="key">3-FINGER</span> eğim</div>
        <div><span className="key">TIKLA</span> seç</div>
      </div>
    </div>
  );
}
