import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ChangeEvent } from "react";
import Plot from "react-plotly.js";
import "./App.css";

type AnyObject = Record<string, unknown>;

type ChartSpec = {
  id: string;
  label: string;
  path: string;
};

const CHARTS: ChartSpec[] = [
  {
    id: "realisedcap",
    label: "Realised Cap",
    path: "/pricing_realisedcap_dark.json",
  },
  {
    id: "sopr_sth",
    label: "SOPR STH Z-Score",
    path: "/sopr_sth_zscore_dark.json",
  },
  {
    id: "topmodels",
    label: "Top Models",
    path: "/topmodels_dark.json",
  },
];

type AxisZoom = {
  range?: [unknown, unknown];
  autorange?: boolean;
};

type SavedZoom = {
  [axisName: string]: AxisZoom;
};

function extractZoomFromRelayoutEvent(eventObj: AnyObject): SavedZoom {
  const result: SavedZoom = {};
  for (const [key, value] of Object.entries(eventObj)) {
    // Pattern: xaxis.range[0] / xaxis.range[1] or yaxis.range[0] / yaxis.range[1]
    const rangeIndexMatch = key.match(/^([xy]axis\d*)\.range\[(0|1)\]$/);
    if (rangeIndexMatch) {
      const axisName = rangeIndexMatch[1];
      const index = Number(rangeIndexMatch[2]);
      const axis = (result[axisName] = result[axisName] || {});
      const currentRange = (axis.range as [unknown, unknown] | undefined) ?? [
        undefined,
        undefined,
      ];
      currentRange[index] = value as unknown; // keep strings for date axes
      axis.range = currentRange as [unknown, unknown];
      axis.autorange = false;
      continue;
    }
    // Pattern: xaxis.range: [start, end] or yaxis.range: [start, end]
    const rangeArrayMatch = key.match(/^([xy]axis\d*)\.range$/);
    if (
      rangeArrayMatch &&
      Array.isArray(value) &&
      (value as unknown[]).length === 2
    ) {
      const axisName = rangeArrayMatch[1];
      const axis = (result[axisName] = result[axisName] || {});
      const arr = value as unknown[];
      axis.range = [arr[0], arr[1]] as [unknown, unknown];
      axis.autorange = false;
      continue;
    }
    // Pattern: xaxis.autorange or yaxis.autorange
    const autorangeMatch = key.match(/^([xy]axis\d*)\.autorange$/);
    if (autorangeMatch) {
      const axisName = autorangeMatch[1];
      const axis = (result[axisName] = result[axisName] || {});
      axis.autorange = Boolean(value);
    }
  }
  return result;
}

function computeXExtent(
  traces: AnyObject[] | null
): [string, string] | undefined {
  if (!traces) return undefined;
  let minMs: number | undefined;
  let maxMs: number | undefined;
  for (const t of traces) {
    const xs = (t as AnyObject)["x"] as unknown[] | undefined;
    if (!Array.isArray(xs)) continue;
    for (const v of xs) {
      let ms: number | undefined;
      if (typeof v === "number") {
        ms = v;
      } else if (typeof v === "string") {
        const parsed = Date.parse(v);
        if (!Number.isNaN(parsed)) ms = parsed;
      }
      if (typeof ms === "number") {
        if (minMs === undefined || ms < minMs) minMs = ms;
        if (maxMs === undefined || ms > maxMs) maxMs = ms;
      }
    }
  }
  if (minMs === undefined || maxMs === undefined) return undefined;
  return [new Date(minMs).toISOString(), new Date(maxMs).toISOString()];
}

function isPlotlyBundle(json: AnyObject): json is {
  data: AnyObject[];
  layout?: AnyObject;
  config?: AnyObject;
} {
  return Array.isArray((json as AnyObject).data);
}

function App() {
  const [data, setData] = useState<AnyObject[] | null>(null);
  const [layout, setLayout] = useState<AnyObject | undefined>();
  const [config, setConfig] = useState<AnyObject | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [selectedChartId, setSelectedChartId] = useState<string>(CHARTS[0].id);

  // In-memory zoom storage per chart
  const [savedZooms, setSavedZooms] = useState<
    Record<
      string,
      {
        xaxis?: { range?: [any, any]; autorange?: boolean };
        yaxis?: {
          range?: [any, any];
          autorange?: boolean;
          domain?: [number, number];
          position?: number;
          side?: string;
          anchor?: string;
          overlaying?: string;
          type?: string;
        };
        yaxis2?: {
          range?: [any, any];
          autorange?: boolean;
          domain?: [number, number];
          position?: number;
          side?: string;
          anchor?: string;
          overlaying?: string;
          type?: string;
        };
        yaxis3?: {
          range?: [any, any];
          autorange?: boolean;
          domain?: [number, number];
          position?: number;
          side?: string;
          anchor?: string;
          overlaying?: string;
          type?: string;
        };
        yaxis4?: {
          range?: [any, any];
          autorange?: boolean;
          domain?: [number, number];
          position?: number;
          side?: string;
          anchor?: string;
          overlaying?: string;
          type?: string;
        };
        traceVisibility?: Array<boolean | "legendonly">;
      }
    >
  >({});

  const suppressRelayoutSavesRef = useRef<number>(0);
  const graphDivRef = useRef<any>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);

  // Removed unused xRangeState to satisfy strict noUnusedLocals

  // Drawing state
  type YAxisName = "yaxis" | "yaxis2" | "yaxis3" | "yaxis4";
  type DrawingLine = {
    id: string;
    x0: any;
    y0: any;
    x1: any;
    y1: any;
    yAxisName: YAxisName;
    color: string;
    width: number;
  };
  const [drawingMode, setDrawingMode] = useState<"off" | "line">("off");
  const [selectedYAxisForDraw, setSelectedYAxisForDraw] =
    useState<YAxisName>("yaxis");
  const [activeLine, setActiveLine] = useState<DrawingLine | null>(null);
  const [drawingsByChart, setDrawingsByChart] = useState<
    Record<string, DrawingLine[]>
  >({});

  const getAxisObjects = (yAxisName: YAxisName) => {
    const gd = graphDivRef.current as any;
    const fl = gd?._fullLayout as any;
    if (!fl) return null;
    const x = fl["xaxis"];
    const y = fl[yAxisName];
    if (!x || !y || typeof x.l2p !== "function" || typeof y.l2p !== "function")
      return null;
    return { x, y };
  };

  const pixelToData = (px: number, py: number, yAxisName: YAxisName) => {
    const axes = getAxisObjects(yAxisName);
    const gd = graphDivRef.current as HTMLElement | null;
    if (!axes || !gd) return null;
    const rect = gd.getBoundingClientRect();
    const pxLocal = px - rect.left;
    const pyLocal = py - rect.top;
    const xVal = axes.x.p2l(pxLocal - axes.x._offset);
    const yVal = axes.y.p2l(pyLocal - axes.y._offset);
    return { x: xVal, y: yVal };
  };

  const dataToPixel = (xVal: any, yVal: any, yAxisName: YAxisName) => {
    const axes = getAxisObjects(yAxisName);
    if (!axes) return null;
    const px = axes.x.l2p(xVal) + axes.x._offset;
    const py = axes.y.l2p(yVal) + axes.y._offset;
    return { px, py };
  };

  const startDrawing = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (drawingMode !== "line") return;
    const coords = pixelToData(e.clientX, e.clientY, selectedYAxisForDraw);
    if (!coords) return;
    const newLine: DrawingLine = {
      id: `line_${Date.now()}`,
      x0: coords.x,
      y0: coords.y,
      x1: coords.x,
      y1: coords.y,
      yAxisName: selectedYAxisForDraw,
      color: "#ffcc00",
      width: 2,
    };
    setActiveLine(newLine);
  };

  const moveDrawing = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!activeLine || drawingMode !== "line") return;
    const coords = pixelToData(e.clientX, e.clientY, activeLine.yAxisName);
    if (!coords) return;
    setActiveLine({ ...activeLine, x1: coords.x, y1: coords.y });
  };

  const endDrawing = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!activeLine || drawingMode !== "line") return;
    const coords = pixelToData(e.clientX, e.clientY, activeLine.yAxisName);
    if (!coords) {
      setActiveLine(null);
      return;
    }
    const finalized = { ...activeLine, x1: coords.x, y1: coords.y };
    setDrawingsByChart((prev: Record<string, DrawingLine[]>) => {
      const arr = prev[selectedChartId] ? [...prev[selectedChartId]] : [];
      arr.push(finalized);
      return { ...prev, [selectedChartId]: arr };
    });
    setActiveLine(null);
  };

  const performDefaultReset = () => {
    const gdLocal = graphDivRef.current;
    if (!gdLocal || !(window as any).Plotly) return;
    const extent = computeXExtent(data);
    const startIso = new Date("2016-01-01T00:00:00Z").toISOString();
    const endIso = extent ? extent[1] : new Date().toISOString();
    // Run after Plotly's built-in doubleclick autorange so our range wins
    setTimeout(() => {
      (window as any).Plotly.relayout(gdLocal, {
        "xaxis.range": [startIso, endIso],
        "xaxis.autorange": false,
        "yaxis.autorange": true,
      });
    }, 0);
  };

  const selectedChart = useMemo(
    () => CHARTS.find((c) => c.id === selectedChartId)!,
    [selectedChartId]
  );

  // Function to save current zoom settings
  const saveCurrentZoom = useCallback(() => {
    console.log("🔵 Save Zoom clicked for chart:", selectedChartId);

    const gd = graphDivRef.current as AnyObject | null;
    if (!gd || !gd.layout) {
      console.log("❌ No graph div or layout found");
      return;
    }

    console.log("📊 Current layout:", gd.layout);

    const currentLayout = gd.layout as AnyObject;
    const fullLayout =
      (gd as AnyObject as any)._fullLayout || ({} as AnyObject);
    const xaxis = (currentLayout.xaxis as AnyObject) || {};

    console.log("📈 X-axis data:", xaxis);

    // Helper function to capture Y-axis properties
    const captureYAxisProperties = (yaxisObj: AnyObject) => {
      const properties = {
        range: Array.isArray(yaxisObj.range)
          ? (yaxisObj.range as [any, any])
          : undefined,
        autorange:
          typeof yaxisObj.autorange === "boolean"
            ? yaxisObj.autorange
            : undefined,
        domain:
          Array.isArray(yaxisObj.domain) && yaxisObj.domain.length === 2
            ? (yaxisObj.domain as [number, number])
            : undefined,
        position:
          typeof yaxisObj.position === "number" ? yaxisObj.position : undefined,
        side: typeof yaxisObj.side === "string" ? yaxisObj.side : undefined,
        anchor:
          typeof yaxisObj.anchor === "string" ? yaxisObj.anchor : undefined,
        overlaying:
          typeof yaxisObj.overlaying === "string"
            ? yaxisObj.overlaying
            : undefined,
        type: typeof yaxisObj.type === "string" ? yaxisObj.type : undefined,
      };
      console.log("📊 Captured Y-axis properties:", properties);
      return properties;
    };

    // Prefer values from the live layout, but fall back to _fullLayout so we
    // still capture axes that Plotly keeps only in the computed layout.
    const yaxis =
      (currentLayout.yaxis as AnyObject) ||
      (fullLayout as AnyObject).yaxis ||
      {};
    const yaxis2 =
      (currentLayout.yaxis2 as AnyObject) ||
      (fullLayout as AnyObject).yaxis2 ||
      {};
    const yaxis3 =
      (currentLayout.yaxis3 as AnyObject) ||
      (fullLayout as AnyObject).yaxis3 ||
      {};
    const yaxis4 =
      (currentLayout.yaxis4 as AnyObject) ||
      (fullLayout as AnyObject).yaxis4 ||
      {};

    console.log("📊 Y-axis raw data:", { yaxis, yaxis2, yaxis3, yaxis4 });

    // Capture trace visibility from current data
    const currentTraceVisibility = gd.data
      ? (gd.data as any[]).map((trace, index) => {
          // Handle undefined visibility (default is true)
          const visibility = trace.visible !== undefined ? trace.visible : true;
          console.log(`👁️ Trace ${index} (${trace.name}):`, visibility);
          return visibility;
        })
      : [];
    console.log("👁️ Current trace visibility array:", currentTraceVisibility);

    // Determine which y-axes are actually used by traces
    const usedYAxisNames = new Set<string>();
    if (Array.isArray(gd.data)) {
      (gd.data as any[]).forEach((t: any) => {
        const yaxisTag: string | undefined = t.yaxis; // e.g., 'y', 'y2', 'y3'
        const mapped =
          !yaxisTag || yaxisTag === "y" ? "yaxis" : `yaxis${yaxisTag.slice(1)}`;
        usedYAxisNames.add(mapped);
      });
    }
    if (usedYAxisNames.size === 0) usedYAxisNames.add("yaxis");

    const zoomSettings: any = {
      xaxis: {
        range: Array.isArray(xaxis.range)
          ? (xaxis.range as [any, any])
          : undefined,
        autorange:
          typeof xaxis.autorange === "boolean" ? xaxis.autorange : undefined,
      },
      // y-axes will be populated conditionally below
      traceVisibility: currentTraceVisibility,
    };

    const axisMap: Record<string, AnyObject> = {
      yaxis,
      yaxis2,
      yaxis3,
      yaxis4,
    };
    (Object.keys(axisMap) as Array<keyof typeof axisMap>).forEach(
      (axisName) => {
        const axisObj = axisMap[axisName];
        if (
          usedYAxisNames.has(axisName) &&
          axisObj &&
          Object.keys(axisObj).length > 0
        ) {
          (zoomSettings as any)[axisName] = captureYAxisProperties(axisObj);
        }
      }
    );

    console.log("💾 Final zoom settings to save:", zoomSettings);

    setSavedZooms((prev: typeof savedZooms) => {
      const newState = {
        ...prev,
        [selectedChartId]: zoomSettings,
      };
      console.log("💾 Updated saved zooms state:", newState);
      return newState;
    });

    console.log("✅ Save zoom completed for chart:", selectedChartId);
  }, [selectedChartId]);

  // Function to restore saved zoom settings
  const restoreSavedZoom = (chartId: string) => {
    console.log("🔄 Attempting to restore zoom for chart:", chartId);
    console.log("🔄 Current saved zooms state:", savedZooms);

    const savedZoom = savedZooms[chartId];
    if (!savedZoom) {
      console.log("❌ No saved zoom found for chart:", chartId);
      return null;
    }

    console.log("✅ Found saved zoom for chart:", chartId, savedZoom);
    console.log(
      "🔍 Detailed saved zoom structure:",
      JSON.stringify(savedZoom, null, 2)
    );

    // Helper removed (inlined below) to reduce warnings

    // Build restore settings step by step to control what gets applied
    const restoreSettings: any = {};

    // Always restore X-axis (this is safe)
    if (savedZoom.xaxis?.range) {
      restoreSettings["xaxis.range"] = savedZoom.xaxis.range;
    }
    if (savedZoom.xaxis?.autorange !== undefined) {
      restoreSettings["xaxis.autorange"] = savedZoom.xaxis.autorange;
    }

    // Restore only the y-axes that were previously saved (i.e., actually used)
    const yAxes = Object.keys(savedZoom).filter((k) => /^yaxis\d*$/.test(k));
    yAxes.forEach((yAxisName) => {
      const yAxisData = (savedZoom as any)[yAxisName];
      if (yAxisData) {
        console.log(
          `🔄 Attempting to restore ${yAxisName} with minimal properties`
        );

        // Only restore range and autorange - the most basic properties
        if (yAxisData.range) {
          restoreSettings[`${yAxisName}.range`] = yAxisData.range;
          console.log(`✅ Will restore ${yAxisName}.range:`, yAxisData.range);
        }
        if (yAxisData.autorange !== undefined) {
          restoreSettings[`${yAxisName}.autorange`] = yAxisData.autorange;
          console.log(
            `✅ Will restore ${yAxisName}.autorange:`,
            yAxisData.autorange
          );
        }

        // Skip type for secondary axes as it might cause issues
        if (yAxisName === "yaxis" && yAxisData.type) {
          restoreSettings[`${yAxisName}.type`] = yAxisData.type;
          console.log(`✅ Will restore ${yAxisName}.type:`, yAxisData.type);
        } else if (yAxisData.type) {
          console.log(
            `⚠️ Skipping ${yAxisName}.type (might cause issues):`,
            yAxisData.type
          );
        }

        // Safely restore position for secondary axes when available
        if (yAxisName !== "yaxis") {
          const hasPositionRelated =
            yAxisData.position !== undefined ||
            yAxisData.side !== undefined ||
            yAxisData.anchor !== undefined ||
            yAxisData.overlaying !== undefined;
          if (hasPositionRelated) {
            const side = yAxisData.side; // 'left' | 'right' | undefined
            if (yAxisData.position !== undefined) {
              restoreSettings[`${yAxisName}.position`] = yAxisData.position;
              // Only set anchor/overlaying when position is set; otherwise
              // Plotly may throw _inputDomain errors.
              restoreSettings[`${yAxisName}.anchor`] =
                yAxisData.anchor ?? "free";
              restoreSettings[`${yAxisName}.overlaying`] =
                yAxisData.overlaying ?? "y";
              if (side) restoreSettings[`${yAxisName}.side`] = side;
              console.log(`✅ Will restore ${yAxisName} position settings:`, {
                position: yAxisData.position,
                side: side,
                anchor: yAxisData.anchor ?? "free",
                overlaying: yAxisData.overlaying ?? "y",
              });
            } else {
              // Do not set anchor/overlaying when no position is captured
              if (side) restoreSettings[`${yAxisName}.side`] = side;
            }
          }
        }
      }
    });

    console.log("🔄 Final restore settings:", restoreSettings);

    // Return both layout settings and trace visibility
    const result = {
      layoutSettings: restoreSettings,
      traceVisibility: savedZoom.traceVisibility || null,
    };

    console.log("🔄 Final restore result:", result);
    return result;
  };

  useEffect(() => {
    async function load() {
      try {
        console.log("🌐 Loading chart:", selectedChart.path);
        const res = await fetch(selectedChart.path, { cache: "default" }); // Allow browser HTTP caching only
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") ?? "";
        const rawText = await res.text();
        if (!contentType.includes("application/json")) {
          const preview = rawText.slice(0, 80).replace(/\s+/g, " ");
          throw new Error(
            `Expected JSON for ${selectedChart.path}, got '${
              contentType || "unknown"
            }'. Preview: ${preview}`
          );
        }
        const json = JSON.parse(rawText) as AnyObject;

        if (isPlotlyBundle(json)) {
          setData(json.data);
          setLayout(json.layout);
          setConfig(json.config);
        } else if (Array.isArray(json)) {
          // If the root is an array, assume it's Plotly traces
          setData(json as AnyObject[]);
        } else {
          // Try common keys
          const maybeData = (json as AnyObject)["data"];
          if (Array.isArray(maybeData)) {
            setData(maybeData as AnyObject[]);
            setLayout((json as AnyObject)["layout"] as AnyObject);
            setConfig((json as AnyObject)["config"] as AnyObject);
          } else {
            throw new Error("Unrecognized JSON structure for Plotly");
          }
        }
        setError(null);
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    }
    load();
  }, [selectedChart.path]);

  if (error) {
    return <div style={{ padding: 16 }}>Failed to load JSON: {error}</div>;
  }

  if (!data) {
    return <div style={{ padding: 16 }}>Loading chart…</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">Charts</div>
        <nav className="nav">
          {CHARTS.map((c) => (
            <button
              key={c.id}
              className={`nav-item${c.id === selectedChartId ? " active" : ""}`}
              onClick={() => {
                // Proactively save current chart state (legend visibility,
                // zoom, etc.) before switching charts
                try {
                  saveCurrentZoom();
                } catch {
                  // ignore
                }
                console.log(
                  "🔄 Switching to chart:",
                  c.id,
                  "from:",
                  selectedChartId
                );
                console.log(
                  "🔄 Current saved zooms before switch:",
                  savedZooms
                );
                setSelectedChartId(c.id);
                setError(null);
                setData(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {(() => {
          const rawTitle = (layout as AnyObject | undefined)?.["title"] as
            | string
            | AnyObject
            | undefined;
          const headingText =
            typeof rawTitle === "string"
              ? rawTitle
              : (rawTitle && (rawTitle as AnyObject)["text"])?.toString();

          // Remove HTML tags from the title
          const cleanTitle =
            headingText?.replace(/<[^>]*>/g, "") || "Plotly Viewer";

          return (
            <h2 style={{ marginBottom: 12, textAlign: "center" }}>
              {cleanTitle}
            </h2>
          );
        })()}
        {/* External zoom toolbar */}
        <div className="toolbar">
          <div className="zoom-dropdown-container">
            <label htmlFor="zoom-select">Zoom Presets:</label>
            <select
              id="zoom-select"
              className="zoom-dropdown"
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                const gd = graphDivRef.current as AnyObject | null;
                if (!gd || !(window as any).Plotly) return;

                const zoomOption = e.target.value;
                suppressRelayoutSavesRef.current = 1; // Suppress one relayout save

                switch (zoomOption) {
                  case "default":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2015-01-01", "2025-11-05T00:00:00"],
                      "yaxis.range": [-1, 5.301029995663981],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "fullHistory":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2010-07-18", "2025-11-05T00:00:00"],
                      "yaxis.range": [-2, 5.301029995663981],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "cycle4":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2018-09-01", "2025-11-05T00:00:00"],
                      "yaxis.range": [2.0, 5.301029995663981],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "modernEra":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2015-01-01", "2025-11-05T00:00:00"],
                      "yaxis.range": [0.0, 5.301029995663981],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "recentHistory":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2022-01-01", "2025-11-05T00:00:00"],
                      "yaxis.range": [3.3010299956639813, 5.301029995663981],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "lastYear":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2024-08-08", "2025-09-06"],
                      "yaxis.range": [4.430066613687816, 5.1208199826484115],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "last6Month":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2025-02-09", "2025-09-06"],
                      "yaxis.range": [4.581787177114821, 5.1208199826484115],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  case "last3Month":
                    (window as any).Plotly.relayout(gd, {
                      "xaxis.range": ["2025-05-10", "2025-08-17"],
                      "yaxis.range": [4.702857874191949, 5.1208199826484115],
                      "xaxis.autorange": false,
                      "yaxis.autorange": false,
                    });
                    break;
                  default:
                    break;
                }

                // Reset the select to show placeholder and commit a save so
                // legend state is remembered without extra interaction
                e.target.value = "";
                setTimeout(() => saveCurrentZoom(), 50);
              }}
            >
              <option value="">Select Zoom Level...</option>
              <option value="default">Default Zoom</option>
              <option value="fullHistory">Full History</option>
              <option value="cycle4">Cycle 4</option>
              <option value="modernEra">Modern Era</option>
              <option value="recentHistory">Recent History</option>
              <option value="lastYear">Last Year</option>
              <option value="last6Month">Last 6-Month</option>
              <option value="last3Month">Last 3-Month</option>
            </select>
          </div>
          {/* Drawing toolbar */}
          <div className="zoom-dropdown-container" style={{ marginLeft: 12 }}>
            <label htmlFor="draw-mode">Draw:</label>
            <select
              id="draw-mode"
              className="zoom-dropdown"
              value={drawingMode}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setDrawingMode(e.target.value as any)
              }
            >
              <option value="off">Off</option>
              <option value="line">Line</option>
            </select>
          </div>
          <div className="zoom-dropdown-container" style={{ marginLeft: 8 }}>
            <label htmlFor="draw-axis">Axis:</label>
            <select
              id="draw-axis"
              className="zoom-dropdown"
              value={selectedYAxisForDraw}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setSelectedYAxisForDraw(e.target.value as any)
              }
            >
              <option value="yaxis">yaxis</option>
              <option value="yaxis2">yaxis2</option>
              <option value="yaxis3">yaxis3</option>
              <option value="yaxis4">yaxis4</option>
            </select>
          </div>
          <button
            className="nav-item"
            style={{ marginLeft: 8 }}
            onClick={() =>
              setDrawingsByChart((prev: Record<string, DrawingLine[]>) => ({
                ...prev,
                [selectedChartId]: [],
              }))
            }
          >
            Clear Drawings
          </button>
        </div>

        {(() => {
          const {
            width: _ignoredWidth,
            title: _ignoredTitle,
            updatemenus: _ignoredMenus,
            ...restLayout
          } = (layout ?? {}) as AnyObject;
          const existingLegend = (restLayout["legend"] as AnyObject) ?? {};
          const existingLegendFont =
            (existingLegend["font"] as AnyObject) ?? {};
          const baseFontSize = (existingLegendFont["size"] as number) ?? 12;
          const scaledFontSize = Math.max(8, Math.round(baseFontSize * 0.85));
          const legend = {
            ...existingLegend,
            orientation: "h",
            x: 0.5,
            xanchor: "center",
            y: 1.02,
            yanchor: "bottom",
            font: { ...existingLegendFont, size: scaledFontSize },
          } as AnyObject;

          const existingMargin = (restLayout["margin"] as AnyObject) ?? {};
          const topMarginBase = (existingMargin as AnyObject).t as
            | number
            | undefined;
          const topMarginDefault =
            typeof topMarginBase === "number" ? topMarginBase : 80;
          // Force-hide any Plotly-provided updatemenus; we render our own toolbar
          const updatemenus: any[] = [];

          const requiredTop = 80;
          const scaledTop = Math.max(
            requiredTop,
            Math.round(topMarginDefault * 0.85)
          );
          const margin = {
            ...existingMargin,
            t: scaledTop,
          } as AnyObject;

          // No saved zoom - use base layout
          const layoutWithZoom = {
            ...restLayout,
            legend,
            margin,
            updatemenus,
          };

          const finalLayout = {
            ...layoutWithZoom,
            autosize: true,
            height: 700,
          } as AnyObject;

          return (
            <div className="chart-wrapper" style={{ position: "relative" }}>
              <Plot
                key={selectedChartId}
                data={data as any}
                layout={finalLayout as any}
                config={{
                  responsive: true,
                  displaylogo: false,
                  displayModeBar: false,
                  showTips: false, // Disable tips/notifications
                  ...(config as AnyObject),
                }}
                style={{ width: "100%", height: "700px" }}
                useResizeHandler
                onRelayout={(evt: AnyObject) => {
                  if (suppressRelayoutSavesRef.current > 0) {
                    suppressRelayoutSavesRef.current -= 1;
                    return;
                  }
                  console.log("🔍 onRelayout event:", evt);
                  const zoom = extractZoomFromRelayoutEvent(evt as AnyObject);
                  console.log("🔍 Extracted zoom:", zoom);
                  // Detect axis position/side/anchor/overlaying changes too
                  const hasAxisPositionChange = Object.keys(
                    evt as AnyObject
                  ).some((k) =>
                    /^yaxis\d*\.(position|side|anchor|overlaying|domain)$/.test(
                      k
                    )
                  );
                  if (Object.keys(zoom).length > 0 || hasAxisPositionChange) {
                    // Save view when user interacts with zoom/axes
                    console.log(
                      "💾 User interacted with chart (zoom/axes), saving view..."
                    );
                    setTimeout(() => saveCurrentZoom(), 100); // Small delay to ensure layout is updated
                  } else {
                    console.log(
                      "❌ No zoom changes detected in relayout event"
                    );
                  }
                }}
                onLegendClick={(data: any) => {
                  // Save view when user clicks legend items
                  console.log("💾 User clicked legend:", data);
                  console.log("💾 Scheduling save after legend click...");
                  // Suppress the immediate relayout save that may be triggered
                  // indirectly, and schedule an explicit save once Plotly
                  // finishes toggling trace visibility.
                  suppressRelayoutSavesRef.current = 1;
                  setTimeout(() => {
                    try {
                      console.log(
                        "💾 Executing delayed save after legend click"
                      );
                      saveCurrentZoom();
                    } catch (err) {
                      console.warn("⚠️ Legend save failed (continuing)", err);
                    }
                  }, 120);
                  return true; // Allow default legend behavior
                }}
                onInitialized={async (_figure: any, graphDiv: any) => {
                  console.log("🎯 Chart initialized for:", selectedChartId);
                  graphDivRef.current = graphDiv;

                  // Restore saved zoom settings if they exist
                  console.log("🎯 Checking for saved zoom settings...");
                  const savedZoomResult = restoreSavedZoom(selectedChartId);
                  if (
                    savedZoomResult &&
                    savedZoomResult.layoutSettings &&
                    Object.keys(savedZoomResult.layoutSettings).length > 0
                  ) {
                    console.log("🎯 Applying saved zoom settings...");
                    suppressRelayoutSavesRef.current = 1; // Only suppress one relayout call

                    // Apply trace visibility first (this is more reliable and doesn't cause _inputDomain errors)
                    if (
                      savedZoomResult.traceVisibility &&
                      Array.isArray(savedZoomResult.traceVisibility)
                    ) {
                      console.log(
                        "👁️ Applying saved trace visibility:",
                        savedZoomResult.traceVisibility
                      );
                      try {
                        console.log(
                          "👁️ Current traces before restyle:",
                          graphDiv.data?.map(
                            (t: any, i: number) =>
                              `${i}: ${t.name} = ${t.visible}`
                          )
                        );
                        // Convert null values back to true (default visibility)
                        const visibilityArray =
                          savedZoomResult.traceVisibility.map((v: any) =>
                            v === null ? true : v
                          );
                        console.log(
                          "👁️ Converted visibility array:",
                          visibilityArray
                        );
                        // Normalize the saved visibility array to the current
                        // trace count, then apply in a single batched restyle
                        // for speed.
                        const currentTraceCount = Array.isArray(graphDiv.data)
                          ? graphDiv.data.length
                          : 0;
                        let normalizedVisibility = visibilityArray;
                        if (currentTraceCount > 0) {
                          if (visibilityArray.length > currentTraceCount) {
                            normalizedVisibility = visibilityArray.slice(
                              0,
                              currentTraceCount
                            );
                          } else if (
                            visibilityArray.length < currentTraceCount
                          ) {
                            const pad = new Array(
                              currentTraceCount - visibilityArray.length
                            ).fill(true);
                            normalizedVisibility = [...visibilityArray, ...pad];
                          }
                        }
                        await (window as any).Plotly.restyle(graphDiv, {
                          visible: normalizedVisibility,
                        });
                        console.log(
                          "👁️ Current traces after restyle:",
                          graphDiv.data?.map(
                            (t: any, i: number) =>
                              `${i}: ${t.name} = ${t.visible}`
                          )
                        );
                        console.log(
                          "✅ Trace visibility applied successfully!"
                        );
                      } catch (visError) {
                        console.error(
                          "❌ Error applying trace visibility:",
                          visError
                        );
                      }
                    }

                    // Then try to apply layout changes (skip if it causes errors)
                    try {
                      console.log(
                        "🔧 Applying layout settings:",
                        savedZoomResult.layoutSettings
                      );
                      await (window as any).Plotly.relayout(
                        graphDiv,
                        savedZoomResult.layoutSettings
                      );
                      console.log("✅ Layout settings applied successfully!");

                      // Some positioned secondary axes require a second pass where
                      // anchor/overlaying are already set before position takes effect.
                      const posAxes = Object.keys(
                        savedZoomResult.layoutSettings || {}
                      )
                        .filter((k) => /^(yaxis\d+)\.position$/.test(k))
                        .map((k) => k.match(/^(yaxis\d+)\.position$/)![1])
                        // Ensure we only target secondary axes (yaxis2+)
                        .filter((axisName) => axisName !== "yaxis");

                      if (posAxes.length > 0) {
                        const secondPass: Record<string, any> = {};
                        for (const axisName of posAxes) {
                          const posKey = `${axisName}.position`;
                          const sideKey = `${axisName}.side`;
                          const anchorKey = `${axisName}.anchor`;
                          const overlayKey = `${axisName}.overlaying`;

                          if (
                            savedZoomResult.layoutSettings[posKey] !== undefined
                          ) {
                            secondPass[posKey] =
                              savedZoomResult.layoutSettings[posKey];
                          }
                          // Ensure required coupling for positioned axes
                          if (
                            savedZoomResult.layoutSettings[anchorKey] !==
                            undefined
                          ) {
                            secondPass[anchorKey] =
                              savedZoomResult.layoutSettings[anchorKey];
                          }
                          if (
                            savedZoomResult.layoutSettings[overlayKey] !==
                            undefined
                          ) {
                            secondPass[overlayKey] =
                              savedZoomResult.layoutSettings[overlayKey];
                          }
                          if (
                            savedZoomResult.layoutSettings[sideKey] !==
                            undefined
                          ) {
                            secondPass[sideKey] =
                              savedZoomResult.layoutSettings[sideKey];
                          }
                        }
                        console.log(
                          "🔧 Applying second pass for positioned axes:",
                          secondPass
                        );
                        try {
                          await (window as any).Plotly.relayout(
                            graphDiv,
                            secondPass
                          );
                          console.log(
                            "✅ Second pass position settings applied!"
                          );
                        } catch (posErr) {
                          console.warn(
                            "⚠️ Second pass for axis positions failed (continuing):",
                            posErr
                          );
                        }
                      }
                    } catch (layoutError) {
                      console.error(
                        "❌ Error applying layout settings (skipping):",
                        layoutError
                      );
                      console.log(
                        "⚠️ Layout restoration failed, but trace visibility should still work"
                      );
                    }
                  } else {
                    console.log("❌ No saved zoom settings to apply");
                  }

                  try {
                    if (graphDiv && typeof graphDiv.on === "function") {
                      const resetToDefault = () => {
                        try {
                          performDefaultReset();
                        } catch {
                          // ignore
                        }
                      };
                      graphDiv.on("plotly_buttonclicked", (e: any) => {
                        const label: string = String(
                          e?.button?.label || e?.button?.name || ""
                        );
                        if (/default\s*zoom|reset/i.test(label)) {
                          resetToDefault();
                        }
                      });
                      // Use native DOM event listener instead of Plotly's event system
                      const handleDoubleClick = (event: MouseEvent) => {
                        console.log("🖱️ Native double-click event:", event);

                        const target = event.target as HTMLElement;
                        if (!target) {
                          console.log("❌ No target found");
                          resetToDefault();
                          return;
                        }

                        const targetClass = target.getAttribute("class") || "";
                        const targetTag = target.tagName.toLowerCase();
                        const targetId = target.getAttribute("id") || "";

                        console.log("🎯 Click target details:", {
                          targetClass,
                          targetTag,
                          targetId,
                          target,
                        });

                        // Walk up the DOM tree to find axis-related elements
                        let currentEl: HTMLElement | null = target;
                        let foundAxisInfo = null;

                        for (let i = 0; i < 10 && currentEl; i++) {
                          const elClass = currentEl.getAttribute("class") || "";
                          const elTag = currentEl.tagName.toLowerCase();

                          console.log(`🔍 Level ${i}:`, {
                            elClass,
                            elTag,
                            element: currentEl,
                          });

                          // Check for various Plotly axis-related classes
                          if (
                            elClass &&
                            (elClass.includes("ytick") ||
                              elClass.includes("xtick") ||
                              elClass.includes("tick") ||
                              elClass.includes("axis") ||
                              elClass.includes("y2tick") ||
                              elClass.includes("y3tick") ||
                              elClass.includes("y4tick") ||
                              // Common Plotly axis classes
                              elClass.includes("yaxislayer") ||
                              elClass.includes("xaxislayer") ||
                              elClass.includes("subplot") ||
                              // SVG text elements that might be axis labels
                              (elTag === "text" && elClass.includes("y")) ||
                              (elTag === "text" && elClass.includes("x")))
                          ) {
                            foundAxisInfo = {
                              level: i,
                              class: elClass,
                              tag: elTag,
                              element: currentEl,
                            };
                            console.log(
                              "🎯 Found potential axis element:",
                              foundAxisInfo
                            );

                            // Try to determine which axis this is
                            if (
                              elClass.includes("y2") ||
                              elClass.includes("yaxis2")
                            ) {
                              console.log("🔄 Detected yaxis2, resetting it");
                              (window as any).Plotly.relayout(graphDiv, {
                                "yaxis2.autorange": true,
                              });
                              return;
                            } else if (
                              elClass.includes("y3") ||
                              elClass.includes("yaxis3")
                            ) {
                              console.log("🔄 Detected yaxis3, resetting it");
                              (window as any).Plotly.relayout(graphDiv, {
                                "yaxis3.autorange": true,
                              });
                              return;
                            } else if (
                              elClass.includes("y4") ||
                              elClass.includes("yaxis4")
                            ) {
                              console.log("🔄 Detected yaxis4, resetting it");
                              (window as any).Plotly.relayout(graphDiv, {
                                "yaxis4.autorange": true,
                              });
                              return;
                            } else if (
                              elClass.includes("y") &&
                              !elClass.includes("x")
                            ) {
                              console.log(
                                "🔄 Detected primary yaxis, resetting it"
                              );
                              (window as any).Plotly.relayout(graphDiv, {
                                "yaxis.autorange": true,
                              });
                              return;
                            } else if (elClass.includes("x")) {
                              console.log("🔄 Detected xaxis, resetting it");
                              (window as any).Plotly.relayout(graphDiv, {
                                "xaxis.autorange": true,
                              });
                              return;
                            }
                            break;
                          }

                          currentEl = currentEl.parentElement;
                        }

                        // If we get here, it was a click in the chart area (not on an axis)
                        console.log(
                          "🔄 Double-clicked in chart area, resetting entire chart"
                        );
                        resetToDefault();
                      };

                      // Add the native event listener
                      graphDiv.addEventListener("dblclick", handleDoubleClick);

                      // Also keep the Plotly event for fallback (but simpler)
                      graphDiv.on("plotly_doubleclick", () => {
                        // This will be handled by the native event listener above
                        console.log(
                          "📝 Plotly double-click event fired (handled by native listener)"
                        );
                      });
                    }
                  } catch {
                    // ignore
                  }
                }}
              />
              {/* Drawing overlay */}
              <svg
                ref={overlaySvgRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: drawingMode === "line" ? "auto" : "none",
                }}
                onMouseDown={startDrawing}
                onMouseMove={moveDrawing}
                onMouseUp={endDrawing}
              >
                {(() => {
                  const drawings = drawingsByChart[selectedChartId] || [];
                  const toLine = (d: DrawingLine) => {
                    const a = dataToPixel(d.x0, d.y0, d.yAxisName);
                    const b = dataToPixel(d.x1, d.y1, d.yAxisName);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={d.id}
                        x1={a.px}
                        y1={a.py}
                        x2={b.px}
                        y2={b.py}
                        stroke={d.color}
                        strokeWidth={d.width}
                      />
                    );
                  };
                  const active = activeLine ? toLine(activeLine) : null;
                  return (
                    <g>
                      {drawings.map((d: DrawingLine) => toLine(d))}
                      {active}
                    </g>
                  );
                })()}
              </svg>
            </div>
          );
        })()}
        <p style={{ marginTop: 8, color: "#888" }}>
          Serving: <code>{selectedChart.path}</code>
        </p>
      </main>
    </div>
  );
}

export default App;
