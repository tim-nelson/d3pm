/**
 * Bar Chart Entry Point - Uses refactored BarChart class
 * Usage: deno run --allow-all bar_chart.ts '{"data": [...], "options": {...}}'
 */

import { BarChart, BarData, BarChartOptions } from "./charts/BarChart.ts";

interface ChartInput {
  data: BarData[];
  options?: BarChartOptions;
}

function createBarChart(data: BarData[], options: BarChartOptions = {}): string {
  const chart = new BarChart(data, options);
  return chart.render();
}

// Main execution
if (import.meta.main) {
  try {
    const inputArg = Deno.args[0];
    if (!inputArg) {
      console.error('Error: No input data provided');
      console.error('Usage: deno run --allow-all bar_chart.ts \'{"data": [...], "options": {...}}\'');
      Deno.exit(1);
    }

    const input: ChartInput = JSON.parse(inputArg);
    
    if (!input.data || !Array.isArray(input.data)) {
      console.error('Error: Invalid data format. Expected {data: [{label: string, value: number}, ...]}');
      Deno.exit(1);
    }

    const svgString = createBarChart(input.data, input.options);
    console.log(svgString);
    
  } catch (error) {
    console.error('Error generating bar chart:', error.message);
    Deno.exit(1);
  }
}

export { createBarChart };