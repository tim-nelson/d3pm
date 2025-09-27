/**
 * ChartComposer - Handles composition and layout of multiple charts
 * Supports stacking (*), side-by-side (+), and vertical (/) layout operations
 */

export interface CompositeChart {
  svg: string;
  width: number;
  height: number;
}

export interface ChartComponent {
  render(): string;
  getDimensions(): { width: number; height: number };
}

export class ChartComposer {
  /**
   * Stack charts on top of each other (overlay) - * operator
   * Charts share the same coordinate system and scales
   */
  static stack(chart1: ChartComponent, chart2: ChartComponent): CompositeChart {
    const dims1 = chart1.getDimensions();
    const dims2 = chart2.getDimensions();
    
    // Use the larger dimensions to accommodate both charts
    const width = Math.max(dims1.width, dims2.width);
    const height = Math.max(dims1.height, dims2.height);
    
    // Extract SVG content (remove outer SVG tags)
    const svg1Content = this.extractSVGContent(chart1.render());
    const svg2Content = this.extractSVGContent(chart2.render());
    
    // Combine both charts in the same coordinate system
    const combinedSVG = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: Arial, sans-serif;">
    ${svg1Content}
    ${svg2Content}
</svg>`;

    return {
      svg: combinedSVG,
      width,
      height
    };
  }

  /**
   * Place charts side-by-side horizontally - + operator
   */
  static sideBySide(chart1: ChartComponent, chart2: ChartComponent, spacing: number = 20): CompositeChart {
    const dims1 = chart1.getDimensions();
    const dims2 = chart2.getDimensions();
    
    const width = dims1.width + dims2.width + spacing;
    const height = Math.max(dims1.height, dims2.height);
    
    const svg1Content = this.extractSVGContent(chart1.render());
    const svg2Content = this.extractSVGContent(chart2.render());
    
    const combinedSVG = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: Arial, sans-serif;">
    <g>
      ${svg1Content}
    </g>
    <g transform="translate(${dims1.width + spacing}, 0)">
      ${svg2Content}
    </g>
</svg>`;

    return {
      svg: combinedSVG,
      width,
      height
    };
  }

  /**
   * Place charts vertically (top/bottom) - / operator
   */
  static vertical(chart1: ChartComponent, chart2: ChartComponent, spacing: number = 20): CompositeChart {
    const dims1 = chart1.getDimensions();
    const dims2 = chart2.getDimensions();
    
    const width = Math.max(dims1.width, dims2.width);
    const height = dims1.height + dims2.height + spacing;
    
    const svg1Content = this.extractSVGContent(chart1.render());
    const svg2Content = this.extractSVGContent(chart2.render());
    
    const combinedSVG = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: Arial, sans-serif;">
    <g>
      ${svg1Content}
    </g>
    <g transform="translate(0, ${dims1.height + spacing})">
      ${svg2Content}
    </g>
</svg>`;

    return {
      svg: combinedSVG,
      width,
      height
    };
  }

  /**
   * Extract inner content from SVG string (remove outer <svg> tags)
   */
  private static extractSVGContent(svg: string): string {
    const startTag = svg.indexOf('>');
    const endTag = svg.lastIndexOf('</svg>');
    
    if (startTag === -1 || endTag === -1) {
      return svg; // Return as-is if not valid SVG
    }
    
    return svg.substring(startTag + 1, endTag).trim();
  }
}

/**
 * ComposedChart - Wrapper class that implements ChartComponent interface
 * Allows composed charts to be further composed
 */
export class ComposedChart implements ChartComponent {
  constructor(
    private composite: CompositeChart
  ) {}

  render(): string {
    return this.composite.svg;
  }

  getDimensions(): { width: number; height: number } {
    return {
      width: this.composite.width,
      height: this.composite.height
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
}