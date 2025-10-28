/**
 * GraphChart - Lightweight GraphViz wrapper with d3pm styling
 * Pure visual translation layer over GraphViz positioning
 */

import { BaseChart, BaseChartOptions, ChartDimensions } from "./BaseChart.ts";

// GraphViz data interfaces (from JSON output)
export interface GraphVizNode {
  id: string;
  label: string;
  shape: 'box' | 'circle' | 'ellipse' | 'polygon' | string;
  pos: string;  // "x,y" coordinates from GraphViz
  width: string;
  height: string;
  color?: string;
  style?: string;
}

export interface GraphVizEdge {
  source: string;
  target: string;
  pos: string;  // GraphViz path coordinates
  label?: string;
}

export interface GraphVizData {
  nodes: GraphVizNode[];
  edges: GraphVizEdge[];
  // GraphViz graph attributes
  bb?: string;  // Bounding box "llx,lly,urx,ury" 
  rankdir?: string;
  layout?: string;
}

export interface LabelSegment {
  text: string;
  weight: number | null;
}

export interface GraphChartOptions extends BaseChartOptions {
  nodeSize?: number;
  edgeWidth?: number;
  arrowSize?: number;
  debug?: boolean;
  autoSize?: boolean;
  padding?: number;
}

export class GraphChart extends BaseChart<GraphVizData, GraphChartOptions> {
  private graphVizBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private naturalDimensions: { width: number; height: number } | null = null;

  protected getDefaultOptions(): Required<GraphChartOptions> {
    const baseDefaults = this.getBaseDefaults();
    return {
      ...baseDefaults,
      width: null,  // Will be auto-calculated if not provided
      height: null, // Will be auto-calculated if not provided
      nodeSize: 22, // Balanced size - not too big, not too small
      edgeWidth: 1.5,
      arrowSize: 6, // Increased from 6 for better visibility
      debug: false,
      autoSize: true,
      padding: 60,
    } as Required<GraphChartOptions>;
  }

  protected getColorDomain(): string[] {
    return this.data.nodes.map(node => node.id);
  }

  public render(): string {
    this.svgElements = []; // Reset elements
    
    if (this.options.debug) {
      this.svgElements.push(`<!-- GraphChart: GraphViz wrapper - ${new Date().toISOString()} -->`);
    }



    // Parse GraphViz bounds for coordinate transformation
    this.parseGraphVizBounds();
    
    // Calculate natural dimensions and update chart dimensions if auto-sizing
    this.calculateAdaptiveDimensions();
    
    this.renderBackground();
    this.renderTitle();
    this.renderChartElements();
    
    return this.createSVG();
  }

  private parseGraphVizBounds(): void {
    // Extract bounding box from GraphViz data if available
    if (this.data.bb) {
      const [llx, lly, urx, ury] = this.data.bb.split(',').map(Number);
      this.graphVizBounds = { minX: llx, minY: lly, maxX: urx, maxY: ury };
    } else {
      // Calculate bounds from node positions, accounting for node sizes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      this.data.nodes.forEach(node => {
        const [x, y] = this.getNodePosition(node);
        
        // Estimate node size to include in bounds calculation
        let nodeWidth: number, nodeHeight: number;
        if (this.isCircularShape(node.shape)) {
          const textWidth = this.estimateTextWidth(this.getNodeLabel(node), 12);
          const radius = Math.max(this.options.nodeSize, textWidth / 2 + 8, 20);
          nodeWidth = nodeHeight = radius * 2;
        } else {
          // Rectangle node
          const segments = this.parseGraphVizRecord(this.getNodeLabel(node));
          if (segments && segments.length > 1) {
            nodeWidth = this.calculateRecordWidth(segments);
          } else {
            nodeWidth = this.calculateSimpleNodeWidth(this.getNodeLabel(node));
          }
          nodeHeight = this.options.nodeSize * 1.5;
        }
        
        // Include node extents in bounds
        const halfWidth = nodeWidth / 2;
        const halfHeight = nodeHeight / 2;
        
        minX = Math.min(minX, x - halfWidth);
        minY = Math.min(minY, y - halfHeight);
        maxX = Math.max(maxX, x + halfWidth);
        maxY = Math.max(maxY, y + halfHeight);
      });
      
      // Add modest padding (reduced from 50 to 20)
      const padding = 20;
      this.graphVizBounds = {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding
      };
    }
  }

  private calculateAdaptiveDimensions(): void {
    if (!this.graphVizBounds) return;
    
    const { minX, minY, maxX, maxY } = this.graphVizBounds;
    const { padding } = this.options;
    
    // Calculate natural graph dimensions (scale=2 will be applied in transform)
    const graphWidth = (maxX - minX);
    const graphHeight = (maxY - minY);
    
    // Store natural dimensions
    this.naturalDimensions = {
      width: graphWidth + padding * 2,
      height: graphHeight + padding * 2
    };
    
    // Determine final dimensions based on user input
    let finalWidth = this.options.width;
    let finalHeight = this.options.height;
    
    if (this.options.autoSize) {
      if (!finalWidth && !finalHeight) {
        // Both null: use natural dimensions
        finalWidth = this.naturalDimensions.width;
        finalHeight = this.naturalDimensions.height;
      } else if (finalWidth && !finalHeight) {
        // Width provided, calculate height maintaining aspect ratio
        const aspectRatio = this.naturalDimensions.height / this.naturalDimensions.width;
        finalHeight = finalWidth * aspectRatio;
      } else if (!finalWidth && finalHeight) {
        // Height provided, calculate width maintaining aspect ratio  
        const aspectRatio = this.naturalDimensions.width / this.naturalDimensions.height;
        finalWidth = finalHeight * aspectRatio;
      }
      // If both provided, use as-is (no changes needed)
    } else {
      // Not auto-sizing, use defaults if null
      finalWidth = finalWidth || 1000;
      finalHeight = finalHeight || 600;
    }
    
    // Update dimensions
    this.options.width = finalWidth;
    this.options.height = finalHeight;
    this.dimensions = this.calculateDimensions();
  }

  private parsePosition(pos: string): [number, number] {
    // GraphViz positions are "x,y" strings
    const [x, y] = pos.split(',').map(Number);
    return [x, y];
  }

  private getNodePosition(node: GraphVizNode): [number, number] {
    // Handle both GraphViz format (pos: "x,y") and Node format (x: number, y: number)
    if (node.pos) {
      return this.parsePosition(node.pos);
    } else if (typeof (node as any).x === 'number' && typeof (node as any).y === 'number' && 
               (node as any).x !== null && (node as any).y !== null) {
      return [(node as any).x, (node as any).y];
    } else {
      // No position data - apply simple horizontal layout
      const nodeIndex = this.data.nodes.findIndex(n => n.id === node.id);
      const spacing = 150; // Space between nodes
      return [nodeIndex * spacing, 0];
    }
  }

  private transformCoordinates(graphVizX: number, graphVizY: number): [number, number] {
    // Transform GraphViz coordinates to SVG coordinates
    if (!this.graphVizBounds) return [graphVizX, graphVizY];
    
    const { innerWidth, innerHeight } = this.dimensions;
    const { minX, minY, maxX, maxY } = this.graphVizBounds;
    
    // Use actual graph dimensions (no artificial minimums)
    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    
    // Prevent division by zero for very small graphs
    const safeGraphWidth = Math.max(graphWidth, 1);
    const safeGraphHeight = Math.max(graphHeight, 1);
    
    // Scale to fit within inner dimensions with very generous spacing
    const scaleX = innerWidth / safeGraphWidth;
    const scaleY = innerHeight / safeGraphHeight;
    const scale = Math.min(scaleX, scaleY) * 1; // 50% for maximum spacing to prevent overlap
    
    // Center the graph
    const centerX = innerWidth / 2;
    const centerY = innerHeight / 2;
    const graphCenterX = (maxX + minX) / 2;
    const graphCenterY = (maxY + minY) / 2;
    
    // Transform coordinates (GraphViz Y is bottom-up, SVG is top-down)
    const transformedX = centerX + (graphVizX - graphCenterX) * scale;
    const transformedY = centerY - (graphVizY - graphCenterY) * scale; // Flip Y
    
    return [transformedX, transformedY];
  }

  protected renderChartElements(): void {
    this.renderEdges();
    this.renderNodes();
  }

  private renderEdges(): void {
    const { edgeWidth, arrowSize } = this.options;
    const { axis } = this.themeColors;

    // Define arrow marker - smaller size
    this.svgElements.push(`
      <defs>
        <marker id="arrow-new" markerWidth="6" markerHeight="6" 
                refX="2" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" 
                   fill="${axis}" stroke="none"/>
        </marker>
      </defs>
    `);

    // Process GraphViz edges
    const edges = this.data.edges || [];
    
    edges.forEach((edge) => {
      this.renderSingleEdge(edge);
    });
  }

  private renderSingleEdge(edge: any): void {
    const { edgeWidth } = this.options;
    const { axis } = this.themeColors;

    const sourceNode = typeof edge.source === 'string' 
      ? this.data.nodes.find(n => n.id === edge.source)
      : edge.source as GraphVizNode;
    const targetNode = typeof edge.target === 'string'
      ? this.data.nodes.find(n => n.id === edge.target)  
      : edge.target as GraphVizNode;

    if (!sourceNode || !targetNode) {
      return;
    }
    
    const [sourceX, sourceY] = this.transformCoordinates(...this.getNodePosition(sourceNode));
    const [targetX, targetY] = this.transformCoordinates(...this.getNodePosition(targetNode));

    // Calculate edge endpoints (accounting for actual node boundaries)
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return;

    // Calculate precise edge endpoints for different node shapes
    const [startX, startY] = this.getNodeEdgePoint(sourceNode, sourceX, sourceY, dx, dy);
    const [targetX_boundary, targetY_boundary] = this.getNodeEdgePoint(targetNode, targetX, targetY, -dx, -dy);
    
    // Shorten the line by arrow length so it doesn't protrude beyond arrow tip
    const arrowLength = 6; // Match the arrow marker size
    const unitX = dx / distance;
    const unitY = dy / distance;
    const endX = targetX_boundary - unitX * arrowLength;
    const endY = targetY_boundary - unitY * arrowLength;
    
    // Render edge line with arrow
    this.svgElements.push(`
      <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" 
            stroke="${axis}" stroke-width="${edgeWidth}" 
            marker-end="url(#arrow-new)" opacity="1.0" stroke-linecap="round"/>
    `);

    // Add edge label if present
    if (edge.label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      this.svgElements.push(`
        <text x="${midX}" y="${midY}" text-anchor="middle" 
              fill="${this.themeColors.text}" font-size="10px" 
              stroke="${this.themeColors.background}" stroke-width="2" 
              paint-order="stroke">${edge.label}</text>
      `);
    }
  }

  // Calculate precise edge connection point on node boundary
  private getNodeEdgePoint(node: GraphVizNode, nodeX: number, nodeY: number, dx: number, dy: number): [number, number] {
    const { nodeSize } = this.options;
    
    if (this.isCircularShape(node.shape)) {
      // For circles, use radius-based calculation
      const nodeLabel = this.getNodeLabel(node);
      const textWidth = this.estimateTextWidth(nodeLabel, 12);
      const radius = Math.max(nodeSize, textWidth / 2 + 8, 20);
      
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) return [nodeX, nodeY];
      
      const unitX = dx / distance;
      const unitY = dy / distance;
      
      return [nodeX + unitX * radius, nodeY + unitY * radius];
    } else {
      // For rectangles, calculate intersection with rectangle boundary
      const nodeLabel = this.getNodeLabel(node);
      const segments = this.parseGraphVizRecord(nodeLabel);
      
      let width: number;
      if (segments && segments.length > 1) {
        width = this.calculateRecordWidth(segments);
      } else {
        width = this.calculateSimpleNodeWidth(nodeLabel);
      }
      
      const height = nodeSize * 1.5;
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      
      // Calculate intersection with rectangle boundary
      if (dx === 0 && dy === 0) return [nodeX, nodeY];
      
      // Calculate which edge of the rectangle the line intersects
      const t1 = dx !== 0 ? halfWidth / Math.abs(dx) : Infinity;
      const t2 = dy !== 0 ? halfHeight / Math.abs(dy) : Infinity;
      const t = Math.min(t1, t2);
      
      const intersectX = nodeX + Math.sign(dx) * Math.min(Math.abs(dx * t), halfWidth);
      const intersectY = nodeY + Math.sign(dy) * Math.min(Math.abs(dy * t), halfHeight);
      
      return [intersectX, intersectY];
    }
  }


  private parseLabelSegments(text: string): LabelSegment[] | null {
    // Parse divider syntax: "{ segment1 | segment2 | segment3 }" with optional weights
    // Supports: "{ a | b }" or "{ label:0.3 | data:0.5 | grad:0.2 }"
    const match = text.match(/^\{\s*(.+)\s*\}$/);
    if (!match) return null;
    
    const segments = match[1].split('|').map(segment => segment.trim());
    if (segments.length < 2) return null;
    
    const result: LabelSegment[] = [];
    let hasExplicitWeights = false;
    
    for (const segment of segments) {
      const weightMatch = segment.match(/^(.+?):(\d*\.?\d+)$/);
      if (weightMatch) {
        // Explicit weight specified
        result.push({
          text: weightMatch[1].trim(),
          weight: parseFloat(weightMatch[2])
        });
        hasExplicitWeights = true;
      } else {
        // No explicit weight, will be calculated later
        result.push({
          text: segment,
          weight: null
        });
      }
    }
    
    // Only normalize weights if explicit weights were provided
    if (hasExplicitWeights) {
      // Normalize weights to sum to 1
      const totalWeight = result.reduce((sum, seg) => sum + (seg.weight || 0), 0);
      if (totalWeight > 0) {
        result.forEach(seg => {
          if (seg.weight) seg.weight /= totalWeight;
        });
      }
    }
    // If no explicit weights, leave as null for text-hugging mode
    
    return result;
  }

  protected estimateTextWidth(text: string, fontSize: number = 12): number {
    // Rough estimation: average character width is ~0.6 * fontSize for most fonts
    // This is a simple approximation that works reasonably well for Arial/sans-serif
    const avgCharWidth = fontSize * 0.6;
    return text.length * avgCharWidth;
  }

  private calculateNodeWidth(node: GraphVizNode, segments: LabelSegment[] | null): number {
    const { nodeSize } = this.options;
    const minWidth = nodeSize * 1;
    const maxWidth = nodeSize * 15;
    const padding = 10; // Horizontal padding inside the node
    
    if (segments && segments.length > 0) {
      // Check if segments have explicit weights (ratio mode) or use text-hugging
      const hasExplicitWeights = segments.some(seg => seg.weight !== null);
      const fontSize = 11;
      
      if (hasExplicitWeights) {
        // Ratio-based mode: calculate width based on weighted allocation
        let totalTextWidth = 0;
        segments.forEach(segment => {
          const segmentTextWidth = this.estimateTextWidth(segment.text, fontSize);
          // Ensure minimum readable width per segment, adjust by weight
          const weightedWidth = Math.max(segmentTextWidth, fontSize * 3) / (segment.weight || 0.1);
          totalTextWidth = Math.max(totalTextWidth, weightedWidth);
        });
        
        // Add space for dividers and padding
        const dividerSpace = (segments.length - 1) * 2;
        const totalWidth = totalTextWidth + padding * 2 + dividerSpace;
        return Math.max(minWidth, Math.min(maxWidth, totalWidth));
      } else {
        // Text-hugging mode: sum actual text widths plus consistent padding
        let totalTextWidth = 0;
        const segmentPadding = 4; // Consistent padding unit
        
        segments.forEach(segment => {
          const segmentTextWidth = this.estimateTextWidth(segment.text, fontSize);
          totalTextWidth += Math.max(segmentTextWidth, fontSize * 2); // No padding here, added separately
        });
        
        // Simple spacing model: outer padding + padding around dividers + divider widths
        const numDividers = segments.length - 1;
        const outerPadding = segmentPadding * 2; // 4px on each side
        const dividerPadding = numDividers * segmentPadding * 2; // 4px on each side of each divider
        const dividerWidth = numDividers * 2; // 2px per divider line
        
        const totalWidth = totalTextWidth + outerPadding + dividerPadding + dividerWidth;
        return Math.max(minWidth, Math.min(maxWidth, totalWidth));
      }
    } else {
      // Simple node: calculate width needed for the text plus padding
      const textWidth = this.estimateTextWidth(this.getNodeLabel(node), 12);
      const totalWidth = textWidth + padding;
      return Math.max(minWidth, Math.min(maxWidth, totalWidth));
    }
  }

  private renderNodes(): void {
    const { nodeSize } = this.options;
    const { text, background } = this.themeColors;

    this.data.nodes.forEach(node => {
      const [x, y] = this.transformCoordinates(...this.getNodePosition(node));
      const color = this.getNodeColor(node);
      
      if (this.isCircularShape(node.shape)) {
        this.renderCircleNode(node, x, y, nodeSize, color, text, background);
      } else {
        // Default to rectangle for box, rect, and other shapes
        this.renderRectangleNode(node, x, y, nodeSize, color, text, background);
      }
    });
  }

  private renderCircleNode(
    node: GraphVizNode, 
    x: number, 
    y: number, 
    nodeSize: number, 
    color: string, 
    textColor: string, 
    strokeColor: string
  ): void {
    // Calculate radius based on text content for better fit
    const nodeLabel = this.getNodeLabel(node);
    const textWidth = this.estimateTextWidth(nodeLabel, 12);
    const radius = Math.max(nodeSize, textWidth / 2 + 8, 20); // Dynamic sizing with minimums
    
    // Circular node for operations (matches archive styling)
    this.svgElements.push(`
      <circle cx="${x}" cy="${y}" r="${radius}" 
              fill="${color}" stroke="${strokeColor}" stroke-width="2" 
              opacity="0.9">
        <title>${nodeLabel}</title>
      </circle>
    `);
    
    // Simple text for circular nodes
    this.svgElements.push(`
      <text x="${x}" y="${y + 4}" text-anchor="middle" 
            fill="${textColor}" font-size="12px" font-weight="600"
            pointer-events="none">${nodeLabel}</text>
    `);
  }

  private renderRectangleNode(
    node: GraphVizNode, 
    x: number, 
    y: number, 
    nodeSize: number, 
    color: string, 
    textColor: string, 
    strokeColor: string
  ): void {
    // Check if this is a GraphViz record label with dividers
    const nodeLabel = this.getNodeLabel(node);
    const segments = this.parseGraphVizRecord(nodeLabel);
    
    if (segments && segments.length > 1) {
      // Multi-segment rectangular node
      const width = this.calculateRecordWidth(segments);
      const height = nodeSize * 1.5;
      
      this.svgElements.push(`
        <rect x="${x - width/2}" y="${y - height/2}" 
              width="${width}" height="${height}" rx="4"
              fill="${color}" stroke="${strokeColor}" stroke-width="2" 
              opacity="0.9">
          <title>${nodeLabel}</title>
        </rect>
      `);
      
      // Draw dividers and text for each segment
      this.renderRecordSegments(segments, x, y, width, height, textColor);
    } else {
      // Simple rectangular node
      const width = this.calculateSimpleNodeWidth(nodeLabel);
      const height = nodeSize * 1.5;
      
      this.svgElements.push(`
        <rect x="${x - width/2}" y="${y - height/2}" 
              width="${width}" height="${height}" rx="4"
              fill="${color}" stroke="${strokeColor}" stroke-width="2" 
              opacity="0.9">
          <title>${nodeLabel}</title>
        </rect>
      `);
      
      // Simple text
      this.svgElements.push(`
        <text x="${x}" y="${y + 4}" text-anchor="middle" 
              fill="${textColor}" font-size="12px" font-weight="600"
              pointer-events="none">${nodeLabel}</text>
      `);
    }
  }

  private parseGraphVizRecord(label: string): string[] | null {
    // Parse GraphViz record labels like "{ field1 | field2 | field3 }"
    if (!label) return null;
    const match = label.match(/^\{\s*(.+?)\s*\}$/);
    if (match) {
      return match[1].split('|').map(segment => segment.trim());
    }
    return null;
  }

  private getNodeLabel(node: GraphVizNode): string {
    // Handle both GraphViz format (label) and Node format (text)
    return node.label || (node as any).text || '';
  }

  private isCircularShape(shape: string): boolean {
    // GraphViz circular shapes that should be rendered as circles
    const circularShapes = ['circle', 'ellipse', 'oval', 'point', 'doublecircle'];
    return circularShapes.includes(shape.toLowerCase());
  }

  private calculateRecordWidth(segments: string[]): number {
    const fontSize = 11;
    const segmentPadding = 6; // Reduced padding
    const dividerWidth = 2;
    
    let totalWidth = segmentPadding * 2; // Reduced outer padding
    
    segments.forEach((segment, index) => {
      const textWidth = this.estimateTextWidth(segment, fontSize);
      totalWidth += Math.max(textWidth, fontSize * 2.5); // Reduced minimum width
      
      if (index < segments.length - 1) {
        totalWidth += segmentPadding * 2 + dividerWidth; // Padding + divider
      }
    });
    
    return Math.max(totalWidth, 80); // Reduced minimum total width
  }

  private calculateSimpleNodeWidth(label: string): number {
    const fontSize = 12;
    const padding = 16; // Reduced padding for tighter nodes
    const textWidth = this.estimateTextWidth(label, fontSize);
    return Math.max(textWidth + padding, fontSize * 3, 40); // Reduced minimum width
  }

  private renderRecordSegments(
    segments: string[], 
    x: number, 
    y: number, 
    width: number, 
    height: number, 
    textColor: string
  ): void {
    const fontSize = 11;
    const segmentPadding = 4;
    
    let currentX = x - width / 2 + segmentPadding;
    
    segments.forEach((segment, index) => {
      const textWidth = this.estimateTextWidth(segment, fontSize);
      const segmentWidth = Math.max(textWidth, fontSize * 2);
      const segmentCenterX = currentX + segmentWidth / 2;
      
      // Draw segment text
      this.svgElements.push(`
        <text x="${segmentCenterX}" y="${y + 4}" text-anchor="middle" 
              fill="${textColor}" font-size="${fontSize}px" font-weight="600"
              pointer-events="none">${segment}</text>
      `);
      
      currentX += segmentWidth;
      
      // Add divider after each segment (except the last)
      if (index < segments.length - 1) {
        currentX += segmentPadding;
        
        // Draw vertical divider
        this.svgElements.push(`
          <line x1="${currentX}" y1="${y - height/2}" 
                x2="${currentX}" y2="${y + height/2}" 
                stroke="${textColor}" stroke-width="1" opacity="0.6"/>
        `);
        
        currentX += 2 + segmentPadding; // Divider width + padding
      }
    });
  }

  private getNodeColor(node: GraphVizNode): string {
    // Use GraphViz color if specified, otherwise use d3pm color scale
    if (node.color) {
      return this.processNodeColor(node.color);
    }
    return this.colorScale(node.id);
  }

  private processNodeColor(color: string): string {
    // Handle named colors and hex colors
    const namedColor = BaseChart.NAMED_COLORS[color.toLowerCase()];
    return namedColor || color;
  }

  // Inherited abstract methods
  protected renderBackground(): void {
    const { width, height } = this.dimensions;
    
    // Use transparent background for graph charts
    this.svgElements.push(`<rect width="${width}" height="${height}" fill="transparent"/>`);
  }

  protected renderTitle(): void {
    if (!this.options.title) return;
    
    const { width } = this.dimensions;
    const { text } = this.themeColors;
    
    this.svgElements.push(`
      <text x="${width/2}" y="20" text-anchor="middle" 
            fill="${text}" font-size="16px" font-weight="500">${this.options.title}</text>
    `);
  }

  private createSVG(): string {
    const { width, height, margin } = this.dimensions;
    
    // Separate different types of SVG elements
    const backgroundElements = this.svgElements.filter(el => 
      el.includes('<rect width') || 
      el.includes(`<text x="${width/2}" y="20"`)
    );
    
    const defsElements = this.svgElements.filter(el => 
      el.includes('<defs>')
    );
    
    const chartElements = this.svgElements.filter(el => 
      !el.includes('<rect width') && 
      !el.includes(`<text x="${width/2}" y="20"`) &&
      !el.includes('<defs>')
    );
    
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="font-family: Arial, sans-serif;">
    ${backgroundElements.join('\n    ')}
    ${defsElements.join('\n    ')}
    <g transform="translate(${margin.left},${margin.top})">
        ${chartElements.join('\n        ')}
    </g>
</svg>`;
  }
}

// CLI handling for GraphViz data
if (typeof Deno !== 'undefined' && import.meta.main) {
  try {
    const inputFilePath = Deno.args[0];
    if (!inputFilePath) {
      console.error('Error: No input file provided');
      console.error('Usage: deno run --allow-all GraphChart.ts input_file.json');
      Deno.exit(1);
    }

    const inputContent = Deno.readTextFileSync(inputFilePath);
    const input = JSON.parse(inputContent);
    
    
    if (!input.data || !input.data.nodes || !Array.isArray(input.data.nodes)) {
      console.error('Error: Invalid GraphViz data format. Expected {data: {nodes: [...], edges: [...]}}');
      Deno.exit(1);
    }

    const chart = new GraphChart(input.data, input.options);
    const svg = chart.render();
    console.log(svg);
    
  } catch (error) {
    console.error('Error generating chart:', error.message);
    Deno.exit(1);
  }
}