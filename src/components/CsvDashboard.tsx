import { useEffect, useMemo, useState } from "react";
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
    },
    images: [
      {
        source: "/C_Logo_White.png",
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
  const { rows, error } = useCsv("/test_data_cursor.csv");
  if (error)
    return <div style={{ padding: 16 }}>Failed to load CSV: {error}</div>;
  if (!rows) return <div style={{ padding: 16 }}>Loading…</div>;

  const x = rows.map((r) => parseDayMonthYear(r.date));
  const price = rows.map((r) => r.PriceUSD);
  const latestDate = x.length ? x[x.length - 1] : new Date();
  const since2022: [Date, Date] = [new Date("2022-01-01"), latestDate];
  const lastYear: [Date, Date] = [new Date("2024-01-01"), latestDate];
  const [selectedRange, setSelectedRange] = useState<[Date, Date]>(since2022);

  return (
    <div className="wrap">
      <div className="zoom-heading" style={{ gridColumn: "1 / -1", textAlign: "center" }}>Zoom settings</div>
      <div className="zoom-controls" style={{ gridColumn: "1 / -1" }}>
        <button className="zoom-btn" onClick={(e) => {
          document.querySelectorAll('.zoom-btn').forEach(b=>b.classList.remove('active'));
          (e.currentTarget as HTMLButtonElement).classList.add('active');
          setSelectedRange(since2022);
        }}>Since 2022</button>
        <button className="zoom-btn" onClick={(e) => {
          document.querySelectorAll('.zoom-btn').forEach(b=>b.classList.remove('active'));
          (e.currentTarget as HTMLButtonElement).classList.add('active');
          setSelectedRange(lastYear);
        }}>Last Year</button>
      </div>
      <ChartCard
        title="SOPR_STH"
        x={x}
        price={price}
        metric={rows.map((r) => r.SOPR_STH)}
        metricName="SOPR_STH"
        kind="line"
        baseline={1}
        xRange={selectedRange}
        metricColor={colorSopr}
      />
      <ChartCard
        title="RealizedProfit"
        x={x}
        price={price}
        metric={rows.map((r) => r.RealizedProfit)}
        metricName="RealizedProfit"
        kind="bar"
        xRange={selectedRange}
        metricColor={colorProfit}
      />
      <ChartCard
        title="MVRV_STH"
        x={x}
        price={price}
        metric={rows.map((r) => r.MVRV_STH)}
        metricName="MVRV_STH"
        kind="line"
        baseline={1}
        y2Range={[0.5, 2.5]}
        xRange={selectedRange}
        metricColor={colorMvrv}
      />
      <ChartCard
        title="RealizedCap"
        x={x}
        price={price}
        metric={rows.map((r) => r.RealizedCap)}
        metricName="RealizedCap"
        kind="area"
        xRange={selectedRange}
        metricColor={colorCapStroke}
        areaFillColor={colorCapFill}
      />
      <ChartCard
        title="RealizedPrice_STH"
        x={x}
        price={price}
        metric={rows.map((r) => r.RealizedPrice_STH)}
        metricName="RealizedPrice_STH"
        kind="line"
        xRange={selectedRange}
        metricColor={colorRPrice}
      />
    </div>
  );
}
