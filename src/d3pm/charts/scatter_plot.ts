/**
 * Scatter Plot Entry Point - Uses refactored ScatterChart class
 * Usage: deno run --allow-all scatter_plot.ts '{"data": [...], "options": {...}}'
 */

import { ScatterChart, ScatterSeries, ScatterChartOptions } from "./charts/ScatterChart.ts";

interface ChartInput {
  data: ScatterSeries[];
  options?: ScatterChartOptions;
}

function createScatterChart(data: ScatterSeries[], options: ScatterChartOptions = {}): string {
  const chart = new ScatterChart(data, options);
  return chart.render();
}

// Main execution
if (import.meta.main) {
  try {
    const inputArg = Deno.args[0];
    if (!inputArg) {
      console.error('Error: No input data provided');
      console.error('Usage: deno run --allow-all scatter_plot.ts \'{"data": [...], "options": {...}}\'');
      Deno.exit(1);
    }

    const input: ChartInput = JSON.parse(inputArg);
    
    if (!input.data || !Array.isArray(input.data)) {
      console.error('Error: Invalid data format. Expected {data: [{name: string, data: [{x: number, y: number, size?: number, color?: string, label?: string}, ...]}, ...]}');
      Deno.exit(1);
    }

    const svgString = createScatterChart(input.data, input.options);
    console.log(svgString);
    
  } catch (error) {
    console.error('Error generating scatter plot:', error.message);
    Deno.exit(1);
  }
}

export { createScatterChart };