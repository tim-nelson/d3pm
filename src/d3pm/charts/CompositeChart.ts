/**
 * CompositeChart - Universal chart overlay system for mixed chart types
 * Supports overlaying any combination of line, scatter, bar, and histogram charts
 * with harmonized scales and native visual representation
 */

import { extent, max, min } from "https://esm.sh/d3-array@3";
import { scaleLinear, scaleBand } from "https://esm.sh/d3-scale@4";
import { BaseChart, BaseChartOptions } from "./BaseChart.ts";

export interface UnifiedPoint {
  x: number;
  y: number;
  size?: number;
  label?: string;
  binStart?: number;
  binEnd?: number;
}

export interface UnifiedSeries {
  name: string;
  renderType: 'line' | 'scatter' | 'bar' | 'histogram';
  data: UnifiedPoint[];
  color?: string;
}

export interface CompositeChartOptions extends BaseChartOptions {
  // Composite-specific options
}

export class CompositeChart extends BaseChart<UnifiedSeries[], CompositeChartOptions> {
  private xScale: any;
  private yScale: any;
  private allData: UnifiedPoint[];
  private hasBarData: boolean;
  private categoryLabels: string[];

  constructor(data: UnifiedSeries[], options: CompositeChartOptions = {}) {
    super(data, options);
    this.allData = this.data.flatMap(s => s.data);
    this.hasBarData = this.data.some(s => s.renderType === 'bar');
    this.categoryLabels = this.extractCategoryLabels();
    this.createScales();
  }

  protected getDefaultOptions(): Required<CompositeChartOptions> {
    return {
      title: '',
      xLabel: '',
      yLabel: ''
    };
  }

  protected getColorDomain(): string[] {
    return this.data.map((s, i) => s.name || `series_${i}`);
  }

  private extractCategoryLabels(): string[] {
    // Extract unique category labels from bar data
    const labels = new Set<string>();
    for (const series of this.data) {
      if (series.renderType === 'bar') {
        for (const point of series.data) {
          if (point.label) {
            labels.add(point.label);
          }
        }
      }
    }
    return Array.from(labels).sort();
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;

    // X scale - handle mixed categorical and continuous data
    if (this.hasBarData && this.categoryLabels.length > 0) {
      // Use categorical scale when bar data is present
      this.xScale = scaleBand()
        .domain(this.categoryLabels)
        .range([0, innerWidth])
        .padding(0.1);
    } else {
      // Use continuous scale for line/scatter only
      const xExtent = extent(this.allData, d => d.x) as [number, number];
      this.xScale = this.createOptimalScale(
        xExtent,
        [0, innerWidth],
        true,
        'xlim'
      );
    }

    // Y scale - always continuous
    const yExtent = extent(this.allData, d => d.y) as [number, number];
    this.yScale = this.createOptimalScale(
      yExtent,
      [innerHeight, 0],
      true,
      'ylim'
    );
  }

  protected renderXAxis(): void {
    const { innerHeight } = this.dimensions;
    const { text, axis } = this.themeColors;
    const { xticks = 5 } = this.options;
    
    // Skip rendering if xticks is 0
    if (xticks === 0) return;

    if (this.hasBarData && this.categoryLabels.length > 0) {
      // Categorical axis for bar data
      this.categoryLabels.forEach(label => {
        const x = this.xScale(label) + this.xScale.bandwidth() / 2;
        this.svgElements.push(
          `<line x1="${x}" y1="${innerHeight}" x2="${x}" y2="${innerHeight + 5}" stroke="${axis}" stroke-width="1"/>`
        );
        this.svgElements.push(
          `<text x="${x}" y="${innerHeight + 18}" text-anchor="middle" font-size="12" fill="${text}">${label}</text>`
        );
      });
    } else {
      // Continuous axis for line/scatter data
      const xTicks = this.xScale.ticks(xticks);
      xTicks.forEach((tick: number) => {
        const x = this.xScale(tick);
        this.svgElements.push(
          `<line x1="${x}" y1="${innerHeight}" x2="${x}" y2="${innerHeight + 5}" stroke="${axis}" stroke-width="1"/>`
        );
        const xExtent = extent(this.allData, d => d.x) as [number, number];
        const dataRange = xExtent[1] - xExtent[0];
        this.svgElements.push(
          `<text x="${x}" y="${innerHeight + 18}" text-anchor="middle" font-size="12" fill="${text}">${this.formatTickValueSmart(tick, dataRange)}</text>`
        );
      });
    }

    // X-axis line
    this.svgElements.push(
      `<line x1="0" y1="${innerHeight}" x2="${this.dimensions.innerWidth}" y2="${innerHeight}" stroke="${axis}" stroke-width="1"/>`
    );
  }

  protected renderYAxis(): void {
    const { text, axis } = this.themeColors;
    const { yticks = 5 } = this.options;
    
    // Skip rendering if yticks is 0
    if (yticks === 0) return;

    const yTicks = this.yScale.ticks(yticks);
    yTicks.forEach((tick: number) => {
      const y = this.yScale(tick);
      this.svgElements.push(
        `<line x1="-5" y1="${y}" x2="0" y2="${y}" stroke="${axis}" stroke-width="1"/>`
      );
      const yExtent = extent(this.allData, d => d.y) as [number, number];
      const dataRange = yExtent[1] - yExtent[0];
      this.svgElements.push(
        `<text x="-10" y="${y + 4}" text-anchor="end" font-size="12" fill="${text}">${this.formatTickValueSmart(tick, dataRange)}</text>`
      );
    });

    // Y-axis line
    this.svgElements.push(
      `<line x1="0" y1="0" x2="0" y2="${this.dimensions.innerHeight}" stroke="${axis}" stroke-width="1"/>`
    );
  }

  protected renderChartElements(): void {
    const defaultColors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];

    this.data.forEach((series, seriesIndex) => {
      const colorKey = series.name || `series_${seriesIndex}`;
      const color = series.color || this.colorScale(colorKey) || defaultColors[seriesIndex % defaultColors.length];

      switch (series.renderType) {
        case 'line':
          this.renderLineSeries(series, color);
          break;
        case 'scatter':
          this.renderScatterSeries(series, color);
          break;
        case 'bar':
          this.renderBarSeries(series, color);
          break;
        case 'histogram':
          this.renderHistogramSeries(series, color);
          break;
      }
    });
  }

  private renderLineSeries(series: UnifiedSeries, color: string): void {
    if (series.data.length < 2) return;

    const linePoints = series.data.map(d => {
      const x = this.hasBarData ? this.mapContinuousToBarScale(d.x) : this.xScale(d.x);
      const y = this.yScale(d.y);
      return `${x},${y}`;
    });

    const pathData = `M${linePoints.join('L')}`;
    this.svgElements.push(
      `<path d="${pathData}" fill="none" stroke="${color}" stroke-width="2" opacity="0.8"/>`
    );
  }

  private renderScatterSeries(series: UnifiedSeries, color: string): void {
    series.data.forEach(point => {
      const x = this.hasBarData ? this.mapContinuousToBarScale(point.x) : this.xScale(point.x);
      const y = this.yScale(point.y);
      const radius = point.size ? Math.sqrt(point.size) * 2 : 4;

      this.svgElements.push(
        `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="0.7"/>`
      );
    });
  }

  private renderBarSeries(series: UnifiedSeries, color: string): void {
    series.data.forEach(point => {
      if (point.label) {
        const x = this.xScale(point.label);
        const y = this.yScale(point.y);
        const height = this.dimensions.innerHeight - y;
        const width = this.xScale.bandwidth();

        this.svgElements.push(
          `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" opacity="0.8"/>`
        );
      }
    });
  }

  private renderHistogramSeries(series: UnifiedSeries, color: string): void {
    // Render histogram as bars with continuous x positioning
    series.data.forEach(point => {
      if (point.binStart !== undefined && point.binEnd !== undefined) {
        const x1 = this.hasBarData ? this.mapContinuousToBarScale(point.binStart) : this.xScale(point.binStart);
        const x2 = this.hasBarData ? this.mapContinuousToBarScale(point.binEnd) : this.xScale(point.binEnd);
        const y = this.yScale(point.y);
        const height = this.dimensions.innerHeight - y;
        const width = Math.abs(x2 - x1);

        this.svgElements.push(
          `<rect x="${Math.min(x1, x2)}" y="${y}" width="${width}" height="${height}" fill="${color}" opacity="0.6" stroke="${color}" stroke-width="1"/>`
        );
      }
    });
  }

  private mapContinuousToBarScale(value: number): number {
    // Map continuous values to categorical bar scale positions
    // This is a simplified mapping - could be improved with better interpolation
    const normalizedValue = (value - min(this.allData, d => d.x)!) / (max(this.allData, d => d.x)! - min(this.allData, d => d.x)!);
    return normalizedValue * this.dimensions.innerWidth;
  }

  protected renderUnifiedLegend(): void {
    // Filter series that have non-empty names
    const seriesWithNames = this.data.filter(s => s.name && s.name.trim() !== "");
    
    // Show legend if we have any named series
    if (seriesWithNames.length > 0) {
      const labels = seriesWithNames.map(s => s.name);
      const colors = seriesWithNames.map((s, i) => {
        const colorKey = s.name || `series_${i}`;
        return s.color || this.colorScale(colorKey);
      });
      this.renderLegendWithData(labels, colors);
    }
  }

  protected renderLegendWithData(labels: string[], colors: string[]): void {
    if (!labels.length) return;
    
    const { legendStyle } = this.options;
    const { x, y, orientation } = this.calculateLegendPosition(labels);
    
    if (legendStyle === 'tags') {
      this.renderTagLegend(labels, colors, x, y, orientation);
    } else {
      // Use line chart legend style for composite charts
      this.renderCompositeChartLegend(labels, colors, x, y, orientation);
    }
  }

  protected renderCompositeChartLegend(labels: string[], colors: string[], x: number, y: number, orientation: 'vertical' | 'horizontal' = 'vertical'): void {
    if (!labels.length) return;

    const { text } = this.themeColors;
    
    if (orientation === 'horizontal') {
      // Horizontal legend layout for top/bottom positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemX = x + i * 80; // 80px spacing between items
        const itemY = y;
        
        // Draw line indicator (suitable for mixed chart types)
        this.svgElements.push(
          `<line x1="${itemX}" y1="${itemY + 6}" x2="${itemX + 15}" y2="${itemY + 6}" stroke="${color}" stroke-width="2"/>`
        );
        
        // Add text label
        this.svgElements.push(
          `<text x="${itemX + 20}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
        );
      });
    } else {
      // Vertical legend layout for left/right positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemY = y + i * 18;
        
        // Draw line indicator (suitable for mixed chart types)
        this.svgElements.push(
          `<line x1="${x}" y1="${itemY + 6}" x2="${x + 15}" y2="${itemY + 6}" stroke="${color}" stroke-width="2"/>`
        );
        
        // Add text label
        this.svgElements.push(
          `<text x="${x + 20}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
        );
      });
    }
  }
}