/**
 * Composite Chart Script for d3pm
 * Universal chart overlay system supporting mixed chart types
 */

import { CompositeChart, UnifiedSeries, CompositeChartOptions } from "./CompositeChart.ts";
import { BaseChart } from "./BaseChart.ts";

// CLI handling
if (import.meta.main) {
  BaseChart.handleCLI(
    (data: UnifiedSeries[], options?: CompositeChartOptions) => new CompositeChart(data, options),
    (chart: CompositeChart) => chart.render(),
    'Usage: deno run --allow-all composite.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{name: string, renderType: "line"|"scatter"|"bar"|"histogram", data: [{x: number, y: number}]}, ...]}'
  );
}

export { CompositeChart };