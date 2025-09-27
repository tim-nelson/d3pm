/**
 * ScatterChart - Extends BaseChart for scatter plot specific functionality
 */

import { extent } from "https://esm.sh/d3-array@3";
import { BaseChart, BaseChartOptions } from "./BaseChart.ts";

export interface ScatterPoint {
  x: number;
  y: number;
  size?: number;
  color?: string;
  label?: string;
}

export interface ScatterSeries {
  name: string;
  data: ScatterPoint[];
  color?: string;
}

export interface ScatterChartOptions extends BaseChartOptions {
  pointSize?: number;
  opacity?: number;
}

interface ScatterChartInput {
  data: ScatterSeries[];
  options?: ScatterChartOptions;
}

export class ScatterChart extends BaseChart<ScatterSeries[], ScatterChartOptions> {
  private xScale: any;
  private yScale: any;
  private sizeScale: any;
  private allData: ScatterPoint[];
  private hasSizeData: boolean;

  constructor(data: ScatterSeries[], options: ScatterChartOptions = {}) {
    super(data, options);
    this.allData = this.data.flatMap(s => s.data);
    this.hasSizeData = this.allData.some(d => d.size !== undefined);
    this.createScales();
  }

  protected getDefaultOptions(): Required<ScatterChartOptions> {
    return {
      title: '',
      xLabel: '',
      yLabel: '',
      pointSize: 4,
      opacity: 1.0
    };
  }

  protected getColorDomain(): string[] {
    return this.data.map(s => s.name);
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;
    const { aspectRatio } = this.options;

    if (aspectRatio === 'equal') {
      // Use equal scaling for correlation plots
      let xDomain = extent(this.allData, d => d.x)!;
      let yDomain = extent(this.allData, d => d.y)!;
      
      // Apply xlim/ylim if specified
      if (this.options.xlim) {
        const xlim = this.options.xlim;
        if (xlim.length >= 1 && xlim[0] !== null && xlim[0] !== undefined) {
          xDomain[0] = xlim[0];
        }
        if (xlim.length >= 2 && xlim[1] !== null && xlim[1] !== undefined) {
          xDomain[1] = xlim[1];
        }
      }
      
      if (this.options.ylim) {
        const ylim = this.options.ylim;
        if (ylim.length >= 1 && ylim[0] !== null && ylim[0] !== undefined) {
          yDomain[0] = ylim[0];
        }
        if (ylim.length >= 2 && ylim[1] !== null && ylim[1] !== undefined) {
          yDomain[1] = ylim[1];
        }
      }
      
      // Create equal scales
      const scales = this.createEqualScales(
        xDomain,
        yDomain,
        [0, innerWidth],
        [innerHeight, 0]
      );
      
      this.xScale = scales.xScale;
      this.yScale = scales.yScale;
    } else {
      // Use regular optimal scaling
      this.xScale = this.createOptimalScale(
        extent(this.allData, d => d.x)!,
        [0, innerWidth],
        true,
        'xlim'  // use xlim for X-axis
      );

      this.yScale = this.createOptimalScale(
        extent(this.allData, d => d.y)!,
        [innerHeight, 0],
        true,
        'ylim'  // use ylim for Y-axis
      );
    }

    // Size scale (if size property exists)
    if (this.hasSizeData) {
      this.sizeScale = this.createLinearScale(
        extent(this.allData, d => d.size || this.options.pointSize)!,
        [3, 15]
      );
    } else {
      this.sizeScale = () => this.options.pointSize;
    }
  }

  protected renderXAxis(): void {
    const { innerHeight } = this.dimensions;
    const { axis, text } = this.themeColors;
    
    // Calculate data range for smart formatting
    const xExtent = extent(this.allData, d => d.x)!;
    const dataRange = xExtent[1] - xExtent[0];
    
    this.xScale.ticks(5).forEach((tick: number) => {
      const x = this.xScale(tick);
      this.svgElements.push(
        `<line x1="${x}" y1="${innerHeight}" x2="${x}" y2="${innerHeight + 6}" stroke="${axis}" stroke-width="1"/>`
      );
      this.svgElements.push(
        `<text x="${x}" y="${innerHeight + 20}" text-anchor="middle" fill="${text}" font-size="12px">${this.formatTickValueSmart(tick, dataRange)}</text>`
      );
    });
  }

  protected renderYAxis(): void {
    const { text, axis } = this.themeColors;
    
    // Calculate data range for smart formatting
    const yExtent = extent(this.allData, d => d.y)!;
    const dataRange = yExtent[1] - yExtent[0];
    
    this.yScale.ticks(5).forEach((tick: number) => {
      const y = this.yScale(tick);
      this.svgElements.push(
        `<line x1="-6" y1="${y}" x2="0" y2="${y}" stroke="${axis}" stroke-width="1"/>`
      );
      this.svgElements.push(
        `<text x="-10" y="${y + 4}" text-anchor="end" fill="${text}" font-size="12px">${this.formatTickValueSmart(tick, dataRange)}</text>`
      );
    });
  }

  protected renderChartElements(): void {
    const { pointSize, opacity } = this.options;
    const { text } = this.themeColors;

    this.data.forEach((seriesData) => {
      const seriesColor = seriesData.color || this.colorScale(seriesData.name);

      seriesData.data.forEach(point => {
        const cx = this.xScale(point.x);
        const cy = this.yScale(point.y);
        const radius = this.hasSizeData ? this.sizeScale(point.size || pointSize) : pointSize;
        const pointColor = point.color || seriesColor;

        // Simple solid circle
        this.svgElements.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${pointColor}" opacity="${opacity}"/>`
        );

        // Add simple point labels if they exist
        if (point.label) {
          this.svgElements.push(
            `<text x="${cx}" y="${cy - radius - 3}" text-anchor="middle" fill="${text}" font-size="10px">${point.label}</text>`
          );
        }
      });
    });
  }

  protected renderLegend(): void {
    if (this.data.length > 1) {
      const { width, margin } = this.dimensions;
      const { text } = this.themeColors;
      const { opacity } = this.options;

      const labels = this.data.map(s => s.name);
      const legendWidth = this.calculateLegendWidth(labels);
      const legendX = Math.max(width - legendWidth - 10, width - 150);

      this.data.forEach((seriesData, i) => {
        const color = seriesData.color || this.colorScale(seriesData.name);
        const legendY = margin.top + i * 18;
        
        this.svgElements.push(
          `<circle cx="${legendX + 6}" cy="${legendY + 6}" r="4" fill="${color}" opacity="${opacity}"/>`
        );
        
        this.svgElements.push(
          `<text x="${legendX + 15}" y="${legendY + 10}" fill="${text}" font-size="10px">${seriesData.name}</text>`
        );
      });
    }
  }
}

// CLI handling
if (import.meta.main) {
  BaseChart.handleCLI(
    (data: ScatterSeries[], options?: ScatterChartOptions) => new ScatterChart(data, options),
    (chart: ScatterChart) => chart.render(),
    'Usage: deno run --allow-all ScatterChart.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{name: string, data: [{x: number, y: number, size?: number, color?: string, label?: string}, ...]}, ...]}'
  );
}

export { ScatterChart as createScatterChart };