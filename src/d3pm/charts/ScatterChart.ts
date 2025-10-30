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
  labelColor?: string;
  labelPosition?: 'center' | 'above' | 'below' | 'left' | 'right';
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
    const baseDefaults = this.getBaseDefaults();
    return {
      ...baseDefaults,
      pointSize: 4,
      opacity: 1.0,
      labelColor: '',  // Will use theme text color if empty
      labelPosition: 'above'
    };
  }

  protected getColorDomain(): string[] {
    return this.data.map((s, i) => s.name || `series_${i}`);
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
    const { xticks = 5, tickNumbers = 'nice' } = this.options;
    
    // Skip rendering if xticks is 0
    if (xticks === 0) return;
    
    // Calculate data range for smart formatting
    const xExtent = extent(this.allData, d => d.x)!;
    const dataRange = xExtent[1] - xExtent[0];
    
    // Generate tick values based on tickNumbers strategy
    let tickValues: number[];
    if (tickNumbers === 'nice') {
      tickValues = this.generateNiceTickValues(this.xScale.domain(), xticks);
    } else {
      tickValues = this.xScale.ticks(xticks);
    }
    
    tickValues.forEach((tick: number) => {
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
    const { yticks = 5, tickNumbers = 'nice' } = this.options;
    
    // Skip rendering if yticks is 0
    if (yticks === 0) return;
    
    // Calculate data range for smart formatting
    const yExtent = extent(this.allData, d => d.y)!;
    const dataRange = yExtent[1] - yExtent[0];
    
    // Generate tick values based on tickNumbers strategy
    let tickValues: number[];
    if (tickNumbers === 'nice') {
      tickValues = this.generateNiceTickValues(this.yScale.domain(), yticks);
    } else {
      tickValues = this.yScale.ticks(yticks);
    }
    
    tickValues.forEach((tick: number) => {
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
    const { pointSize, opacity, labelColor, labelPosition } = this.options;
    const { text } = this.themeColors;

    this.data.forEach((seriesData, i) => {
      const colorKey = seriesData.name || `series_${i}`;
      const seriesColor = seriesData.color || this.colorScale(colorKey);

      seriesData.data.forEach(point => {
        const cx = this.xScale(point.x);
        const cy = this.yScale(point.y);
        const radius = this.hasSizeData ? this.sizeScale(point.size || pointSize) : pointSize;
        const pointColor = point.color || seriesColor;

        // Simple solid circle
        this.svgElements.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${pointColor}" opacity="${opacity}"/>`
        );

        // Add point labels if they exist
        if (point.label) {
          const textColor = labelColor || text;
          const { textX, textY, anchor } = this.calculateLabelPosition(cx, cy, radius, labelPosition);
          
          this.svgElements.push(
            `<text x="${textX}" y="${textY}" text-anchor="${anchor}" fill="${textColor}" font-size="10px">${point.label}</text>`
          );
        }
      });
    });
  }

  private calculateLabelPosition(cx: number, cy: number, radius: number, position: string): 
    { textX: number, textY: number, anchor: string } {
    const padding = 3;
    
    switch (position) {
      case 'center':
        return { textX: cx, textY: cy + 3, anchor: 'middle' };  // +3 for vertical centering
      case 'above':
        return { textX: cx, textY: cy - radius - padding, anchor: 'middle' };
      case 'below':
        return { textX: cx, textY: cy + radius + padding + 8, anchor: 'middle' };  // +8 for text height
      case 'left':
        return { textX: cx - radius - padding, textY: cy + 3, anchor: 'end' };
      case 'right':
        return { textX: cx + radius + padding, textY: cy + 3, anchor: 'start' };
      default:
        return { textX: cx, textY: cy - radius - padding, anchor: 'middle' };  // fallback to above
    }
  }

  protected renderUnifiedLegend(): void {
    const hasNamedSeries = this.data.some(s => s.name && s.name.trim() !== "");
    
    // Only show legend for multiple series with names
    if (this.data.length > 1 && hasNamedSeries) {
      const labels = this.data.map(s => s.name || `Series ${this.data.indexOf(s) + 1}`);
      const colors = this.data.map((s, i) => {
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
      // Use custom scatter chart legend with circles
      this.renderScatterChartLegend(labels, colors, x, y, orientation);
    }
  }

  protected renderScatterChartLegend(labels: string[], colors: string[], x: number, y: number, orientation: 'vertical' | 'horizontal' = 'vertical'): void {
    if (!labels.length) return;

    const { text } = this.themeColors;
    const { opacity } = this.options;
    
    if (orientation === 'horizontal') {
      // Horizontal legend layout for top/bottom positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemX = x + i * 80; // 80px spacing between items
        const itemY = y;
        
        this.svgElements.push(
          `<circle cx="${itemX + 6}" cy="${itemY + 6}" r="4" fill="${color}" opacity="${opacity}"/>`
        );
        
        this.svgElements.push(
          `<text x="${itemX + 15}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
        );
      });
    } else {
      // Vertical legend layout for left/right positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemY = y + i * 18;
        
        this.svgElements.push(
          `<circle cx="${x + 6}" cy="${itemY + 6}" r="4" fill="${color}" opacity="${opacity}"/>`
        );
        
        this.svgElements.push(
          `<text x="${x + 15}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
        );
      });
    }
  }

  protected calculateOriginPosition(): { x: number, y: number } | null {
    // Calculate where (0,0) is positioned within the chart area
    if (!this.xScale || !this.yScale) return null;
    
    const xDomain = this.xScale.domain();
    const yDomain = this.yScale.domain();
    
    // Check if origin is within the visible domain
    if (0 >= xDomain[0] && 0 <= xDomain[1] && 0 >= yDomain[0] && 0 <= yDomain[1]) {
      return {
        x: this.xScale(0),
        y: this.yScale(0)
      };
    }
    
    return null; // Origin is outside visible area
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