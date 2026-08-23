"use client";

interface TransformPanelProps {
  selectedCount: number;
  onDelete?: () => void;
  onFocusSelected?: () => void;
}

export function TransformPanel({
  selectedCount,
  onDelete,
  onFocusSelected,
}: TransformPanelProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="hud-panel" style={{ top: 24, right: 24, minWidth: 200 }}>
      <div className="hud-panel-title">SEÇİLİ</div>
      <div className="hud-panel-value accent" style={{ marginTop: 8, fontSize: 15 }}>
        {selectedCount} MODEL{selectedCount > 1 ? "" : ""}
      </div>

      <div className="hud-panel-actions">
        <button type="button" className="hud-panel-btn" onClick={onFocusSelected}>
          ODAKLAN
        </button>
        <button type="button" className="hud-panel-btn danger" onClick={onDelete}>
          SİL
        </button>
      </div>

      <div className="hud-hint-lines">
        <div><span className="key">SERBEST EL</span> döndür</div>
        <div><span className="key">1-PINCH</span> sürükle</div>
        <div><span className="key">2-PINCH</span> zoom</div>
      </div>
    </div>
  );
}
