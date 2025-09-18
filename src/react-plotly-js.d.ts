declare module "react-plotly.js" {
  import * as React from "react";

  export interface PlotParams {
    data?: any;
    layout?: any;
    config?: any;
    onRelayout?: (event: any) => void;
    onInitialized?: (figure: any, graphDiv?: any) => void;
    onUpdate?: (figure: any, graphDiv?: any) => void;
    onLegendClick?: (event?: any) => boolean | void;
    useResizeHandler?: boolean;
    style?: React.CSSProperties;
    className?: string;
  }

  const Plot: React.ComponentType<PlotParams>;
  export default Plot;
}


