/**
 * BarChart - Extends BaseChart for bar chart specific functionality
 */

import { scaleBand } from "https://esm.sh/d3-scale@4";
import { max } from "https://esm.sh/d3-array@3";
import { BaseChart, BaseChartOptions, Margin } from "./BaseChart.ts";

export interface BarData {
  label: string;
  value: number;
}

export interface BarChartOptions extends BaseChartOptions {
  // Bar-specific options can be added here if needed
}

interface BarChartInput {
  data: BarData[];
  options?: BarChartOptions;
}

export class BarChart extends BaseChart<BarData[], BarChartOptions> {
  private xScale: any;
  private yScale: any;

  constructor(data: BarData[], options: BarChartOptions = {}) {
    super(data, options);
    this.createScales();
  }

  protected getDefaultOptions(): Required<BarChartOptions> {
    return {
      title: '',
      xLabel: '',
      yLabel: ''
    };
  }

  protected getColorDomain(): string[] {
    return this.data.map(d => d.label);
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;

    // X scale (categorical)
    this.xScale = scaleBand()
      .domain(this.data.map(d => d.label))
      .range([0, innerWidth])
      .padding(0.2);

    // Y scale (linear) - always start from 0 for bar charts
    this.yScale = this.createOptimalScale(
      [0, max(this.data, d => d.value)!],
      [innerHeight, 0],
      true
    );
  }

  protected renderXAxis(): void {
    const { innerHeight } = this.dimensions;
    const { axis, text } = this.themeColors;
    
    this.xScale.domain().forEach((tick: string) => {
      const x = this.xScale(tick)! + this.xScale.bandwidth() / 2;
      this.svgElements.push(
        `<line x1="${x}" y1="${innerHeight}" x2="${x}" y2="${innerHeight + 6}" stroke="${axis}" stroke-width="1"/>`
      );
      this.svgElements.push(
        `<text x="${x}" y="${innerHeight + 20}" text-anchor="middle" fill="${text}" font-size="12px">${tick}</text>`
      );
    });
  }

  protected renderYAxis(): void {
    const { text, axis } = this.themeColors;
    const { yticks = 5 } = this.options;
    
    // Skip rendering if yticks is 0
    if (yticks === 0) return;
    
    this.yScale.ticks(yticks).forEach((tick: number) => {
      const y = this.yScale(tick);
      this.svgElements.push(
        `<line x1="-6" y1="${y}" x2="0" y2="${y}" stroke="${axis}" stroke-width="1"/>`
      );
      this.svgElements.push(
        `<text x="-10" y="${y + 4}" text-anchor="end" fill="${text}" font-size="12px">${tick}</text>`
      );
    });
  }

  protected renderChartElements(): void {
    const { innerHeight } = this.dimensions;
    const { text } = this.themeColors;

    this.data.forEach((d) => {
      const x = this.xScale(d.label)!;
      const y = this.yScale(d.value);
      const barWidth = this.xScale.bandwidth();
      const barHeight = innerHeight - y;
      const color = this.colorScale(d.label);

      if (barHeight > 0) {
        // Simple solid bar
        this.svgElements.push(
          `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" stroke="none"/>`
        );
        
        // Simple value label
        this.svgElements.push(
          `<text x="${x + barWidth/2}" y="${y - 5}" text-anchor="middle" fill="${text}" font-size="12px">${d.value}</text>`
        );
      }
    });
  }
}

// CLI handling
if (import.meta.main) {
  BaseChart.handleCLI(
    (data: BarData[], options?: BarChartOptions) => new BarChart(data, options),
    (chart: BarChart) => chart.render(),
    'Usage: deno run --allow-all BarChart.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{label: string, value: number}, ...]}'
  );
}

export { BarChart as createBarChart };