/**
 * HeatmapChart - 2D matrix visualization with color mapping
 * Supports text annotations, multiple colormaps, and interpolation modes
 */

import { BaseChart, BaseChartOptions } from "./BaseChart.ts";
import { scaleSequential, scaleLinear } from "https://esm.sh/d3-scale@4";
import { extent } from "https://esm.sh/d3-array@3";
import { axisBottom, axisLeft } from "https://esm.sh/d3-axis@3";
import { interpolate } from "https://esm.sh/d3-interpolate@3";
import { 
  interpolateViridis, 
  interpolateBlues, 
  interpolateGreys, 
  interpolateRdBu, 
  interpolateRdYlBu,
  interpolatePlasma,
  interpolateInferno
} from "https://esm.sh/d3-scale-chromatic@3";

export interface HeatmapData {
  x: number;        // Column index
  y: number;        // Row index
  value: number;    // Cell value for color mapping
  text?: string;    // Optional annotation text
}

export interface HeatmapChartOptions extends BaseChartOptions {
  colormap?: string;         // 'viridis', 'Blues', 'Grays', 'RdBu', 'coolwarm'
  interpolation?: string;    // 'nearest', 'bilinear'
  rows?: number;             // Number of matrix rows
  cols?: number;             // Number of matrix columns
  cellBorder?: boolean;      // Show cell borders
  textColor?: string;        // Color for annotation text
  fontSize?: number;         // Font size for annotations
  aspect?: 'auto' | 'equal'; // Cell aspect ratio: 'auto' fills space, 'equal' forces square cells
}

export class HeatmapChart extends BaseChart<HeatmapData[], HeatmapChartOptions> {
  private cellWidth!: number;
  private cellHeight!: number;
  private colorScale!: any;

  constructor(data: HeatmapData[], options: HeatmapChartOptions = {}) {
    super(data, options);
    this.createScales();
  }

  private createScales(): void {
    const { colormap = 'viridis', rows = 1, cols = 1, aspect = 'auto' } = this.options;
    const { innerWidth, innerHeight } = this.dimensions;
    
    // Calculate cell dimensions based on aspect ratio setting
    if (aspect === 'equal') {
      // Force square cells - use the smaller dimension to ensure cells fit
      const cellSize = Math.min(innerWidth / cols, innerHeight / rows);
      this.cellWidth = cellSize;
      this.cellHeight = cellSize;
    } else {
      // Auto aspect - fill available space (original behavior)
      this.cellWidth = innerWidth / cols;
      this.cellHeight = innerHeight / rows;
    }
    
    // Validate dimensions
    if (this.cellWidth <= 0 || this.cellHeight <= 0) {
      console.error(`Invalid cell dimensions: ${this.cellWidth}x${this.cellHeight} (inner: ${innerWidth}x${innerHeight}, matrix: ${rows}x${cols})`);
    }

    // Create color scale based on data values
    const values = this.data.map(d => d.value);
    const [minValue, maxValue] = extent(values) as [number, number];
    
    // Validate color scale domain
    if (minValue === undefined || maxValue === undefined) {
      console.error('Invalid data values for color scale:', values);
    }
    
    this.colorScale = this.createColorScale(colormap, minValue, maxValue);
  }

  protected getDefaultOptions(): Required<HeatmapChartOptions> {
    const baseDefaults: Required<BaseChartOptions> = {
      width: 320,
      height: 240,
      margin: { top: 40, right: 60, bottom: 60, left: 60 },
      title: '',
      xLabel: '',
      yLabel: '',
      colors: [],
      theme: 'light',
      forceOrigin: false,
      legendPosition: 'right',
      legendOffset: [0, 0],
      legendStyle: 'standard',
      tagPadding: 8,
      tagSpacing: 4,
      tagBorderRadius: 4,
      xlim: [null, null],
      ylim: [null, null],
      preserveAspectRatio: 'scale',
      tickStrategy: 'auto',
      aspectRatio: 'auto',
      xticks: 5,
      yticks: 5
    };

    const heatmapDefaults = {
      colormap: 'viridis',
      interpolation: 'nearest',
      rows: 1,
      cols: 1,
      cellBorder: true,
      textColor: '#333',
      fontSize: 12,
      aspect: 'auto'
    };

    return { ...baseDefaults, ...heatmapDefaults };
  }

  protected getColorDomain(): string[] {
    // For heatmaps, we don't use categorical colors, return empty array
    return [];
  }

  protected renderChartElements(): void {
    const { cellBorder = true, textColor = '#333', fontSize = 12 } = this.options;
    const { text } = this.themeColors;

    // Create heatmap cells
    this.data.forEach(d => {
      const x = d.x * this.cellWidth;
      const y = d.y * this.cellHeight;
      const fillColor = this.colorScale(d.value);
      const strokeColor = cellBorder ? text : 'none';
      const strokeWidth = cellBorder ? 0.5 : 0;

      this.svgElements.push(
        `<rect x="${x}" y="${y}" width="${this.cellWidth}" height="${this.cellHeight}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`
      );

      // Add text annotation if provided
      if (d.text !== undefined && d.text !== '') {
        const textX = x + this.cellWidth / 2;
        const textY = y + this.cellHeight / 2;
        this.svgElements.push(
          `<text x="${textX}" y="${textY}" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" font-size="${fontSize}px" font-family="sans-serif">${d.text}</text>`
        );
      }
    });
  }

  protected renderXAxis(): void {
    const { rows = 1, cols = 1, xticks = 5 } = this.options;
    const { innerWidth, innerHeight } = this.dimensions;
    const { axis, text } = this.themeColors;

    // Skip rendering if xticks is 0
    if (xticks === 0) return;

    // Create X axis with smart tick spacing to prevent overlap
    if (cols > 1) {
      // Use user-specified xticks or auto-calculate based on space
      const maxTicks = Math.floor(innerWidth / 30);
      const requestedTicks = Math.min(xticks, cols); // Don't exceed matrix size
      const effectiveTicks = Math.min(requestedTicks, maxTicks);
      const tickStep = Math.max(1, Math.ceil(cols / effectiveTicks));
      
      for (let i = 0; i < cols; i += tickStep) {
        const x = i * this.cellWidth + this.cellWidth / 2;
        this.svgElements.push(
          `<line x1="${x}" y1="${innerHeight}" x2="${x}" y2="${innerHeight + 6}" stroke="${axis}" stroke-width="1"/>`
        );
        this.svgElements.push(
          `<text x="${x}" y="${innerHeight + 20}" text-anchor="middle" fill="${text}" font-size="12px">${i}</text>`
        );
      }
      
      // Only show the last column if it's far enough from the previous tick to avoid overlap
      const lastRegularTick = Math.floor((cols - 1) / tickStep) * tickStep;
      const finalTick = cols - 1;
      const minDistance = Math.max(1, tickStep / 2); // Minimum 50% of tickStep spacing
      
      if (finalTick !== lastRegularTick && finalTick - lastRegularTick >= minDistance) {
        const lastX = finalTick * this.cellWidth + this.cellWidth / 2;
        this.svgElements.push(
          `<line x1="${lastX}" y1="${innerHeight}" x2="${lastX}" y2="${innerHeight + 6}" stroke="${axis}" stroke-width="1"/>`
        );
        this.svgElements.push(
          `<text x="${lastX}" y="${innerHeight + 20}" text-anchor="middle" fill="${text}" font-size="12px">${finalTick}</text>`
        );
      }
    }
  }

  protected renderYAxis(): void {
    const { rows = 1, cols = 1, yticks = 5 } = this.options;
    const { innerHeight } = this.dimensions;
    const { text, axis } = this.themeColors;

    // Skip rendering if yticks is 0
    if (yticks === 0) return;

    // Create Y axis with smart tick spacing to prevent overlap
    if (rows > 1) {
      // Use user-specified yticks or auto-calculate based on space
      const maxTicks = Math.floor(innerHeight / 20);
      const requestedTicks = Math.min(yticks, rows); // Don't exceed matrix size
      const effectiveTicks = Math.min(requestedTicks, maxTicks);
      const tickStep = Math.max(1, Math.ceil(rows / effectiveTicks));
      
      for (let i = 0; i < rows; i += tickStep) {
        const y = i * this.cellHeight + this.cellHeight / 2;
        this.svgElements.push(
          `<line x1="-6" y1="${y}" x2="0" y2="${y}" stroke="${axis}" stroke-width="1"/>`
        );
        this.svgElements.push(
          `<text x="-10" y="${y + 4}" text-anchor="end" fill="${text}" font-size="12px">${i}</text>`
        );
      }
      
      // Only show the last row if it's far enough from the previous tick to avoid overlap
      const lastRegularTick = Math.floor((rows - 1) / tickStep) * tickStep;
      const finalTick = rows - 1;
      const minDistance = Math.max(1, tickStep / 2); // Minimum 50% of tickStep spacing
      
      if (finalTick !== lastRegularTick && finalTick - lastRegularTick >= minDistance) {
        const lastY = finalTick * this.cellHeight + this.cellHeight / 2;
        this.svgElements.push(
          `<line x1="-6" y1="${lastY}" x2="0" y2="${lastY}" stroke="${axis}" stroke-width="1"/>`
        );
        this.svgElements.push(
          `<text x="-10" y="${lastY + 4}" text-anchor="end" fill="${text}" font-size="12px">${finalTick}</text>`
        );
      }
    }
  }

  private createColorScale(colormap: string | string[], minValue: number, maxValue: number) {
    // Handle array input for custom color gradients
    if (Array.isArray(colormap)) {
      return this.createCustomColorScale(colormap, minValue, maxValue);
    }
    
    const safeColormap = colormap || 'viridis';
    
    // Check for predefined D3 interpolators first
    switch (safeColormap.toLowerCase()) {
      case 'viridis':
        return scaleSequential(interpolateViridis).domain([minValue, maxValue]);
      case 'blues':
        return scaleSequential(interpolateBlues).domain([minValue, maxValue]);
      case 'grays':
      case 'gray':
      case 'greys':
        return scaleSequential(interpolateGreys).domain([minValue, maxValue]);
      case 'rdbu':
        return scaleSequential(interpolateRdBu).domain([maxValue, minValue]); // Reverse for diverging
      case 'coolwarm':
        return scaleSequential(interpolateRdYlBu).domain([maxValue, minValue]); // Reverse for diverging
      case 'plasma':
        return scaleSequential(interpolatePlasma).domain([minValue, maxValue]);
      case 'inferno':
        return scaleSequential(interpolateInferno).domain([minValue, maxValue]);
      case 'd3pm':
        // Use all 4 d3pm colors as gradient
        return this.createCustomColorScale(['white', 'red', 'yellow', 'blue', 'green'], minValue, maxValue);
      default:
        // Check if it's a named color that should create a gradient
        return this.createNamedColorGradient(safeColormap, minValue, maxValue);
    }
  }
  
  private createCustomColorScale(colors: string[], minValue: number, maxValue: number) {
    // Process color names using BaseChart's color mapping
    const processedColors = this.processColors(colors);
    
    // Create custom interpolator for the color array
    const createInterpolator = (colors: string[]) => {
      return (t: number) => {
        if (colors.length === 1) return colors[0];
        if (colors.length === 2) return interpolate(colors[0], colors[1])(t);
        
        // For multiple colors, map t to segments
        const segments = colors.length - 1;
        const segment = Math.min(Math.floor(t * segments), segments - 1);
        const localT = (t * segments) - segment;
        
        return interpolate(colors[segment], colors[segment + 1])(localT);
      };
    };
    
    return scaleSequential(createInterpolator(processedColors))
      .domain([minValue, maxValue]);
  }
  
  private createNamedColorGradient(colorName: string, minValue: number, maxValue: number) {
    // Check if it's a d3pm named color
    const namedColor = BaseChart.NAMED_COLORS[colorName.toLowerCase()];
    if (namedColor) {
      // Create white-to-namedColor gradient
      return this.createCustomColorScale(['white', namedColor], minValue, maxValue);
    }
    
    // If not a recognized color name, fall back to viridis
    return scaleSequential(interpolateViridis).domain([minValue, maxValue]);
  }
}

// CLI handling
if (import.meta.main) {
  BaseChart.handleCLI(
    (data: HeatmapData[], options?: HeatmapChartOptions) => new HeatmapChart(data, options),
    (chart: HeatmapChart) => chart.render(),
    'Usage: deno run --allow-all HeatmapChart.ts \'{"data": [...], "options": {...}}\'',
    'Error: Invalid data format. Expected {data: [{x: number, y: number, value: number, text?: string}, ...]}'
  );
}