"use client";

import { useEffect, useState } from "react";

interface SystemStatus {
  cpu: number;
  gpu: number;
  uptime: string;
  latency: number;
}

interface MetricsData {
  processed: number;
  accuracy: number;
  tasks: number;
  queue: number;
  errors: number;
}

const MOCK_FILES = [
  { name: "inbox_processor.py",  done: true  },
  { name: "news_aggregator.ts",  done: true  },
  { name: "btc_monitor.go",      done: false },
  { name: "email_classifier.py", done: false },
  { name: "report_builder.ts",   done: false },
];

const MOCK_ACTIVITY_POOL = [
  "Email batch processed: 12 items",
  "BTC price updated: $64,230",
  "News feed synced: 45 articles",
  "Model inference: 142ms",
  "Backup completed successfully",
  "API health check: OK",
  "Cache warmed: 98% hit rate",
  "Task queue flushed: 3 items",
  "Auth token refreshed",
  "Disk scan complete: 0 errors",
  "GPU memory freed: 2.1GB",
  "NLP pipeline ready",
  "Security scan: no threats",
  "DB connection pool: 8/10",
  "Log rotation completed",
];

const MOCK_STATUS: SystemStatus = { cpu: 34, gpu: 67, uptime: "14d 6h 22m", latency: 142 };
const MOCK_METRICS: MetricsData = { processed: 1847, accuracy: 97.4, tasks: 12, queue: 3, errors: 0 };

export default function DataPanels() {
  const [activity, setActivity] = useState<string[]>(() =>
    MOCK_ACTIVITY_POOL.slice(0, 5),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const entry = MOCK_ACTIVITY_POOL[Math.floor(Math.random() * MOCK_ACTIVITY_POOL.length)];
      setActivity((prev) => [...prev.slice(-4), entry]);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {/* Üst orta — SYSTEM STATUS */}
      <div style={styles.panelTop}>
        <div style={styles.panelHeader}>▸ SYSTEM STATUS</div>
        <div style={styles.grid2}>
          <Stat label="CPU" value={`${MOCK_STATUS.cpu}%`} />
          <Stat label="GPU" value={`${MOCK_STATUS.gpu}%`} />
          <Stat label="UPTIME" value={MOCK_STATUS.uptime} />
          <Stat label="LATENCY" value={`${MOCK_STATUS.latency}ms`} />
        </div>
      </div>

      {/* Sol — ACTIVE FILES */}
      <div style={styles.panelLeft}>
        <div style={styles.panelHeader}>▸ ACTIVE FILES</div>
        <div style={styles.fileList}>
          {MOCK_FILES.map((f) => (
            <div key={f.name} style={styles.fileRow}>
              <span style={{ color: f.done ? "#06b6d4" : "#164e63", marginRight: 6 }}>
                {f.done ? "✓" : "○"}
              </span>
              <span style={{ opacity: f.done ? 0.9 : 0.5 }}>{f.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sağ — METRICS */}
      <div style={styles.panelRight}>
        <div style={styles.panelHeader}>▸ METRICS</div>
        <div style={styles.metricList}>
          <MetricRow label="PROCESSED" value={MOCK_METRICS.processed.toLocaleString("en-US")} />
          <MetricRow label="ACCURACY"  value={`${MOCK_METRICS.accuracy}%`} />
          <MetricRow label="TASKS"     value={String(MOCK_METRICS.tasks)} />
          <MetricRow label="QUEUE"     value={String(MOCK_METRICS.queue)} />
          <MetricRow label="ERRORS"    value={String(MOCK_METRICS.errors)} accent={MOCK_METRICS.errors > 0} />
        </div>
      </div>

      {/* Alt orta — ACTIVITY STREAM */}
      <div style={styles.panelBottom}>
        <div style={styles.panelHeader}>▸ ACTIVITY STREAM</div>
        <div style={styles.activityList}>
          {activity.map((entry, i) => (
            <div key={i} style={{ ...styles.activityRow, opacity: 0.4 + i * 0.15 }}>
              <span style={{ color: "#0891b2", marginRight: 6 }}>›</span>
              {entry}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.statCell}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={styles.metricRow}>
      <span style={styles.metricLabel}>{label}</span>
      <span style={{ ...styles.metricValue, color: accent ? "#ff5533" : "#06b6d4" }}>{value}</span>
    </div>
  );
}

const BASE_PANEL: React.CSSProperties = {
  position: "fixed",
  zIndex: 20,
  background: "rgba(10, 15, 30, 0.70)",
  border: "1px solid rgba(6, 182, 212, 0.3)",
  borderRadius: 8,
  backdropFilter: "blur(6px)",
  padding: "10px 14px",
  fontFamily: '"Courier New", monospace',
  fontSize: 11,
  color: "#06b6d4",
  letterSpacing: "0.08em",
  boxShadow: "0 0 18px rgba(6, 182, 212, 0.08)",
  userSelect: "none",
};

const styles: Record<string, React.CSSProperties> = {
  panelTop: {
    ...BASE_PANEL,
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    width: 320,
  },
  panelLeft: {
    ...BASE_PANEL,
    top: "50%",
    left: 20,
    transform: "translateY(-50%)",
    width: 200,
  },
  panelRight: {
    ...BASE_PANEL,
    top: "50%",
    right: 20,
    transform: "translateY(-50%)",
    width: 190,
  },
  panelBottom: {
    ...BASE_PANEL,
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    width: 340,
  },
  panelHeader: {
    fontSize: 10,
    letterSpacing: "0.25em",
    opacity: 0.6,
    marginBottom: 8,
    borderBottom: "1px solid rgba(6, 182, 212, 0.15)",
    paddingBottom: 4,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "6px 12px",
  },
  statCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statLabel: {
    fontSize: 9,
    opacity: 0.5,
    letterSpacing: "0.15em",
  },
  statValue: {
    fontSize: 13,
    fontWeight: "bold",
    textShadow: "0 0 8px rgba(6, 182, 212, 0.6)",
  },
  fileList: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    fontSize: 10,
    letterSpacing: "0.04em",
  },
  metricList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metricLabel: {
    opacity: 0.5,
    fontSize: 10,
    letterSpacing: "0.12em",
  },
  metricValue: {
    fontWeight: "bold",
    textShadow: "0 0 6px rgba(6, 182, 212, 0.5)",
  },
  activityList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  activityRow: {
    fontSize: 10,
    letterSpacing: "0.04em",
    lineHeight: 1.5,
    transition: "opacity 0.5s ease",
  },
};
