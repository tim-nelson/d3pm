/**
 * HistogramChart - Extends BaseChart for histogram chart specific functionality
 * Features: No gaps between bars, continuous scale, smart tick management
 */

import { scaleLinear } from "https://esm.sh/d3-scale@4";
import { BaseChart, BaseChartOptions } from "./BaseChart.ts";

export interface HistogramData {
  binStart: number;
  binEnd: number;
  count: number;
  label?: string; // Optional label for the bin
}

export interface HistogramChartOptions extends BaseChartOptions {
  binWidth?: number; // Optional: if not provided, calculated from data
  showBinEdges?: boolean; // Whether to show tick marks at bin edges (default: true)
  continuousLabels?: boolean; // Whether to use continuous numeric labels (default: true)
}

interface HistogramChartInput {
  data: HistogramData[];
  options?: HistogramChartOptions;
}

export class HistogramChart extends BaseChart<HistogramData[], HistogramChartOptions> {
  private xScale: any;
  private yScale: any;

  constructor(data: HistogramData[], options: HistogramChartOptions = {}) {
    super(data, options);
    this.createScales();
  }

  protected getDefaultOptions(): Required<HistogramChartOptions> {
    const baseDefaults = this.getBaseDefaults();
    return {
      ...baseDefaults,
      binWidth: 0, // Will be calculated from data
      showBinEdges: true,
      continuousLabels: true,
      tickStrategy: 'skip' as const // Histograms default to smart skipping
    };
  }

  protected getColorDomain(): string[] {
    return ['histogram'];
  }

  // Override tick strategy for histograms - prefer skipping for continuous data
  protected getTickStrategy(): 'skip' | 'rotate' {
    const { tickStrategy } = this.options;
    
    if (tickStrategy === 'skip' || tickStrategy === 'rotate') {
      return tickStrategy;
    }
    
    // Histograms default to skipping (continuous data)
    return 'skip';
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;
    
    // Calculate data domain
    const minX = Math.min(...this.data.map(d => d.binStart));
    const maxX = Math.max(...this.data.map(d => d.binEnd));
    const maxY = Math.max(...this.data.map(d => d.count));
    
    // Create continuous x-scale (unlike bar charts which use band scale)
    this.xScale = scaleLinear()
      .domain([minX, maxX])
      .range([0, innerWidth]);
      
    this.yScale = scaleLinear()
      .domain([0, maxY])
      .range([innerHeight, 0])
      .nice();
  }

  protected renderChartElements(): void {
    const { innerHeight } = this.dimensions;

    // Render histogram bars with no gaps
    this.data.forEach((bin, i) => {
      const barX = this.xScale(bin.binStart);
      const barWidth = this.xScale(bin.binEnd) - this.xScale(bin.binStart); // Exact bin width, no gaps
      const barHeight = innerHeight - this.yScale(bin.count);
      const barY = this.yScale(bin.count);

      // Use first color for histogram (single color typically)
      const color = this.colorScale('histogram');

      this.svgElements.push(
        `<rect x="${barX}" y="${barY}" width="${barWidth*.96}" height="${barHeight}" 
              fill="${color}" stroke="${this.themeColors.axis}" stroke-width="0.0" opacity="0.8">
          <title>Bin: ${bin.binStart.toFixed(2)} - ${bin.binEnd.toFixed(2)}, Count: ${bin.count}</title>
        </rect>`
      );
    });

    // Render axes with smart tick management
    this.renderHistogramAxes();
  }

  private renderHistogramAxes(): void {
    const { innerWidth, innerHeight } = this.dimensions;
    const { showBinEdges } = this.options;
    const { axis, text } = this.themeColors;
    
    // Calculate data domain for tick generation
    const minX = Math.min(...this.data.map(d => d.binStart));
    const maxX = Math.max(...this.data.map(d => d.binEnd));
    
    // X-axis line
    this.svgElements.push(`<line x1="0" y1="${innerHeight}" x2="${innerWidth}" y2="${innerHeight}" stroke="${axis}" stroke-width="1"/>`);
    
    // Y-axis line
    this.svgElements.push(`<line x1="0" y1="0" x2="0" y2="${innerHeight}" stroke="${axis}" stroke-width="1"/>`);

    // Generate tick positions - smart approach
    const binEdges: number[] = [];
    
    if (showBinEdges && this.data.length > 0 && this.data.length <= 10) {
      // For small number of bins, show all edges
      this.data.forEach(bin => {
        if (!binEdges.includes(bin.binStart)) {
          binEdges.push(bin.binStart);
        }
      });
      const lastBin = this.data[this.data.length - 1];
      if (!binEdges.includes(lastBin.binEnd)) {
        binEdges.push(lastBin.binEnd);
      }
    } else {
      // For many bins or when not showing bin edges, use regular intervals
      const tickCount = 6;
      for (let i = 0; i <= tickCount; i++) {
        binEdges.push(minX + (maxX - minX) * i / tickCount);
      }
    }

    // Create tick elements for smart management
    const tickElements: string[] = [];
    const tickLabels: string[] = [];

    // Determine appropriate decimal places based on data range
    const range = maxX - minX;
    const decimalPlaces = range < 1 ? 3 : range < 10 ? 2 : 1;

    binEdges.forEach(edge => {
      const x = this.xScale(edge);
      const label = edge.toFixed(decimalPlaces);
      tickLabels.push(label);
      
      const tickElement = `
        <g transform="translate(${x}, ${innerHeight})">
          <line y1="0" y2="5" stroke="${axis}" stroke-width="1"/>
          <text y="18" text-anchor="middle" fill="${text}" font-size="12">${label}</text>
        </g>
      `;
      tickElements.push(tickElement);
    });

    // Apply smart tick management
    const strategy = this.getTickStrategy();
    let processedTicks: string[];

    if (strategy === 'skip') {
      processedTicks = this.applySmartTickSkipping(tickElements, tickLabels, innerWidth);
    } else {
      // Check if rotation is needed
      const needsRotation = this.shouldSkipTicks(tickLabels, innerWidth, 50);
      if (needsRotation) {
        processedTicks = this.applyRotatedLabels(tickElements, 45);
      } else {
        processedTicks = tickElements;
      }
    }

    // Add processed x-axis ticks
    const { xticks = 5 } = this.options;
    if (xticks > 0) {
      processedTicks.forEach(tick => {
        this.svgElements.push(tick);
      });
    }

    // Y-axis ticks
    const { yticks = 5 } = this.options;
    if (yticks > 0) {
      const yTicks = this.yScale.ticks(yticks);
      yTicks.forEach((tick: number) => {
        const y = this.yScale(tick);
        this.svgElements.push(`
          <g transform="translate(0, ${y})">
            <line x1="-5" x2="0" stroke="${axis}" stroke-width="1"/>
            <text x="-10" y="4" text-anchor="end" fill="${text}" font-size="12">${tick}</text>
          </g>
        `);
      });
    }
  }
}

// CLI handling
if (import.meta.main) {
  BaseChart.handleCLI(
    (data: HistogramData[], options?: HistogramChartOptions) => new HistogramChart(data, options),
    (chart: HistogramChart) => chart.render(),
    'Usage: deno run --allow-all HistogramChart.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{binStart: number, binEnd: number, count: number}, ...]}'
  );
}

export { HistogramChart as createHistogramChart };