/**
 * LineChart - Extends BaseChart for line chart specific functionality
 */

import { extent } from "https://esm.sh/d3-array@3";
import { BaseChart, BaseChartOptions } from "./BaseChart.ts";

export interface LineData {
  x: number;
  y: number;
}

export interface LineSeries {
  name: string;
  data: LineData[];
  color?: string;
}

export interface LineChartOptions extends BaseChartOptions {
  showPoints?: boolean;
  curveType?: 'linear' | 'smooth';
  disjoint?: boolean;
  continuity?: 'left' | 'right';
}

interface LineChartInput {
  data: LineSeries[];
  options?: LineChartOptions;
}

export class LineChart extends BaseChart<LineSeries[], LineChartOptions> {
  private xScale: any;
  private yScale: any;
  private allData: LineData[];

  constructor(data: LineSeries[], options: LineChartOptions = {}) {
    super(data, options);
    this.allData = this.data.flatMap(s => s.data);
    this.createScales();
  }

  protected getDefaultOptions(): Required<LineChartOptions> {
    return {
      title: '',
      xLabel: '',
      yLabel: '',
      showPoints: false,
      curveType: 'linear',
      disjoint: false,
      continuity: 'right'
    };
  }

  protected getColorDomain(): string[] {
    return this.data.map((s, i) => s.name || `series_${i}`);
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;

    // X scale (linear) - supports xlim
    this.xScale = this.createOptimalScale(
      extent(this.allData, d => d.x)!,
      [0, innerWidth],
      true,
      'xlim'  // use xlim for X-axis
    );

    // Y scale (linear) - supports ylim
    this.yScale = this.createOptimalScale(
      extent(this.allData, d => d.y)!,
      [innerHeight, 0],
      true,
      'ylim'  // use ylim for Y-axis
    );
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
    const { showPoints, disjoint, continuity } = this.options;

    this.data.forEach((seriesData, i) => {
      const colorKey = seriesData.name || `series_${i}`;
      const color = seriesData.color || this.colorScale(colorKey);
      
      if (disjoint) {
        // Render disjoint segments
        this.renderDisjointSegments(seriesData, color);
      } else {
        // Create continuous line path
        if (seriesData.data.length > 1) {
          const linePoints = seriesData.data.map(d => `${this.xScale(d.x)},${this.yScale(d.y)}`);
          const pathData = `M${linePoints.join('L')}`;
          
          this.svgElements.push(
            `<path d="${pathData}" fill="none" stroke="${color}" stroke-width="2"/>`
          );
        }

        // Draw points if explicitly requested
        if (showPoints) {
          seriesData.data.forEach(point => {
            const cx = this.xScale(point.x);
            const cy = this.yScale(point.y);
            
            this.svgElements.push(
              `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" stroke="none"/>`
            );
          });
        }
      }
    });
  }

  private renderDisjointSegments(seriesData: LineSeries, color: string): void {
    const { continuity } = this.options;
    const data = seriesData.data.sort((a, b) => a.x - b.x); // Ensure sorted by x
    
    // Draw segments between consecutive points
    for (let i = 0; i < data.length - 1; i++) {
      const start = data[i];
      const end = data[i + 1];
      
      const x1 = this.xScale(start.x);
      const y1 = this.yScale(start.y);
      const x2 = this.xScale(end.x);
      const y2 = this.yScale(end.y);
      
      // Draw horizontal line segment
      this.svgElements.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${color}" stroke-width="2"/>`
      );
      
      // Draw vertical connection (if values differ)
      if (start.y !== end.y) {
        this.svgElements.push(
          `<line x1="${x2}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/>`
        );
      }
      
      // Add endpoint circles based on continuity
      if (continuity === 'right') {
        // Right continuous: filled at left (start), hollow at right (end)
        this.svgElements.push(
          `<circle cx="${x1}" cy="${y1}" r="3" fill="${color}" stroke="none"/>`
        );
        this.svgElements.push(
          `<circle cx="${x2}" cy="${y1}" r="3" fill="none" stroke="${color}" stroke-width="2"/>`
        );
      } else {
        // Left continuous: hollow at left (start), filled at right (end)
        this.svgElements.push(
          `<circle cx="${x1}" cy="${y1}" r="3" fill="none" stroke="${color}" stroke-width="2"/>`
        );
        this.svgElements.push(
          `<circle cx="${x2}" cy="${y1}" r="3" fill="${color}" stroke="none"/>`
        );
      }
    }
    
    // Handle final point
    const lastPoint = data[data.length - 1];
    const lastX = this.xScale(lastPoint.x);
    const lastY = this.yScale(lastPoint.y);
    
    if (continuity === 'right') {
      this.svgElements.push(
        `<circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}" stroke="none"/>`
      );
    } else {
      this.svgElements.push(
        `<circle cx="${lastX}" cy="${lastY}" r="3" fill="none" stroke="${color}" stroke-width="2"/>`
      );
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
      // Use custom line chart legend with points if needed
      this.renderLineChartLegend(labels, colors, x, y, orientation);
    }
  }

  protected renderLineChartLegend(labels: string[], colors: string[], x: number, y: number, orientation: 'vertical' | 'horizontal' = 'vertical'): void {
    if (!labels.length) return;

    const { text } = this.themeColors;
    const { showPoints, disjoint } = this.options;
    
    if (orientation === 'horizontal') {
      // Horizontal legend layout for top/bottom positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemX = x + i * 95; // 95px spacing between items
        const itemY = y;
        
        this.svgElements.push(
          `<line x1="${itemX}" y1="${itemY + 6}" x2="${itemX + 15}" y2="${itemY + 6}" stroke="${color}" stroke-width="2"/>`
        );
        
        if (showPoints || disjoint) {
          this.svgElements.push(
            `<circle cx="${itemX + 7}" cy="${itemY + 6}" r="2" fill="${color}"/>`
          );
        }
        
        this.svgElements.push(
          `<text x="${itemX + 20}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
        );
      });
    } else {
      // Vertical legend layout for left/right positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemY = y + i * 18;
        
        this.svgElements.push(
          `<line x1="${x}" y1="${itemY + 6}" x2="${x + 15}" y2="${itemY + 6}" stroke="${color}" stroke-width="2"/>`
        );
        
        if (showPoints || disjoint) {
          this.svgElements.push(
            `<circle cx="${x + 7}" cy="${itemY + 6}" r="2" fill="${color}"/>`
          );
        }
        
        this.svgElements.push(
          `<text x="${x + 20}" y="${itemY + 10}" fill="${text}" font-size="10px">${label}</text>`
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
    (data: LineSeries[], options?: LineChartOptions) => new LineChart(data, options),
    (chart: LineChart) => chart.render(),
    'Usage: deno run --allow-all LineChart.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{name: string, data: [{x: number, y: number}, ...]}, ...]}'
  );
}

export { LineChart as createLineChart };