import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import "../App.css";

type DataRow = {
  date: string;
  PriceUSD: number;
  SOPR_STH: number;
  RealizedProfit: number;
  MVRV_STH: number;
  RealizedCap: number;
  RealizedPrice_STH: number;
};

const cardColor = "#0b0c10";
const gridColor = "#1a1c21";
const textColor = "#e5e7eb";
// Match original HTML palette
const colorPrice = "#cfd5ff";
const colorSopr = "#34d399";
const colorProfit = "#60a5fa";
const colorMvrv = "#f59e0b";
const colorCapStroke = "#7dd3fc";
const colorCapFill = "rgba(125, 211, 252, .15)";
const colorRPrice = "#f472b6";

function parseCsv(text: string): DataRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = lines[0].split(",");
  const idx = (name: string) => headers.indexOf(name);
  const di = idx("date");
  const p = idx("PriceUSD");
  const s = idx("SOPR_STH");
  const rp = idx("RealizedProfit");
  const m = idx("MVRV_STH");
  const rc = idx("RealizedCap");
  const rs = idx("RealizedPrice_STH");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      date: cols[di],
      PriceUSD: Number(cols[p] || "0"),
      SOPR_STH: Number(cols[s] || "0"),
      RealizedProfit: Number(cols[rp] || "0"),
      MVRV_STH: Number(cols[m] || "0"),
      RealizedCap: Number(cols[rc] || "0"),
      RealizedPrice_STH: Number(cols[rs] || "0"),
    } as DataRow;
  });
}

// Parse DD/MM/YYYY into a safe Date (UTC noon to avoid DST shifts)
function parseDayMonthYear(dateStr: string): Date {
  // Expecting like "15/05/2022"
  const parts = dateStr.split("/").map((v) => parseInt(v, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    // Fallback to native Date parse if format unexpected
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  }
  const [dd, mm, yyyy] = parts;
  // Use UTC midday to ensure consistent rendering regardless of locale/timezone
  return new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1, 12, 0, 0));
}

function useCsv(url: string) {
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseCsv(text).filter((r) => r.date);
        if (!cancelled) setRows(parsed);
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { rows, error };
}

function formatLatest(val: number) {
  const v = Number.isFinite(val) ? val : 0;
  return v.toFixed(2);
}

type ChartCardProps = {
  title: string;
  x: Date[];
  price: number[];
  metric: number[];
  metricName: string;
  kind: "line" | "bar" | "area";
  baseline?: number; // for oscillators
  y2Range?: [number, number];
  xRange?: [Date, Date] | null;
  metricColor?: string;
  areaFillColor?: string;
};

function ChartCard({
  title,
  x,
  price,
  metric,
  metricName,
  kind,
  baseline,
  y2Range,
  xRange,
  metricColor,
  areaFillColor,
}: ChartCardProps) {
  const latest = metric.length ? metric[metric.length - 1] : 0;
  const lastTime = x.length ? x[x.length - 1] : new Date();
  const startDefault = useMemo(() => new Date("2023-01-01"), []);
  const endDefault = lastTime;

  // Calculate y2Range with 20% headroom for RealizedPrice_STH and RealizedCap
  const calculatedY2Range = useMemo(() => {
    if (metricName === "RealizedPrice_STH" || metricName === "RealizedCap") {
      const maxValue = Math.max(...metric.filter((v) => Number.isFinite(v)));
      const minValue = Math.min(...metric.filter((v) => Number.isFinite(v)));
      const range = maxValue - minValue;
      const headroom = range * 0.2; // 20% headroom
      return [minValue - headroom, maxValue + headroom] as [number, number];
    }
    return undefined;
  }, [metric, metricName]);

  const tracePrice: any = {
    x,
    y: price,
    name: "BTC",
    yaxis: "y",
    type: "scatter",
    mode: "lines",
    line: { color: colorPrice, width: 0.9 },
    hovertemplate: "%{y:.2f}<extra>BTC</extra>",
  };

  const traceMetricBase: any = {
    x,
    y: metric,
    name: metricName,
    yaxis: "y2",
  };
  let metricTrace: any;
  if (kind === "bar") {
    metricTrace = {
      ...traceMetricBase,
      type: "bar",
      marker: { color: metricColor || colorProfit },
    };
  } else if (kind === "area") {
    metricTrace = {
      ...traceMetricBase,
      type: "scatter",
      mode: "lines",
      fill: "tonexty",
      fillcolor: areaFillColor || colorCapFill,
      line: { color: metricColor || colorCapStroke, width: 1.4 },
    };
  } else {
    metricTrace = {
      ...traceMetricBase,
      type: "scatter",
      mode: "lines",
      line: { color: metricColor || colorSopr },
    };
  }

  const traces: any[] = [tracePrice, metricTrace];
  if (typeof baseline === "number") {
    traces.push({
      x,
      y: x.map(() => baseline),
      name: `${metricName} Base`,
      yaxis: "y2",
      type: "scatter",
      mode: "lines",
      line: { color: "#888", width: 1, dash: "dot" },
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  const layout: any = {
    paper_bgcolor: cardColor,
    plot_bgcolor: cardColor,
    font: { color: textColor },
    margin: { l: 64, r: 64, t: 28, b: 48 },
    xaxis: {
      range: xRange ?? [startDefault, endDefault],
      gridcolor: gridColor,
      zeroline: false,
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikethickness: 1,
    },
    yaxis: {
      title: "BTC Price ($)",
      type: "log",
      range: [Math.log10(5000), null],
      nticks: 2,
      showgrid: false,
      zeroline: false,
      tickformat: ",~s",
      tickprefix: "$",
      hoverformat: ",.2f",
    },
    yaxis2: {
      title: metricName,
      overlaying: "y",
      side: "right",
      gridcolor: gridColor,
      zeroline: false,
      ...(y2Range ? { range: y2Range } : {}),
      ...(calculatedY2Range ? { range: calculatedY2Range } : {}),
    },
    images: [
      {
        source: "./C_Logo_White.png",
        xref: "paper",
        yref: "paper",
        x: 0.5,
        y: 0.5,
        sizex: 0.35,
        sizey: 0.35,
        xanchor: "center",
        yanchor: "middle",
        opacity: 0.25,
        layer: "below",
      },
    ],
    showlegend: true,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18 },
    height: 420,
  };

  const config: any = {
    responsive: true,
    displaylogo: false,
    scrollZoom: false,
    dragmode: "pan",
    modeBarButtonsToRemove: [
      "toImage",
      "lasso2d",
      "select2d",
      "zoomIn2d",
      "zoomOut2d",
    ],
  };

  return (
    <div className="panel">
      <div className="title">{title}</div>
      <div className="latest-line">Latest Value: {formatLatest(latest)}</div>
      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: "100%", height: 420 }}
      />
    </div>
  );
}

export default function CsvDashboard() {
  const { rows, error } = useCsv("./test_data_cursor.csv");

  // Always compute derived data so hooks order is stable across renders
  const x = useMemo(
    () => (rows ? rows.map((r) => parseDayMonthYear(r.date)) : []),
    [rows]
  );
  const price = useMemo(
    () => (rows ? rows.map((r) => r.PriceUSD) : []),
    [rows]
  );
  const sopr = useMemo(() => (rows ? rows.map((r) => r.SOPR_STH) : []), [rows]);
  const realizedProfit = useMemo(
    () => (rows ? rows.map((r) => r.RealizedProfit) : []),
    [rows]
  );
  const mvrv = useMemo(() => (rows ? rows.map((r) => r.MVRV_STH) : []), [rows]);
  const realizedCap = useMemo(
    () => (rows ? rows.map((r) => r.RealizedCap) : []),
    [rows]
  );
  const realizedPriceSTH = useMemo(
    () => (rows ? rows.map((r) => r.RealizedPrice_STH) : []),
    [rows]
  );
  const latestDate = x.length ? x[x.length - 1] : new Date();
  const since2022 = useMemo(
    () => [new Date("2022-05-14"), latestDate] as [Date, Date],
    [latestDate]
  );
  const lastYear = useMemo(
    () => [new Date("2024-01-01"), latestDate] as [Date, Date],
    [latestDate]
  );
  const lastSixMonths = useMemo(
    () =>
      [
        new Date(latestDate.getTime() - 6 * 30 * 24 * 60 * 60 * 1000),
        latestDate,
      ] as [Date, Date],
    [latestDate]
  );
  const lastMonth = useMemo(
    () =>
      [
        new Date(latestDate.getTime() - 30 * 24 * 60 * 60 * 1000),
        latestDate,
      ] as [Date, Date],
    [latestDate]
  );
  const lastWeek = useMemo(
    () =>
      [
        new Date(latestDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        latestDate,
      ] as [Date, Date],
    [latestDate]
  );
  const [selectedRange, setSelectedRange] = useState<[Date, Date]>(since2022);
  // Keep selected range consistent once data loads/updates
  useEffect(() => {
    setSelectedRange(since2022);
  }, [since2022]);

  // Draggable ordering: keep only ids in state; data stays in derived chartDefs
  type ChartId = "sopr" | "profit" | "mvrv" | "rcap" | "rprice";
  const chartDefs: Record<
    ChartId,
    {
      id: ChartId;
      title: string;
      metric: number[];
      metricName: string;
      kind: "line" | "bar" | "area";
      baseline?: number;
      y2Range?: [number, number];
      metricColor?: string;
      areaFillColor?: string;
    }
  > = useMemo(
    () => ({
      sopr: {
        id: "sopr",
        title: "SOPR_STH",
        metric: sopr,
        metricName: "SOPR_STH",
        kind: "line",
        baseline: 1,
        metricColor: colorSopr,
      },
      profit: {
        id: "profit",
        title: "RealizedProfit",
        metric: realizedProfit,
        metricName: "RealizedProfit",
        kind: "bar",
        metricColor: colorProfit,
      },
      mvrv: {
        id: "mvrv",
        title: "MVRV_STH",
        metric: mvrv,
        metricName: "MVRV_STH",
        kind: "line",
        baseline: 1,
        y2Range: [0.5, 2.5],
        metricColor: colorMvrv,
      },
      rcap: {
        id: "rcap",
        title: "RealizedCap",
        metric: realizedCap,
        metricName: "RealizedCap",
        kind: "area",
        metricColor: colorCapStroke,
        areaFillColor: colorCapFill,
      },
      rprice: {
        id: "rprice",
        title: "RealizedPrice_STH",
        metric: realizedPriceSTH,
        metricName: "RealizedPrice_STH",
        kind: "line",
        metricColor: colorRPrice,
      },
    }),
    [sopr, realizedProfit, mvrv, realizedCap, realizedPriceSTH]
  );

  const ALL_IDS: ChartId[] = ["sopr", "profit", "mvrv", "rcap", "rprice"];
  const ORDER_KEY = "chart_order_v2";

  // Initialize from localStorage synchronously
  const [order, setOrder] = useState<ChartId[]>(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const isValidId = (v: any): v is ChartId =>
          ALL_IDS.includes(v as ChartId);
        const cleaned = Array.from(
          new Set(parsed.filter(isValidId))
        ) as ChartId[];
        if (cleaned.length >= 1) return cleaned; // accept subsets
      }
    } catch {}
    return ["sopr"]; // start with one chart by default
  });
  const dragSrc = useRef<ChartId | null>(null);
  const [pendingAdd, setPendingAdd] = useState<Record<number, ChartId | "">>(
    {}
  );
  const [editing, setEditing] = useState(false);
  const [listMode, setListMode] = useState(false);
  const [listHoverIdx, setListHoverIdx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia && window.matchMedia("(max-width: 640px)");
      const set = () => setIsMobile(!!mq.matches);
      if (mq && typeof mq.addEventListener === "function") {
        mq.addEventListener("change", set);
      }
      set();
      return () => {
        if (mq && typeof mq.removeEventListener === "function")
          mq.removeEventListener("change", set);
      };
    } catch {
      setIsMobile(false);
    }
  }, []);
  const [draftOrder, setDraftOrder] = useState<ChartId[] | null>(null);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {}
  }, [order]);

  const handleDragStart = (id: ChartId) => (e: React.DragEvent) => {
    if (!editing) return;
    dragSrc.current = id;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (id: ChartId) => (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    const src = dragSrc.current;
    if (!src || src === id) return;
    const newOrder = [...order];
    const from = newOrder.indexOf(src);
    const to = newOrder.indexOf(id);
    if (from === -1 || to === -1) return;
    newOrder.splice(to, 0, ...newOrder.splice(from, 1));
    setOrder(newOrder);
    dragSrc.current = null;
  };

  // Drop onto empty slot index
  const handleDropEmpty = (targetIdx: number) => (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    const src = dragSrc.current;
    if (!src) return;
    const newOrder = [...order];
    const from = newOrder.indexOf(src);
    if (from === -1) return;
    const to = Math.max(0, Math.min(targetIdx, newOrder.length - 1));
    newOrder.splice(to, 0, ...newOrder.splice(from, 1));
    setOrder(newOrder);
    dragSrc.current = null;
  };

  const removeAt = (idx: number) => {
    if (!editing) return;
    const next = order.filter((_, i) => i !== idx);
    setOrder(next);
  };
  const addAt = (idx: number, id: ChartId) => {
    if (!editing) return;
    if (!ALL_IDS.includes(id) || order.includes(id)) return;
    const next = [...order];
    next.splice(idx, 0, id);
    setOrder(next);
  };

  const beginEdit = () => {
    setDraftOrder([...order]);
    setEditing(true);
    // Default to list mode on small screens for better UX
    try {
      const isSmall =
        window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
      setListMode(!!isSmall);
    } catch {}
  };
  useEffect(() => {
    if (editing && isMobile) setListMode(true);
  }, [editing, isMobile]);
  const saveEdit = () => {
    setDraftOrder(null);
    setEditing(false);
    setListHoverIdx(null);
  };
  const cancelEdit = () => {
    if (draftOrder) setOrder(draftOrder);
    setDraftOrder(null);
    setEditing(false);
    setListHoverIdx(null);
  };

  const moveUp = (idx: number) => {
    if (!editing || idx <= 0) return;
    const next = [...order];
    const tmp = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = tmp;
    setOrder(next);
  };
  const moveDown = (idx: number) => {
    if (!editing || idx >= order.length - 1) return;
    const next = [...order];
    const tmp = next[idx + 1];
    next[idx + 1] = next[idx];
    next[idx] = tmp;
    setOrder(next);
  };

  // Drag & drop inside List Mode (mobile-friendly)
  const listDragIdx = useRef<number | null>(null);
  const handleListDragStart = (idx: number) => (e: React.DragEvent) => {
    if (!editing || !listMode) return;
    listDragIdx.current = idx;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleListDragOver = (e: React.DragEvent) => {
    if (!editing || !listMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleListDrop = (idx: number) => (e: React.DragEvent) => {
    if (!editing || !listMode) return;
    e.preventDefault();
    const from = listDragIdx.current;
    if (from == null || from === idx) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    setOrder(next);
    listDragIdx.current = null;
    setListHoverIdx(null);
  };
  const handleListDragEnter = (idx: number) => (e: React.DragEvent) => {
    if (!editing || !listMode) return;
    e.preventDefault();
    setListHoverIdx(idx);
  };
  const handleListDragLeave = (idx: number) => (e: React.DragEvent) => {
    if (!editing || !listMode) return;
    e.preventDefault();
    setListHoverIdx((cur) => (cur === idx ? null : cur));
  };

  if (error)
    return <div style={{ padding: 16 }}>Failed to load CSV: {error}</div>;
  if (!rows) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div className="wrap">
      <div
        className="zoom-heading"
        style={{ gridColumn: "1 / -1", textAlign: "center" }}
      >
        Zoom settings
      </div>
      <div className="zoom-controls" style={{ gridColumn: "1 / -1" }}>
        <button
          className="zoom-btn active"
          onClick={(e) => {
            document
              .querySelectorAll(".zoom-btn")
              .forEach((b) => b.classList.remove("active"));
            (e.currentTarget as HTMLButtonElement).classList.add("active");
            setSelectedRange(since2022);
          }}
        >
          Since 2022
        </button>
        <button
          className="zoom-btn"
          onClick={(e) => {
            document
              .querySelectorAll(".zoom-btn")
              .forEach((b) => b.classList.remove("active"));
            (e.currentTarget as HTMLButtonElement).classList.add("active");
            setSelectedRange(lastYear);
          }}
        >
          1Y
        </button>
        <button
          className="zoom-btn"
          onClick={(e) => {
            document
              .querySelectorAll(".zoom-btn")
              .forEach((b) => b.classList.remove("active"));
            (e.currentTarget as HTMLButtonElement).classList.add("active");
            setSelectedRange(lastSixMonths);
          }}
        >
          6M
        </button>
        <button
          className="zoom-btn"
          onClick={(e) => {
            document
              .querySelectorAll(".zoom-btn")
              .forEach((b) => b.classList.remove("active"));
            (e.currentTarget as HTMLButtonElement).classList.add("active");
            setSelectedRange(lastMonth);
          }}
        >
          1M
        </button>
        <button
          className="zoom-btn"
          onClick={(e) => {
            document
              .querySelectorAll(".zoom-btn")
              .forEach((b) => b.classList.remove("active"));
            (e.currentTarget as HTMLButtonElement).classList.add("active");
            setSelectedRange(lastWeek);
          }}
        >
          7D
        </button>
      </div>
      <div
        style={{
          gridColumn: "1 / -1",
          textAlign: "right",
          marginTop: -6,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        {!editing ? (
          <button className="zoom-btn" onClick={beginEdit}>
            Customise
          </button>
        ) : (
          <>
            <button className="zoom-btn" onClick={saveEdit}>
              Save
            </button>
            <button className="zoom-btn" onClick={cancelEdit}>
              Cancel
            </button>
            <button
              className={`zoom-btn ${listMode ? "active" : ""}`}
              onClick={() => setListMode((v) => !v)}
            >
              List Mode
            </button>
          </>
        )}
      </div>
      {editing && listMode && (
        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="title" style={{ marginBottom: 6 }}>
            Reorder charts
          </div>
          <div
            className="list-hint"
            style={{ color: "#9aa3af", fontSize: 12, margin: "0 6px 10px 6px" }}
          >
            ⇅ Drag rows to reorder (press and hold on mobile)
          </div>
          {order.map((id, idx) => (
            <div
              key={id}
              className="list-row"
              draggable
              onDragStartCapture={handleListDragStart(idx)}
              onDragOverCapture={handleListDragOver}
              onDrop={handleListDrop(idx)}
              onDragEnterCapture={handleListDragEnter(idx)}
              onDragLeaveCapture={handleListDragLeave(idx)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid #1a1c21",
                outline: listHoverIdx === idx ? "2px dashed #3d444d" : "none",
                outlineOffset: "-2px",
                cursor: "move",
              }}
            >
              <div
                draggable
                onDragStart={handleListDragStart(idx)}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span style={{ color: "#9aa3af", fontSize: 14 }}>☰</span>
                <span style={{ color: "#9aa3af", fontSize: 12 }}>
                  #{idx + 1}
                </span>
                <span>{chartDefs[id].title}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  draggable={false}
                  className="remove-btn"
                  onClick={() => removeAt(idx)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {order.length < ALL_IDS.length && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <select
                className="add-select"
                onChange={(e) => addAt(order.length, e.target.value as ChartId)}
                value=""
              >
                <option value="" disabled>
                  Add chart…
                </option>
                {ALL_IDS.filter((cid) => !order.includes(cid)).map((cid) => (
                  <option key={cid} value={cid}>
                    {chartDefs[cid].title}
                  </option>
                ))}
              </select>
              <span style={{ color: "#9aa3af", fontSize: 12 }}>
                Tip: Drag rows above to change order
              </span>
            </div>
          )}
        </div>
      )}
      {editing && !listMode
        ? Array.from({ length: ALL_IDS.length }).map((_, slotIdx) => {
            const id = order[slotIdx];
            const remaining = ALL_IDS.filter((cid) => !order.includes(cid));
            if (id) {
              const c = chartDefs[id];
              return (
                <div
                  key={id}
                  className="draggable-card"
                  draggable
                  onDragStart={handleDragStart(id)}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(id)}
                  style={{ cursor: "move" }}
                  title="Drag to reorder"
                >
                  <div className="drag-hint">⇅ Drag to reorder</div>
                  <div className="slot-actions">
                    <button
                      className="remove-btn"
                      onClick={() => removeAt(slotIdx)}
                    >
                      Remove
                    </button>
                  </div>
                  <ChartCard
                    title={c.title}
                    x={x}
                    price={price}
                    metric={c.metric}
                    metricName={c.metricName}
                    kind={c.kind}
                    baseline={c.baseline}
                    y2Range={c.y2Range}
                    xRange={selectedRange}
                    metricColor={c.metricColor}
                    areaFillColor={c.areaFillColor}
                  />
                </div>
              );
            }
            const sel = (pendingAdd[slotIdx] || remaining[0] || "") as
              | ChartId
              | "";
            return (
              <div
                key={"empty-" + slotIdx}
                className="panel slot-empty"
                onDragOver={handleDragOver}
                onDrop={handleDropEmpty(slotIdx)}
              >
                <div className="title">Add a chart</div>
                <div className="slot-actions">
                  <select
                    className="add-select"
                    value={sel as any}
                    onChange={(e) =>
                      setPendingAdd({
                        ...pendingAdd,
                        [slotIdx]: e.target.value as ChartId,
                      })
                    }
                  >
                    {remaining.length === 0 ? (
                      <option value="">No charts available</option>
                    ) : (
                      remaining.map((cid) => (
                        <option key={cid} value={cid}>
                          {chartDefs[cid].title}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    className="add-btn"
                    disabled={!remaining.length || !sel}
                    onClick={() => sel && addAt(slotIdx, sel as ChartId)}
                  >
                    Add chart
                  </button>
                </div>
              </div>
            );
          })
        : !editing &&
          order.map((id) => {
            const c = chartDefs[id];
            return (
              <div key={id}>
                <ChartCard
                  title={c.title}
                  x={x}
                  price={price}
                  metric={c.metric}
                  metricName={c.metricName}
                  kind={c.kind}
                  baseline={c.baseline}
                  y2Range={c.y2Range}
                  xRange={selectedRange}
                  metricColor={c.metricColor}
                  areaFillColor={c.areaFillColor}
                />
              </div>
            );
          })}
    </div>
  );
}
