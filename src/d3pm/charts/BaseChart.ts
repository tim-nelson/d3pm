/**
 * BaseChart - Abstract base class for D3.js chart generation
 * Contains shared functionality for all chart types
 */

// Import D3 scale and utility functions
import { scaleLinear, scaleOrdinal } from "https://esm.sh/d3-scale@4";
import { ChartComponent, ComposedChart, ChartComposer } from "./ChartComposer.ts";

// Shared interfaces
export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BaseChartOptions {
  width?: number;
  height?: number;
  margin?: Margin;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  colors?: string[];
  theme?: 'light' | 'dark';
  forceOrigin?: boolean;
  legendPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right' | 'top' | 'bottom';
  legendOffset?: [number, number];
  legendStyle?: 'standard' | 'tags';
  tagPadding?: number;
  tagSpacing?: number;
  tagBorderRadius?: number;
  xlim?: (number | null)[];
  ylim?: (number | null)[];
  preserveAspectRatio?: 'scale' | 'clip';
  tickStrategy?: 'skip' | 'rotate' | 'auto';
  aspectRatio?: 'auto' | 'equal';
  xticks?: number;
  yticks?: number;
}

export interface ThemeColors {
  background: string;
  text: string;
  axis: string;
}

export interface ChartDimensions {
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  margin: Margin;
}

// Abstract base class
export abstract class BaseChart<TData, TOptions extends BaseChartOptions> implements ChartComponent {
  protected options: Required<TOptions>;
  protected dimensions: ChartDimensions;
  protected colorScale: any;
  protected themeColors: ThemeColors;
  protected svgElements: string[] = [];

  constructor(protected data: TData, options: TOptions) {
    this.options = this.mergeWithDefaults(options);
    this.dimensions = this.calculateDimensions();
    this.themeColors = this.getThemeColors();
    this.colorScale = this.createColorScale();
  }

  // Named color mapping
  protected static readonly NAMED_COLORS: Record<string, string> = {
    'red': '#CF7280',
    'yellow': '#DBB55C', 
    'blue': '#658DCD',
    'green': '#96ceb4',
    // Add some additional useful colors
    'orange': '#f39c12',
    'purple': '#9b59b6',
    'pink': '#e91e63',
    'teal': '#1abc9c',
    'grey': '#95a5a6',
    'gray': '#95a5a6'
  };

  // Shared default values
  protected getBaseDefaults() {
    return {
      width: 600,
      height: 400,
      margin: { top: 40, right: 20, bottom: 50, left: 55 },
      colors: ['#CF7280', '#DBB55C', '#658DCD', '#96ceb4'],
      theme: this.detectTheme(),
      forceOrigin: true,
      legendPosition: 'right' as const,
      legendOffset: [0, 0] as [number, number],
      legendStyle: 'standard' as const,
      tagPadding: 2,
      tagSpacing: 4,
      tagBorderRadius: 3,
      preserveAspectRatio: 'scale' as const,
      tickStrategy: 'auto' as const,
      aspectRatio: 'auto' as const
    };
  }

  // Process colors, converting named colors to hex codes
  protected processColors(colors: string[]): string[] {
    return colors.map(color => {
      // Check if it's a named color
      const namedColor = BaseChart.NAMED_COLORS[color.toLowerCase()];
      if (namedColor) {
        return namedColor;
      }
      // Return as-is if it's already a hex code or other valid CSS color
      return color;
    });
  }

  protected detectTheme(): 'light' | 'dark' {
    try {
      // Try to detect dark theme from environment variables
      // VS Code sets TERM_PROGRAM=vscode and other env vars
      const vscodeTheme = globalThis.Deno?.env?.get("VSCODE_THEME"); // Custom env var if set
      
      // Check for explicit VS Code theme setting (if user sets this)
      if (vscodeTheme === "dark") {
        return 'dark';
      }
      
      // Check for common dark mode indicators
      const term = globalThis.Deno?.env?.get("TERM");
      if (term && (term.includes("dark") || term.includes("256color"))) {
        return 'dark';
      }
    } catch {
      // Ignore errors if Deno env is not available
    }
    
    // Default to light theme (safe fallback)
    return 'dark' as const;
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract getDefaultOptions(): Required<TOptions>;
  protected abstract renderChartElements(): void;
  protected abstract getColorDomain(): string[];

  // Template method - defines the overall structure
  public render(): string {
    this.svgElements = [];
    
    this.renderBackground();
    this.renderTitle();
    this.renderLegendIfTop(); // Render legends at top position
    this.renderMainGroup();
    this.renderAxes();
    this.renderChartElements(); // Implemented by subclasses
    this.closeMainGroup();
    this.renderLegendIfNotTop(); // Render legends at other positions
    this.renderAxisLabels();
    
    return this.wrapSVG();
  }

  // Shared helper methods
  protected mergeWithDefaults(options: TOptions): Required<TOptions> {
    const baseDefaults = this.getBaseDefaults();
    const chartDefaults = this.getDefaultOptions();
    const merged = { ...baseDefaults, ...chartDefaults, ...options };
    
    // Process colors if provided (convert named colors to hex codes)
    if (merged.colors && merged.colors.length > 0) {
      merged.colors = this.processColors(merged.colors);
    }
    
    return merged;
  }

  protected calculateDimensions(): ChartDimensions {
    const { width, height, margin, legendPosition, legendStyle } = this.options;
    
    // Adjust margins for external legend positions
    let adjustedMargin = { ...margin };
    
    // Only adjust margins for external positions (top/bottom/left/right)
    if (legendPosition === 'top') {
      if (legendStyle === 'tags') {
        adjustedMargin.top = margin.top + this.calculateTagLegendHeight();
      } else {
        adjustedMargin.top = margin.top + 20; // Reduced standard legend height
      }
    } else if (legendPosition === 'bottom') {
      if (legendStyle === 'tags') {
        adjustedMargin.bottom = margin.bottom + this.calculateTagLegendHeight();
      } else {
        adjustedMargin.bottom = margin.bottom + 20; // Reduced standard legend height
      }
    }
    // Note: left/right positioning will be handled as overlays for now
    
    return {
      width,
      height,
      innerWidth: width - adjustedMargin.left - adjustedMargin.right,
      innerHeight: height - adjustedMargin.top - adjustedMargin.bottom,
      margin: adjustedMargin
    };
  }

  protected getThemeColors(): ThemeColors {
    const { theme } = this.options;
    return {
      background: theme === 'dark' ? '#00000000' : '#00000000',
      // background: theme === 'dark' ? '#1a1a1a' : '#ffffff',
      text: theme === 'dark' ? '#ffffff' : '#333333',
      axis: theme === 'dark' ? '#666666' : '#333333'
    };
  }

  protected createColorScale() {
    return scaleOrdinal<string>()
      .domain(this.getColorDomain())
      .range(this.options.colors);
  }

  protected renderBackground(): void {
    this.svgElements.push(
      `<rect width="${this.dimensions.width}" height="${this.dimensions.height}" fill="${this.themeColors.background}"/>`
    );
  }

  protected renderMainGroup(): void {
    this.svgElements.push(
      `<g transform="translate(${this.dimensions.margin.left},${this.dimensions.margin.top})">`
    );
  }

  protected closeMainGroup(): void {
    this.svgElements.push('</g>');
  }

  protected renderAxes(): void {
    this.renderXAxis();
    this.renderYAxis();
    this.renderAxisLines();
  }

  protected renderXAxis(): void {
    // To be overridden by subclasses with specific scale types
  }

  protected renderYAxis(): void {
    // To be overridden by subclasses with specific scale types
  }

  protected renderAxisLines(): void {
    const { innerWidth, innerHeight } = this.dimensions;
    const { axis } = this.themeColors;
    
    // Y axis line
    this.svgElements.push(
      `<line x1="0" y1="0" x2="0" y2="${innerHeight}" stroke="${axis}" stroke-width="1"/>`
    );
    
    // X axis line
    this.svgElements.push(
      `<line x1="0" y1="${innerHeight}" x2="${innerWidth}" y2="${innerHeight}" stroke="${axis}" stroke-width="1"/>`
    );
  }

  protected renderTitle(): void {
    const { title } = this.options;
    const { width } = this.dimensions;
    const { text } = this.themeColors;
    
    if (title) {
      this.svgElements.push(
        `<text x="${width/2}" y="20" text-anchor="middle" fill="${text}" font-size="16px" font-weight="500">${title}</text>`
      );
    }
  }

  protected renderAxisLabels(): void {
    const { xLabel, yLabel } = this.options;
    const { width, height } = this.dimensions;
    const { text } = this.themeColors;
    
    if (xLabel) {
      this.svgElements.push(
        `<text x="${width/2}" y="${height - 10}" text-anchor="middle" fill="${text}" font-size="12px">${xLabel}</text>`
      );
    }
    
    if (yLabel) {
      this.svgElements.push(
        `<text transform="rotate(-90)" y="15" x="${-height/2}" text-anchor="middle" fill="${text}" font-size="12px">${yLabel}</text>`
      );
    }
  }

  protected renderLegend(): void {
    // To be overridden by subclasses that need legends
  }

  protected renderLegendIfTop(): void {
    // Render legend at top position if needed
    if (this.options.legendPosition === 'top') {
      this.renderUnifiedLegend();
    }
  }

  protected renderLegendIfNotTop(): void {
    // Render legend at non-top positions
    if (this.options.legendPosition !== 'top') {
      this.renderUnifiedLegend();
    }
  }

  protected renderUnifiedLegend(): void {
    // To be overridden by subclasses that need legends
    // This will handle both tag and standard styles at all positions
  }

  protected renderStandardLegend(labels: string[], colors: string[], x: number, y: number, orientation: 'vertical' | 'horizontal' = 'vertical'): void {
    if (!labels.length) return;

    const { text } = this.themeColors;
    
    if (orientation === 'horizontal') {
      // Horizontal legend layout for top/bottom positions
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const itemX = x + i * 80; // 80px spacing between items
        const itemY = y;
        
        // Draw line indicator
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
        
        // Draw line indicator
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

  protected renderLegendWithData(labels: string[], colors: string[]): void {
    if (!labels.length) return;
    
    const { legendStyle } = this.options;
    const { x, y, orientation } = this.calculateLegendPosition(labels);
    
    if (legendStyle === 'tags') {
      this.renderTagLegend(labels, colors, x, y, orientation);
    } else {
      this.renderStandardLegend(labels, colors, x, y, orientation);
    }
  }

  protected calculateLegendWidth(labels: string[]): number {
    // Estimate text width (rough approximation: 6px per character)
    const maxLabelLength = Math.max(...labels.map(label => label.length));
    return Math.max(80, maxLabelLength * 6 + 30); // 30px for icon + padding
  }

  protected calculateLegendHeight(itemCount: number): number {
    return itemCount * 18 + 10; // 18px per item + padding
  }

  protected calculateTagLegendHeight(): number {
    return 18 + 0; // tag height + minimal margin for tighter layout
  }

  protected calculateTotalTagWidth(labels: string[]): number {
    const { tagSpacing, tagPadding } = this.options;
    let totalWidth = 0;
    
    labels.forEach((label, i) => {
      const textWidth = label.length * 6.2;
      const tagWidth = Math.ceil(textWidth + (tagPadding * 2)); // Use configurable padding
      totalWidth += tagWidth;
      if (i < labels.length - 1) {
        totalWidth += tagSpacing;
      }
    });
    
    return totalWidth;
  }

  protected renderTagLegend(labels: string[], colors: string[], x: number, y: number, orientation: 'vertical' | 'horizontal' = 'horizontal'): void {
    if (!labels.length) return;

    const { tagSpacing, tagBorderRadius, tagPadding } = this.options;
    const fontSize = 10;
    const tagHeight = 18;
    const horizontalPadding = tagPadding;
    
    if (orientation === 'horizontal') {
      // Horizontal layout (for top/bottom positions)
      let currentX = x;
      
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const textWidth = label.length * 6.2;
        const tagWidth = Math.ceil(textWidth + (horizontalPadding * 2));
        
        // Draw the tag rectangle
        this.svgElements.push(
          `<rect x="${currentX}" y="${y}" width="${tagWidth}" height="${tagHeight}" ` +
          `fill="${color}" rx="${tagBorderRadius}" ry="${tagBorderRadius}"/>`
        );
        
        // Position text in center of tag
        const textX = currentX + tagWidth / 2;
        const textY = y + tagHeight / 2 + 3.5;
        
        this.svgElements.push(
          `<text x="${textX}" y="${textY}" text-anchor="middle" ` +
          `fill="white" font-size="${fontSize}px" font-weight="500">${label}</text>`
        );
        
        currentX += tagWidth + tagSpacing;
      });
    } else {
      // Vertical layout (for left/right positions)
      let currentY = y;
      
      labels.forEach((label, i) => {
        const color = colors[i] || '#666';
        const textWidth = label.length * 6.2;
        const tagWidth = Math.ceil(textWidth + (horizontalPadding * 2));
        
        // Draw the tag rectangle
        this.svgElements.push(
          `<rect x="${x}" y="${currentY}" width="${tagWidth}" height="${tagHeight}" ` +
          `fill="${color}" rx="${tagBorderRadius}" ry="${tagBorderRadius}"/>`
        );
        
        // Position text in center of tag
        const textX = x + tagWidth / 2;
        const textY = currentY + tagHeight / 2 + 3.5;
        
        this.svgElements.push(
          `<text x="${textX}" y="${textY}" text-anchor="middle" ` +
          `fill="white" font-size="${fontSize}px" font-weight="500">${label}</text>`
        );
        
        currentY += tagHeight + tagSpacing;
      });
    }
  }

  protected calculateLegendPosition(labels: string[]): { x: number; y: number; orientation: 'vertical' | 'horizontal' } {
    const { width, height, margin } = this.dimensions;
    const { legendPosition, legendOffset, legendStyle } = this.options;
    const [offsetX, offsetY] = legendOffset;
    
    const legendWidth = this.calculateLegendWidth(labels);
    const legendHeight = this.calculateLegendHeight(labels.length);
    
    let x: number, y: number, orientation: 'vertical' | 'horizontal' = 'vertical';
    
    switch (legendPosition) {
      case 'top-left':
        x = margin.left + 10 + offsetX;
        y = margin.top + 10 + offsetY;
        break;
      case 'top-right':
        x = width - legendWidth - 10 + offsetX;
        y = margin.top + 10 + offsetY;
        break;
      case 'bottom-left':
        x = margin.left + 10 + offsetX;
        y = height - legendHeight - 10 + offsetY;
        break;
      case 'bottom-right':
        x = width - legendWidth - 10 + offsetX;
        y = height - legendHeight - 10 + offsetY;
        break;
      case 'left':
        x = 10 + offsetX;
        y = height / 2 - legendHeight / 2 + offsetY;
        break;
      case 'right':
        x = Math.max(width - legendWidth - 10, width - 150) + offsetX;
        y = margin.top + offsetY;
        break;
      case 'top':
        orientation = 'horizontal';
        if (legendStyle === 'tags') {
          // Tags: centered horizontally, positioned below title
          const totalTagWidth = this.calculateTotalTagWidth(labels);
          x = width / 2 - totalTagWidth / 2 + offsetX;
          y = 30 + offsetY; // Increased gap below title
        } else {
          // Standard: estimated spacing
          x = width / 2 - (labels.length * 80) / 2 + offsetX;
          y = 8 + offsetY; // Reduced top margin
        }
        break;
      case 'bottom':
        orientation = 'horizontal';
        if (legendStyle === 'tags') {
          const totalTagWidth = this.calculateTotalTagWidth(labels);
          x = width / 2 - totalTagWidth / 2 + offsetX;
          y = height - 22 + offsetY; // Reduced bottom margin
        } else {
          x = width / 2 - (labels.length * 80) / 2 + offsetX;
          y = height - 25 + offsetY; // Reduced bottom margin
        }
        break;
      default:
        // Default to right
        x = Math.max(width - legendWidth - 10, width - 150) + offsetX;
        y = margin.top + offsetY;
    }
    
    return { x, y, orientation };
  }

  protected shouldUseDynamicMargin(labels: string[]): boolean {
    const estimatedLegendWidth = this.calculateLegendWidth(labels);
    const currentRightMargin = this.dimensions.margin.right;
    return estimatedLegendWidth > currentRightMargin;
  }

  // Implement ChartComponent interface
  getDimensions(): { width: number; height: number } {
    return {
      width: this.dimensions.width,
      height: this.dimensions.height
    };
  }

  // Composition operators
  stack(other: ChartComponent): ComposedChart {
    return new ComposedChart(ChartComposer.stack(this, other));
  }

  sideBySide(other: ChartComponent, spacing?: number): ComposedChart {
    return new ComposedChart(ChartComposer.sideBySide(this, other, spacing));
  }

  vertical(other: ChartComponent, spacing?: number): ComposedChart {
    return new ComposedChart(ChartComposer.vertical(this, other, spacing));
  }

  protected wrapSVG(): string {
    const { width, height } = this.dimensions;
    const { preserveAspectRatio } = this.options;
    const svgContent = this.svgElements.join('\n    ');
    
    // Set preserveAspectRatio based on user preference
    const aspectRatioValue = preserveAspectRatio === 'clip' ? 'xMidYMid slice' : 'xMidYMid meet';
    
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${aspectRatioValue}" style="font-family: Arial, sans-serif;">
    ${svgContent}
</svg>`;
  }

  // Utility methods for subclasses
  protected formatTickValue(value: number, decimals = 1): string {
    return value.toFixed(decimals);
  }

  // Smart tick formatting that determines appropriate precision
  protected formatTickValueSmart(value: number, dataRange: number): string {
    // Determine appropriate decimal places based on data range
    let decimalPlaces: number;
    
    if (dataRange < 0.01) {
      decimalPlaces = 4;  // Very small range: 0.0001
    } else if (dataRange < 0.1) {
      decimalPlaces = 3;  // Small range: 0.001
    } else if (dataRange < 1) {
      decimalPlaces = 2;  // Medium range: 0.01
    } else if (dataRange < 10) {
      decimalPlaces = 2;  // Larger range: 0.01
    } else {
      decimalPlaces = 0;  // Large range: 0.1
    }
    
    return value.toFixed(decimalPlaces);
  }

  protected createLinearScale(domain: [number, number], range: [number, number]) {
    return scaleLinear()
      .domain(domain)
      .range(range);
  }

  protected createEqualScales(xDomain: [number, number], yDomain: [number, number], xRange: [number, number], yRange: [number, number]): { xScale: any, yScale: any } {
    // Calculate the data ranges
    const xDataRange = xDomain[1] - xDomain[0];
    const yDataRange = yDomain[1] - yDomain[0];
    
    // Calculate the pixel ranges  
    const xPixelRange = xRange[1] - xRange[0];
    const yPixelRange = Math.abs(yRange[1] - yRange[0]); // abs because y-range is usually [height, 0]
    
    // Calculate pixels per unit for each axis
    const xPixelsPerUnit = xPixelRange / xDataRange;
    const yPixelsPerUnit = yPixelRange / yDataRange;
    
    // Use the smaller pixels per unit to ensure both fit
    const pixelsPerUnit = Math.min(xPixelsPerUnit, yPixelsPerUnit);
    
    // Calculate the actual pixel ranges that will be used
    const actualXPixelRange = xDataRange * pixelsPerUnit;
    const actualYPixelRange = yDataRange * pixelsPerUnit;
    
    // Center the shorter axis in its available space
    let xStart = xRange[0];
    let yStart = yRange[0]; // Note: yRange is [height, 0] for typical charts
    
    if (actualXPixelRange < xPixelRange) {
      const padding = (xPixelRange - actualXPixelRange) / 2;
      xStart += padding;
    }
    
    if (actualYPixelRange < yPixelRange) {
      const padding = (yPixelRange - actualYPixelRange) / 2;
      if (yRange[0] > yRange[1]) { // y goes from bottom to top (typical)
        yStart -= padding;
      } else {
        yStart += padding;
      }
    }
    
    // Create scales with equal pixel/unit ratios
    const xScale = scaleLinear()
      .domain(xDomain)
      .range([xStart, xStart + actualXPixelRange]);
      
    const yScale = scaleLinear()
      .domain(yDomain)
      .range([yStart, yStart - actualYPixelRange]); // Note: y typically goes from bottom to top
    
    return { xScale, yScale };
  }

  protected createOptimalScale(domain: [number, number], range: [number, number], forceZero: boolean = true, useLimits: 'xlim' | 'ylim' | false = false) {
    let [min, max] = domain;
    
    // Apply limits if specified
    if (useLimits === 'xlim' && this.options.xlim) {
      const xlim = this.options.xlim;
      if (xlim.length >= 1 && xlim[0] !== null && xlim[0] !== undefined) {
        min = xlim[0];
      }
      if (xlim.length >= 2 && xlim[1] !== null && xlim[1] !== undefined) {
        max = xlim[1];
      }
    } else if (useLimits === 'ylim' && this.options.ylim) {
      const ylim = this.options.ylim;
      if (ylim.length >= 1 && ylim[0] !== null && ylim[0] !== undefined) {
        min = ylim[0];
      }
      if (ylim.length >= 2 && ylim[1] !== null && ylim[1] !== undefined) {
        max = ylim[1];
      }
    }
    
    // If forceOrigin is enabled and all values are positive, start from 0 (for Y-axis typically)
    // But only if no limits are specified
    if (this.options.forceOrigin !== false && forceZero && min >= 0 && !useLimits) {
      return scaleLinear()
        .domain([0, max])
        .range(range)
        .nice();
    }
    
    // Use the computed domain
    return scaleLinear()
      .domain([min, max])
      .range(range)
      .nice();
  }

  // Tick Management Utilities
  protected estimateTextWidth(text: string, fontSize: number = 12): number {
    // Rough estimation: character width varies by font, this is for Arial/sans-serif
    const avgCharWidth = fontSize * 0.6;
    return text.length * avgCharWidth;
  }

  protected shouldSkipTicks(labels: string[], availableWidth: number, minSpacePerLabel: number = 50): boolean {
    if (labels.length === 0) return false;
    const spacePerTick = availableWidth / labels.length;
    return spacePerTick < minSpacePerLabel;
  }

  protected calculateTickSkipping(labels: string[], availableWidth: number, minSpacePerLabel: number = 50): number {
    const spacePerTick = availableWidth / labels.length;
    if (spacePerTick >= minSpacePerLabel) return 1; // Show all
    return Math.ceil(minSpacePerLabel / spacePerTick);
  }

  protected applySmartTickSkipping(
    tickElements: string[], 
    labels: string[], 
    availableWidth: number,
    minSpacePerLabel: number = 50
  ): string[] {
    const skipEveryNth = this.calculateTickSkipping(labels, availableWidth, minSpacePerLabel);
    
    if (skipEveryNth === 1) {
      return tickElements; // No skipping needed
    }

    return tickElements.map((element, i) => {
      if (i % skipEveryNth === 0) {
        return element; // Keep this label
      } else {
        // Hide text but keep a small tick mark
        return element.replace(/<text[^>]*>.*?<\/text>/, '<line x1="0" x2="0" y1="0" y2="4" stroke="#666" stroke-width="1"/>');
      }
    });
  }

  protected applyRotatedLabels(tickElements: string[], rotationAngle: number = 45): string[] {
    return tickElements.map(element => {
      // Add rotation transform to text elements
      return element.replace(
        /<text([^>]*)>/,
        `<text$1 transform="rotate(${rotationAngle})" text-anchor="start">`
      );
    });
  }

  protected getTickStrategy(): 'skip' | 'rotate' {
    const { tickStrategy } = this.options;
    
    if (tickStrategy === 'skip' || tickStrategy === 'rotate') {
      return tickStrategy;
    }
    
    // Auto strategy: determine based on chart type
    // Override in subclasses for specific behavior
    return 'skip';
  }

  // Static CLI handling method
  public static handleCLI<T>(
    createChart: (data: any, options?: any) => T,
    getChartSVG: (chart: T) => string,
    usageMessage: string,
    errorMessage: string
  ): void {
    try {
      const inputFilePath = Deno.args[0];
      if (!inputFilePath) {
        console.error('Error: No input file provided');
        console.error(usageMessage.replace("'{\"data\":", "input_file.json"));
        Deno.exit(1);
      }

      const inputContent = Deno.readTextFileSync(inputFilePath);
      const input = JSON.parse(inputContent);
      
      if (!input.data || !Array.isArray(input.data)) {
        console.error(errorMessage);
        Deno.exit(1);
      }

      const chart = createChart(input.data, input.options);
      const svg = getChartSVG(chart);
      console.log(svg);
      
    } catch (error) {
      console.error('Error generating chart:', error.message);
      Deno.exit(1);
    }
  }
}