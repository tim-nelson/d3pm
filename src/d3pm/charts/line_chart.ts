/**
 * Line Chart Entry Point - Uses refactored LineChart class
 * Usage: deno run --allow-all line_chart.ts '{"data": [...], "options": {...}}'
 */

import { LineChart, LineSeries, LineChartOptions } from "./charts/LineChart.ts";

interface ChartInput {
  data: LineSeries[];
  options?: LineChartOptions;
}

function createLineChart(data: LineSeries[], options: LineChartOptions = {}): string {
  const chart = new LineChart(data, options);
  return chart.render();
}

// Main execution
if (import.meta.main) {
  try {
    const inputArg = Deno.args[0];
    if (!inputArg) {
      console.error('Error: No input data provided');
      console.error('Usage: deno run --allow-all line_chart.ts \'{"data": [...], "options": {...}}\'');
      Deno.exit(1);
    }

    const input: ChartInput = JSON.parse(inputArg);
    
    if (!input.data || !Array.isArray(input.data)) {
      console.error('Error: Invalid data format. Expected {data: [{name: string, data: [{x: number, y: number}, ...]}, ...]}');
      Deno.exit(1);
    }

    const svgString = createLineChart(input.data, input.options);
    console.log(svgString);
    
  } catch (error) {
    console.error('Error generating line chart:', error.message);
    Deno.exit(1);
  }
}

export { createLineChart };