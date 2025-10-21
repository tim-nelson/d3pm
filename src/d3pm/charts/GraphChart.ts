/**
 * GraphChart - Extends BaseChart for graph/network visualization
 * Features: Fixed positioning and force-directed layouts, nodes and edges
 */

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY } from "https://esm.sh/d3-force@3";
import { scaleLinear } from "https://esm.sh/d3-scale@4";
import { BaseChart, BaseChartOptions } from "./BaseChart.ts";

export interface GraphNode {
  id: string;
  text: string;
  shape: 'rect' | 'circle';
  x?: number;
  y?: number;
  color?: string;
  tooltip?: string;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string;
}

export interface LabelSegment {
  text: string;
  weight: number | null;
}

export interface GraphChartOptions extends BaseChartOptions {
  layout?: 'force' | 'reverse';
  nodeSize?: number;
  edgeWidth?: number;
  arrowSize?: number;
}

interface GraphChartInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  options?: GraphChartOptions;
}

export class GraphChart extends BaseChart<{nodes: GraphNode[], edges: GraphEdge[]}, GraphChartOptions> {
  private xScale: any;
  private yScale: any;
  private processedNodes: GraphNode[];
  private processedEdges: GraphEdge[];
  private nodeYPositions: Map<string, number> = new Map(); // nodeId -> actual Y coordinate
  private explicitDimensions: { width: boolean; height: boolean }; // Track explicit user settings
  private debug: boolean = false; // Controls debug console logs and SVG comments
  private deferredFinalInputs: Array<{
    currentInput: string,
    predictedOpY: number,
    outEdges: Map<string, string[]>,
    remainingInputs: string[],
    minNodeSpacing: number,
    processedNodes: Set<string>
  }> = [];

  constructor(data: {nodes: GraphNode[], edges: GraphEdge[]}, options: GraphChartOptions = {}) {
    super(data, options);
    
    // Track which dimensions were explicitly provided by user (after super call)
    this.explicitDimensions = {
      width: options.width !== undefined,
      height: options.height !== undefined
    };
    this.processedNodes = [...this.data.nodes];
    this.processedEdges = [...this.data.edges];
    
    // Defer layout computation until render() - needed for two-pass sizing
    this.createScales();
  }

  protected getDefaultOptions(): Required<GraphChartOptions> {
    const baseDefaults = this.getBaseDefaults();
    return {
      ...baseDefaults,
      layout: 'reverse',
      nodeSize: 20,
      edgeWidth: 2,
      arrowSize: 6,
      title: "",
      xLabel: "",
      yLabel: "",
      xlim: [null, null],
      ylim: [null, null]
    };
  }

  protected getColorDomain(): string[] {
    // Handle case where processedNodes might not be initialized yet during super() constructor
    if (!this.processedNodes) {
      return this.data?.nodes?.map(n => n.id) || [];
    }
    return this.processedNodes.map(n => n.id);
  }

  private createScales(): void {
    const { innerWidth, innerHeight } = this.dimensions;
    
    this.xScale = scaleLinear()
      .domain([0, innerWidth])
      .range([0, innerWidth]);
      
    this.yScale = scaleLinear()
      .domain([0, innerHeight])
      .range([0, innerHeight]);
  }

  private computeLayout(): void {
    const { layout } = this.options;
    
    if (layout === 'reverse') {
      this.computeReverseLayout();
    } else {
      // Default to force layout
      this.computeForceLayout();
    }
  }



  private normalizeNodeOrder(): void {
    // Normalize node processing order using abstract graph structure analysis
    // Works for any directed graph regardless of domain or node naming
    
    // Build adjacency lists for analysis
    const inEdges = new Map<string, string[]>();
    const outEdges = new Map<string, string[]>();
    
    this.processedNodes.forEach(node => {
      inEdges.set(node.id, []);
      outEdges.set(node.id, []);
    });

    this.processedEdges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      
      outEdges.get(sourceId)?.push(targetId);
      inEdges.get(targetId)?.push(sourceId);
    });
    
    // Calculate topological levels (distance from sources)
    const topologicalLevels = this.calculateTopologicalLevels(inEdges, outEdges);
    
    // Calculate centrality measures for each node
    const nodeCentrality = this.calculateNodeCentrality(inEdges, outEdges);
    
    // Create structured node data for sorting
    interface NodeStructure {
      node: GraphNode;
      topLevel: number;
      inDegree: number;
      outDegree: number;
      betweenness: number;
    }
    
    const nodeStructures: NodeStructure[] = this.processedNodes.map(node => ({
      node,
      topLevel: topologicalLevels.get(node.id) || 0,
      inDegree: (inEdges.get(node.id) || []).length,
      outDegree: (outEdges.get(node.id) || []).length,
      betweenness: nodeCentrality.get(node.id) || 0
    }));
    
    // Sort by multiple structural criteria for consistent ordering
    nodeStructures.sort((a, b) => {
      // Primary: topological level (dependency order)
      if (a.topLevel !== b.topLevel) return a.topLevel - b.topLevel;
      
      // Secondary: in-degree (nodes with more inputs first)
      if (a.inDegree !== b.inDegree) return b.inDegree - a.inDegree;
      
      // Tertiary: out-degree (nodes with more outputs first)  
      if (a.outDegree !== b.outDegree) return b.outDegree - a.outDegree;
      
      // Quaternary: betweenness centrality (more central nodes first)
      if (Math.abs(a.betweenness - b.betweenness) > 0.001) return b.betweenness - a.betweenness;
      
      // Final: lexicographic by ID for deterministic results
      return a.node.id.localeCompare(b.node.id);
    });
    
    // Rebuild processedNodes in structural order
    this.processedNodes = nodeStructures.map(ns => ns.node);
    
    if (this.debug) {
      const levelSummary = nodeStructures
        .slice(0, 5) // First 5 nodes
        .map(ns => `${ns.node.id}(L${ns.topLevel},I${ns.inDegree},O${ns.outDegree},B${ns.betweenness.toFixed(2)})`)
        .join(',');
      this.svgElements.push(`<!-- NORMALIZE: structural order [${levelSummary}...] -->`);
    }
  }
  
  private calculateTopologicalLevels(
    inEdges: Map<string, string[]>, 
    outEdges: Map<string, string[]>
  ): Map<string, number> {
    // BFS to calculate distance from sources (nodes with no incoming edges)
    const levels = new Map<string, number>();
    const queue: Array<{nodeId: string, level: number}> = [];
    
    // Find source nodes (no incoming edges)
    this.processedNodes.forEach(node => {
      if ((inEdges.get(node.id) || []).length === 0) {
        levels.set(node.id, 0);
        queue.push({nodeId: node.id, level: 0});
      }
    });
    
    // BFS to assign levels
    while (queue.length > 0) {
      const {nodeId, level} = queue.shift()!;
      
      // Process all nodes this one points to
      const targets = outEdges.get(nodeId) || [];
      targets.forEach(targetId => {
        const newLevel = level + 1;
        const currentLevel = levels.get(targetId);
        
        // Only update if this creates a longer path (max level wins)
        if (currentLevel === undefined || newLevel > currentLevel) {
          levels.set(targetId, newLevel);
          queue.push({nodeId: targetId, level: newLevel});
        }
      });
    }
    
    return levels;
  }
  
  private calculateNodeCentrality(
    inEdges: Map<string, string[]>, 
    outEdges: Map<string, string[]>
  ): Map<string, number> {
    // Simple betweenness centrality approximation
    // Count how many times each node appears in shortest paths
    const centrality = new Map<string, number>();
    
    // Initialize centrality scores
    this.processedNodes.forEach(node => {
      centrality.set(node.id, 0);
    });
    
    // For each pair of nodes, find shortest paths and increment centrality
    this.processedNodes.forEach(source => {
      const distances = this.calculateShortestPaths(source.id, outEdges);
      
      this.processedNodes.forEach(target => {
        if (source.id !== target.id && distances.has(target.id)) {
          // Trace back the shortest path and increment centrality for intermediate nodes
          this.incrementPathCentrality(source.id, target.id, outEdges, centrality);
        }
      });
    });
    
    return centrality;
  }
  
  private calculateShortestPaths(sourceId: string, outEdges: Map<string, string[]>): Map<string, number> {
    // BFS to find shortest distances from source
    const distances = new Map<string, number>();
    const queue: Array<{nodeId: string, distance: number}> = [];
    
    distances.set(sourceId, 0);
    queue.push({nodeId: sourceId, distance: 0});
    
    while (queue.length > 0) {
      const {nodeId, distance} = queue.shift()!;
      
      const neighbors = outEdges.get(nodeId) || [];
      neighbors.forEach(neighborId => {
        if (!distances.has(neighborId)) {
          distances.set(neighborId, distance + 1);
          queue.push({nodeId: neighborId, distance: distance + 1});
        }
      });
    }
    
    return distances;
  }
  
  private incrementPathCentrality(
    sourceId: string, 
    targetId: string, 
    outEdges: Map<string, string[]>, 
    centrality: Map<string, number>
  ): void {
    // Simple path counting - increment centrality for nodes with high connectivity
    // This is a simplified approximation of betweenness centrality
    const sourceOutDegree = (outEdges.get(sourceId) || []).length;
    const targetInDegree = this.processedNodes.filter(node => 
      (outEdges.get(node.id) || []).includes(targetId)
    ).length;
    
    // Nodes with high connectivity get higher centrality scores
    const currentScore = centrality.get(sourceId) || 0;
    centrality.set(sourceId, currentScore + sourceOutDegree * 0.1);
    
    const targetScore = centrality.get(targetId) || 0;
    centrality.set(targetId, targetScore + targetInDegree * 0.1);
  }

  private computeReverseLayout(): void {
    // Reverse topological layout: start from outputs and work backwards
    // Creates clean columnar flow where final outputs are rightmost
    if (this.debug) this.svgElements.push(`<!-- DEBUG: computeReverseLayout called -->`);

    // Normalize node order for consistent processing
    this.normalizeNodeOrder();
    
    const nodeMap = new Map<string, GraphNode>();
    this.processedNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });

    // Build adjacency lists
    const inEdges = new Map<string, string[]>();
    const outEdges = new Map<string, string[]>();
    
    this.processedNodes.forEach(node => {
      inEdges.set(node.id, []);
      outEdges.set(node.id, []);
    });

    this.processedEdges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      
      outEdges.get(sourceId)?.push(targetId);
      inEdges.get(targetId)?.push(sourceId);
    });

    // Find output nodes (nodes with no outgoing edges) - these go in the rightmost column
    const outputNodes = this.processedNodes
      .map(n => n.id)
      .filter(id => (outEdges.get(id) || []).length === 0);

    // Calculate distance from each node to nearest output using BFS
    const distances = new Map<string, number>();
    const queue: Array<{nodeId: string, distance: number}> = [];
    
    // Start BFS from all output nodes (distance 0)
    outputNodes.forEach(nodeId => {
      distances.set(nodeId, 0);
      queue.push({nodeId, distance: 0});
    });

    // BFS to calculate distances
    while (queue.length > 0) {
      const {nodeId, distance} = queue.shift()!;
      
      // Look at all nodes that feed into this node
      const inputNodes = inEdges.get(nodeId) || [];
      inputNodes.forEach(inputId => {
        if (!distances.has(inputId)) {
          const newDistance = distance + 1;
          distances.set(inputId, newDistance);
          queue.push({nodeId: inputId, distance: newDistance});
        }
      });
    }

    // Group nodes by their distance (column)
    const maxDistance = Math.max(...Array.from(distances.values()));
    const columns: string[][] = [];
    for (let i = 0; i <= maxDistance; i++) {
      columns.push([]);
    }
    
    distances.forEach((distance, nodeId) => {
      columns[distance].push(nodeId);
    });

    // Reverse columns so outputs are rightmost (distance 0 becomes rightmost column)
    columns.reverse();

    // Sort nodes within each column by their shared targets for vertical alignment
    columns.forEach((column, columnIndex) => {
      if (columnIndex === 0) {
        // Rightmost column (outputs): sort by node ID for consistency
        column.sort();
      } else {
        // Other columns: group by shared targets in the next column (to the right)
        const nextColumn = columns[columnIndex - 1];
        const nextColumnPositions = new Map<string, number>();
        nextColumn.forEach((nodeId, index) => {
          nextColumnPositions.set(nodeId, index);
        });

        // Group nodes by their shared targets
        const targetGroups = new Map<string, string[]>();
        
        column.forEach(nodeId => {
          const outputs = outEdges.get(nodeId) || [];
          const primaryTarget = outputs.length > 0 ? outputs[0] : '_no_outputs';
          
          if (!targetGroups.has(primaryTarget)) {
            targetGroups.set(primaryTarget, []);
          }
          targetGroups.get(primaryTarget)!.push(nodeId);
        });

        // Sort groups by their target positions in next column with deterministic tie-breaking
        const sortedGroupKeys = Array.from(targetGroups.keys()).sort((a, b) => {
          const aPos = nextColumnPositions.get(a) ?? 999;
          const bPos = nextColumnPositions.get(b) ?? 999;
          
          // Primary sort by position
          const positionCompare = aPos - bPos;
          if (positionCompare !== 0) return positionCompare;
          
          // Deterministic tie-breaking by target ID for consistency
          return a.localeCompare(b);
        });

        // Rebuild column with grouped nodes
        const sortedColumn: string[] = [];
        sortedGroupKeys.forEach(targetId => {
          const groupNodes = targetGroups.get(targetId)!;
          // Sort within group by node ID for deterministic consistency
          groupNodes.sort((a, b) => a.localeCompare(b));
          sortedColumn.push(...groupNodes);
        });

        columns[columnIndex] = sortedColumn;
      }
    });

    // Apply horizontal alignment priority for direct connections
    if (this.debug) this.svgElements.push(`<!-- DEBUG: About to call applyHorizontalAlignmentPriority -->`);
    this.applyHorizontalAlignmentPriority(columns, inEdges, outEdges);
    if (this.debug) this.svgElements.push(`<!-- DEBUG: Finished applyHorizontalAlignmentPriority -->`);

    // Position nodes in columns, accounting for node widths to prevent cutoff
    const { innerWidth, innerHeight } = this.dimensions;
    const minNodeSpacing = 60;
    const maxNodeSpacing = 100;
    
    // Calculate maximum node width in each column to determine spacing
    const columnMaxWidths = columns.map(column => {
      let maxWidth = 0;
      column.forEach(nodeId => {
        const node = nodeMap.get(nodeId);
        if (node) {
          const segments = this.parseLabelSegments(node.text);
          const width = node.shape === 'circle' 
            ? this.options.nodeSize * 2  // Diameter for circles
            : this.calculateNodeWidth(node, segments);
          maxWidth = Math.max(maxWidth, width);
        }
      });
      return maxWidth;
    });

    // Calculate column positions with proper spacing to prevent cutoff
    const columnPositions: number[] = [];
    if (columns.length === 1) {
      columnPositions.push(innerWidth / 2);
    } else {
      // Reserve space for rightmost nodes
      const rightmostMaxWidth = columnMaxWidths[0] || 0;
      const availableWidth = innerWidth - rightmostMaxWidth / 2 - 20; // 20px margin
      
      // Reserve space for leftmost nodes  
      const leftmostMaxWidth = columnMaxWidths[columnMaxWidths.length - 1] || 0;
      const startX = leftmostMaxWidth / 2 + 20; // 20px margin
      
      const usableWidth = availableWidth - startX;
      const columnSpacing = columns.length > 1 ? usableWidth / (columns.length - 1) : 0;
      
      for (let i = 0; i < columns.length; i++) {
        columnPositions.push(startX + i * columnSpacing);
      }
    }

    columns.forEach((column, columnIndex) => {
      const x = columnPositions[columnIndex];
      
      // Calculate spacing based on column size
      const nodeSpacing = Math.max(minNodeSpacing, 
        Math.min(maxNodeSpacing, (innerHeight - 100) / Math.max(1, column.length - 1)));
      
      const totalHeight = (column.length - 1) * nodeSpacing;
      const startY = (innerHeight - totalHeight) / 2;

      // Apply constraint-aware positioning
      this.applyConstraintAwarePositioning(column, x, startY, nodeSpacing, nodeMap);
    });
  }

  private applyConstraintAwarePositioning(
    column: string[],
    x: number,
    startY: number,
    nodeSpacing: number,
    nodeMap: Map<string, GraphNode>
  ): void {
    // Use global Y coordinates calculated by cross-column alignment
    if (this.debug) this.svgElements.push(`<!-- GLOBAL-Y: Positioning column with ${column.length} nodes -->`);
    
    column.forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      if (node) {
        node.x = x;
        
        // Use globally calculated Y position if available, fallback to default spacing
        const globalY = this.nodeYPositions.get(nodeId);
        if (globalY !== undefined) {
          node.y = globalY;
          if (this.debug) this.svgElements.push(`<!-- GLOBAL-Y: ${nodeId} using global Y=${globalY.toFixed(1)} -->`);
        } else {
          // Fallback to default positioning (shouldn't happen if algorithm works correctly)
          const nodeIndex = column.indexOf(nodeId);
          node.y = startY + nodeIndex * nodeSpacing;
          if (this.debug) this.svgElements.push(`<!-- GLOBAL-Y: ${nodeId} using fallback Y=${node.y} (index ${nodeIndex}) -->`);
        }
      }
    });
  }

  private applyHorizontalAlignmentPriority(
    columns: string[][], 
    inEdges: Map<string, string[]>, 
    outEdges: Map<string, string[]>
  ): void {
    // Cross-column alignment: ensure connected nodes have the same Y coordinate
    
    if (this.debug) this.svgElements.push(`<!-- CROSS-COLUMN ALIGNMENT: Starting with ${columns.length} columns -->`);
    
    // Step 1: Identify all direct connections that should be horizontal
    const directConnections = this.identifyDirectConnections(columns, outEdges);
    if (this.debug) this.svgElements.push(`<!-- CROSS-COLUMN: Found ${directConnections.length} direct connections -->`);
    
    // Step 2: Calculate global Y positions for all nodes
    const { innerHeight } = this.dimensions;
    this.calculateGlobalYPositions(columns, directConnections, innerHeight);
    
    if (this.debug) this.svgElements.push(`<!-- CROSS-COLUMN: Assigned ${this.nodeYPositions.size} Y positions -->`);
    Array.from(this.nodeYPositions.entries()).slice(0, 5).forEach(([node, y]) => {
      if (this.debug) this.svgElements.push(`<!-- CROSS-COLUMN: ${node} → Y=${y.toFixed(1)} -->`);
    });
  }

  private identifyDirectConnections(
    columns: string[][], 
    outEdges: Map<string, string[]>
  ): Array<{source: string, target: string, priority: number}> {
    // Identify only OPERATION → RESULT connections that should be horizontal
    // Operations are circles (×, +), results are rectangles
    const connections: Array<{source: string, target: string, priority: number}> = [];
    
    // Find which column each node is in
    const nodeToColumn = new Map<string, number>();
    columns.forEach((column, columnIndex) => {
      column.forEach(nodeId => {
        nodeToColumn.set(nodeId, columnIndex);
      });
    });
    
    // Create node lookup for shape checking
    const nodeMap = new Map<string, GraphNode>();
    this.processedNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });
    
    // Only identify operation → result connections for horizontal alignment
    columns.forEach((column, columnIndex) => {
      column.forEach(sourceNode => {
        const sourceNodeData = nodeMap.get(sourceNode);
        const outputs = outEdges.get(sourceNode) || [];
        
        // Only process if source is an operation (circle)
        if (sourceNodeData?.shape === 'circle') {
          outputs.forEach(targetNode => {
            const targetNodeData = nodeMap.get(targetNode);
            const sourceColumn = nodeToColumn.get(sourceNode);
            const targetColumn = nodeToColumn.get(targetNode);
            
            // Only horizontal alignment for operation → result (circle → rect)
            if (sourceColumn !== undefined && targetColumn !== undefined && 
                sourceColumn !== targetColumn && targetNodeData?.shape === 'rect') {
              
              // Priority: closer to outputs = higher priority (for conflict resolution)
              const distanceFromOutput = sourceColumn;
              const priority = 1000 - distanceFromOutput * 10;
              
              connections.push({
                source: sourceNode,
                target: targetNode,
                priority: priority
              });
            }
          });
        }
      });
    });
    
    // Sort by priority (highest first) for conflict resolution
    connections.sort((a, b) => b.priority - a.priority);
    
    return connections;
  }

  private calculateGlobalYPositions(
    columns: string[][],
    directConnections: Array<{source: string, target: string, priority: number}>,
    innerHeight: number
  ): void {
    // CHAIN-AWARE APPROACH: Handle operation chains with dual-role nodes properly
    this.nodeYPositions.clear();
    
    const minNodeSpacing = 60;
    const margin = 30; // Top and bottom margin
    const usableHeight = innerHeight - 2 * margin;
    
    // Build adjacency lists for analysis
    const inEdges = new Map<string, string[]>();
    const outEdges = new Map<string, string[]>();
    
    this.processedNodes.forEach(node => {
      inEdges.set(node.id, []);
      outEdges.set(node.id, []);
    });

    this.processedEdges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      
      outEdges.get(sourceId)?.push(targetId);
      inEdges.get(targetId)?.push(sourceId);
    });
    
    // Get node type information
    const nodeMap = new Map<string, GraphNode>();
    this.processedNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });
    
    const processedNodes = new Set<string>();
    
    // Phase 1: Position only leaf inputs (no incoming operation connections)
    this.positionLeafInputs(nodeMap, directConnections, usableHeight, margin, minNodeSpacing, processedNodes);
    
    // Phase 2: Process operations and leaf inputs incrementally
    this.processIncrementally(nodeMap, inEdges, outEdges, minNodeSpacing, processedNodes);
    
    // Phase 3: Position any remaining unconstrained nodes
    this.positionUnconstrainedNodes(columns, processedNodes, usableHeight, margin, minNodeSpacing);
    
    // DEBUG: Show final node positions and calculate distances
    this.debugFinalPositions(inEdges, minNodeSpacing);
  }

  private analyzeOperationChains(
    nodeMap: Map<string, GraphNode>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>
  ): Map<string, string[]> {
    // Analyze which leaf inputs eventually feed into the same final operations
    // Returns a map of operation -> leaf inputs that should be clustered near it
    
    const leafInputClusters = new Map<string, string[]>();
    
    // Find all operations (circles)
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    
    operations.forEach(operation => {
      const leafInputsForOperation = new Set<string>();
      
      // Recursively trace back from this operation to find all leaf inputs
      const visited = new Set<string>();
      const traceBackToLeafInputs = (nodeId: string) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        
        const node = nodeMap.get(nodeId);
        if (!node) return;
        
        if (node.shape === 'rect') {
          // Check if this is a leaf input (no incoming edges from operations)
          const hasOperationInputs = (inEdges.get(nodeId) || []).some(inputId => {
            const inputNode = nodeMap.get(inputId);
            return inputNode?.shape === 'circle';
          });
          
          if (!hasOperationInputs) {
            leafInputsForOperation.add(nodeId);
          }
        }
        
        // Continue tracing back through inputs
        const inputs = inEdges.get(nodeId) || [];
        inputs.forEach(inputId => traceBackToLeafInputs(inputId));
      };
      
      traceBackToLeafInputs(operation.id);
      leafInputClusters.set(operation.id, Array.from(leafInputsForOperation));
    });
    
    return leafInputClusters;
  }

  private positionLeafInputs(
    nodeMap: Map<string, GraphNode>,
    directConnections: Array<{source: string, target: string, priority: number}>,
    usableHeight: number,
    margin: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Constraint-aware positioning: Use backward planning for optimal spacing
    
    // Build edge maps for analysis
    const inEdges = new Map<string, string[]>();
    const outEdges = new Map<string, string[]>();
    
    this.processedEdges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      
      if (!outEdges.has(sourceId)) outEdges.set(sourceId, []);
      if (!inEdges.has(targetId)) inEdges.set(targetId, []);
      outEdges.get(sourceId)!.push(targetId);
      inEdges.get(targetId)!.push(sourceId);
    });
    
    // Identify nodes that are operation outputs
    const operationOutputs = new Set<string>();
    directConnections.forEach(({target}) => {
      operationOutputs.add(target);
    });
    
    // Find leaf inputs: rectangles that are NOT operation outputs
    const leafInputs: string[] = [];
    this.processedNodes.forEach(node => {
      if (node.shape === 'rect' && !operationOutputs.has(node.id)) {
        leafInputs.push(node.id);
      }
    });
    
    if (leafInputs.length === 0) return;
    
    // Constraint-aware positioning: Work through the operation chain
    this.positionLeafInputsOptimally(leafInputs, inEdges, outEdges, margin, minNodeSpacing, processedNodes);
  }
  
  private positionLeafInputsOptimally(
    leafInputs: string[],
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    margin: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // UPDATED: Handle multiple parallel operations with leaf inputs
    
    // Find nodes that have exactly 2 leaf inputs (parallel processing nodes)
    const allNodes = this.processedNodes;
    const parallelNodes = allNodes.filter(node => {
      const inputs = inEdges.get(node.id) || [];
      return inputs.length === 2 && inputs.every(inputId => leafInputs.includes(inputId));
    });
    
    // Sort by structural properties to ensure consistent results across different graphs
    parallelNodes.sort((a, b) => {
      // Primary: out-degree (nodes with more outputs processed first)
      const aOutDegree = (outEdges.get(a.id) || []).length;
      const bOutDegree = (outEdges.get(b.id) || []).length;
      if (aOutDegree !== bOutDegree) return bOutDegree - aOutDegree;
      
      // Secondary: in-degree (should be same for parallel nodes, but for completeness)
      const aInDegree = (inEdges.get(a.id) || []).length;
      const bInDegree = (inEdges.get(b.id) || []).length;
      if (aInDegree !== bInDegree) return bInDegree - aInDegree;
      
      // Tertiary: lexicographic by ID for deterministic results
      return a.id.localeCompare(b.id);
    });
    
    if (this.debug) console.log(`🔧 Found ${parallelNodes.length} parallel processing nodes with leaf inputs: [${parallelNodes.map(op => op.id).join(', ')}]`);
    
    if (parallelNodes.length === 0) {
      // Fallback to simple positioning if no clear parallel processing nodes
      this.positionLeafInputsSimple(leafInputs, margin, minNodeSpacing, processedNodes);
      return;
    }
    
    // Position input pairs for all parallel processing nodes
    this.positionParallelInputPairs(parallelNodes, inEdges, margin, minNodeSpacing, processedNodes);
  }
  
  private positionRemainingInputsOptimally(
    remainingInputs: string[],
    firstOpY: number,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Position remaining inputs using constraint-aware backward planning
    
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    
    // Find the operation chain order
    for (const input of remainingInputs) {
      // Find which operation this input feeds into
      const targetOps = outEdges.get(input)?.filter(targetId => 
        operations.some(op => op.id === targetId)
      ) || [];
      
      if (targetOps.length === 1) {
        const targetOpId = targetOps[0];
        const opInputs = inEdges.get(targetOpId) || [];
        
        if (opInputs.length === 2) {
          // Find the other input (should be an operation output positioned by previous step)
          const otherInput = opInputs.find(id => id !== input);
          
          if (otherInput) {
            // Get actual position of the other input (e.g., 'e')
            // which was positioned horizontally with its operation
            const actualOtherY = this.nodeYPositions.get(otherInput);
            if (actualOtherY !== undefined) {
              // Position this input (e.g., 'c') with consistent spacing from other input
              const optimalY = actualOtherY + minNodeSpacing;
              
              this.nodeYPositions.set(input, optimalY);
              processedNodes.add(input);
            
              // Store information for final input positioning (defer until operations are positioned)
              const nextOpY = (actualOtherY + optimalY) / 2;
              
              // Store deferred final input positioning info
              this.deferredFinalInputs.push({
                currentInput: input,
                predictedOpY: nextOpY,
                outEdges,
                remainingInputs,
                minNodeSpacing,
                processedNodes
              });
            }
          }
        }
      }
    }
    
    // Handle any unpositioned inputs with simple positioning
    remainingInputs.forEach(inputId => {
      if (!processedNodes.has(inputId)) {
        const lastY = Math.max(...Array.from(this.nodeYPositions.values()));
        this.nodeYPositions.set(inputId, lastY + minNodeSpacing);
        processedNodes.add(inputId);
      }
    });
    
    // Validate consistent spacing between input pairs
    this.validateInputPairSpacing(inEdges, outEdges, minNodeSpacing);
    
    // Additional detailed debugging
    this.detailedDebugPositions(inEdges);
  }
  
  private positionFinalInputOptimally(
    currentInput: string,
    predictedOpY: number,
    outEdges: Map<string, string[]>,
    remainingInputs: string[],
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Position final input based on predicted operation position
    
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    
    // Check if current input connects to another operation that needs a leaf input
    const connectedOps = outEdges.get(currentInput)?.filter(targetId => 
      operations.some(op => op.id === targetId)
    ) || [];
    
    if (connectedOps.length > 0) {
      const finalOpId = connectedOps[0];
      
      // Find the final leaf input for this operation
      const finalInputs = remainingInputs.filter(inputId => 
        outEdges.get(inputId)?.includes(finalOpId)
      );
      
      if (finalInputs.length === 1) {
        const finalInput = finalInputs[0];
        
        // Check if the operation's output has been positioned
        const opOutputs = outEdges.get(finalOpId) || [];
        const operationOutput = opOutputs.find(outputId => 
          this.processedNodes.some(node => node.id === outputId && node.shape === 'rect')
        );
        
        if (operationOutput && this.nodeYPositions.has(operationOutput)) {
          // Position final input based on actual operation output position
          const outputY = this.nodeYPositions.get(operationOutput)!;
          const optimalY = outputY + minNodeSpacing;
          
          this.nodeYPositions.set(finalInput, optimalY);
          processedNodes.add(finalInput);
        } else {
          // Fallback: use prediction if operation output not yet positioned
          const optimalY = predictedOpY + minNodeSpacing;
          
          this.nodeYPositions.set(finalInput, optimalY);
          processedNodes.add(finalInput);
        }
      }
    }
  }
  
  private positionLeafInputsSimple(
    leafInputs: string[],
    margin: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Simple fallback positioning
    let currentY = margin;
    leafInputs.forEach(inputId => {
      this.nodeYPositions.set(inputId, currentY);
      processedNodes.add(inputId);
      currentY += minNodeSpacing;
    });
  }

  private positionParallelInputPairs(
    parallelNodes: GraphNode[],
    inEdges: Map<string, string[]>,
    margin: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    if (this.debug) console.log(`🔧 Positioning ${parallelNodes.length} parallel input pairs...`);
    
    // Nodes are already sorted by structural properties in the calling method
    // No additional sorting needed - just process in the provided order
    
    let currentY = margin + 50; // Starting position with breathing room
    
    parallelNodes.forEach((node, index) => {
      const inputs = inEdges.get(node.id) || [];
      if (inputs.length === 2) {
        // Sort inputs deterministically for consistent positioning
        const sortedInputs = [...inputs].sort();
        
        // Position this input pair with consistent minNodeSpacing
        this.nodeYPositions.set(sortedInputs[0], currentY);
        this.nodeYPositions.set(sortedInputs[1], currentY + minNodeSpacing);
        processedNodes.add(sortedInputs[0]);
        processedNodes.add(sortedInputs[1]);
        
        if (this.debug) console.log(`🔧 Positioned input pair ${index + 1}: ${sortedInputs[0]}=${currentY}, ${sortedInputs[1]}=${currentY + minNodeSpacing} (for node ${node.id})`);
        
        // Move to next vertical position for next pair
        // Space pairs apart to avoid overlap with other nodes and outputs
        currentY += minNodeSpacing * 2; // Extra spacing between different pairs
      }
    });
  }

  private validateInputPairSpacing(
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    expectedSpacing: number
  ): void {
    // Find all operations and their input pairs
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    const inputPairs: Array<{op: string, inputs: string[], spacings: number[]}> = [];
    
    operations.forEach(operation => {
      const inputs = inEdges.get(operation.id) || [];
      if (inputs.length === 2) {
        const y1 = this.nodeYPositions.get(inputs[0]);
        const y2 = this.nodeYPositions.get(inputs[1]);
        if (y1 !== undefined && y2 !== undefined) {
          const spacing = Math.abs(y2 - y1);
          inputPairs.push({
            op: operation.id,
            inputs: inputs,
            spacings: [spacing]
          });
        }
      }
    });
    
    // Log spacing analysis for debugging
    if (inputPairs.length > 0) {
      if (this.debug) console.log('🔍 Input pair spacing analysis:');
      inputPairs.forEach(pair => {
        const spacing = pair.spacings[0];
        const consistent = Math.abs(spacing - expectedSpacing) < 1;
        const status = consistent ? '✅' : '❌';
        if (this.debug) console.log(`  ${status} ${pair.inputs[0]}-${pair.inputs[1]} (${pair.op}): ${spacing}px (expected: ${expectedSpacing}px)`);
      });
    }
  }

  private processDeferredFinalInputs(): void {
    // Process all deferred final input positioning now that operations are positioned
    this.deferredFinalInputs.forEach(info => {
      this.positionFinalInputOptimally(
        info.currentInput,
        info.predictedOpY,
        info.outEdges,
        info.remainingInputs,
        info.minNodeSpacing,
        info.processedNodes
      );
    });
    
    // Clear the deferred list
    this.deferredFinalInputs = [];
  }

  private debugFinalPositions(inEdges: Map<string, string[]>, expectedSpacing: number): void {
    // Add debug info to SVG comments so we can see it in the output
    if (this.debug) this.svgElements.push('<!-- 🔍 Final node Y positions: -->');
    
    // Show positions for key nodes in order
    const keyNodes = ['a', 'b', 'e', 'c', 'd', 'f', 'L'];
    keyNodes.forEach(nodeId => {
      const y = this.nodeYPositions.get(nodeId);
      if (y !== undefined) {
        if (this.debug) this.svgElements.push(`<!--   ${nodeId}.y = ${y.toFixed(1)} -->`);
      }
    });
    
    if (this.debug) this.svgElements.push('<!-- 📏 Input pair distances: -->');
    
    // Find all operations and calculate distances between their inputs
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    const distances: Array<{pair: string, distance: number, expected: number}> = [];
    
    operations.forEach(operation => {
      const inputs = inEdges.get(operation.id) || [];
      if (inputs.length === 2) {
        const y1 = this.nodeYPositions.get(inputs[0]);
        const y2 = this.nodeYPositions.get(inputs[1]);
        if (y1 !== undefined && y2 !== undefined) {
          const distance = Math.abs(y2 - y1);
          const pairName = `${inputs[0]}-${inputs[1]}`;
          distances.push({
            pair: pairName,
            distance: distance,
            expected: expectedSpacing
          });
          
          const status = Math.abs(distance - expectedSpacing) < 1 ? '✅' : '❌';
          if (this.debug) this.svgElements.push(`<!--   ${status} ${pairName}: ${distance.toFixed(1)}px (expected: ${expectedSpacing}px) -->`);
        }
      }
    });
    
    if (this.debug) this.svgElements.push('<!-- 🎯 Summary: -->');
    const allConsistent = distances.every(d => Math.abs(d.distance - d.expected) < 1);
    if (allConsistent) {
      if (this.debug) this.svgElements.push('<!-- ✅ All input pairs have consistent spacing! -->');
    } else {
      if (this.debug) this.svgElements.push('<!-- ❌ Input pairs have inconsistent spacing! -->');
      distances.forEach(d => {
        if (Math.abs(d.distance - d.expected) >= 1) {
          if (this.debug) this.svgElements.push(`<!--    Problem: ${d.pair} = ${d.distance.toFixed(1)}px (should be ${d.expected}px) -->`);
        }
      });
    }
    
    // Check f vs d positioning
    const f_y = this.nodeYPositions.get('f');
    const d_y = this.nodeYPositions.get('d');
    if (f_y !== undefined && d_y !== undefined) {
      if (f_y > d_y) {
        if (this.debug) this.svgElements.push('<!-- ✅ f.y > d.y: f positioned correctly below d -->');
      } else {
        if (this.debug) this.svgElements.push(`<!-- ❌ f.y (${f_y.toFixed(1)}) <= d.y (${d_y.toFixed(1)}): f NOT positioned below d -->`);
      }
    }
  }

  private detailedDebugPositions(inEdges: Map<string, string[]>): void {
    if (this.debug) console.log('\n🔧 DETAILED DEBUG:');
    if (this.debug) console.log('All operations and their inputs:');
    
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    operations.forEach(operation => {
      const inputs = inEdges.get(operation.id) || [];
      if (this.debug) console.log(`  ${operation.id}: inputs = [${inputs.join(', ')}] (count: ${inputs.length})`);
      
      if (inputs.length === 2) {
        const y1 = this.nodeYPositions.get(inputs[0]);
        const y2 = this.nodeYPositions.get(inputs[1]);
        if (this.debug) console.log(`    ${inputs[0]}.y = ${y1?.toFixed(1) || 'undefined'}`);
        if (this.debug) console.log(`    ${inputs[1]}.y = ${y2?.toFixed(1) || 'undefined'}`);
        if (y1 !== undefined && y2 !== undefined) {
          const distance = Math.abs(y2 - y1);
          if (this.debug) console.log(`    Distance: ${distance.toFixed(1)}px`);
        }
      }
    });
    
    if (this.debug) console.log('\nAll positioned nodes:');
    const allPositioned = Array.from(this.nodeYPositions.entries()).sort((a, b) => a[1] - b[1]);
    allPositioned.forEach(([nodeId, y]) => {
      if (this.debug) console.log(`  ${nodeId}: y = ${y.toFixed(1)}`);
    });
  }

  private processIncrementally(
    nodeMap: Map<string, GraphNode>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    if (this.debug) console.log('\n🔧 Starting incremental processing...');
    
    // Get all processing nodes (nodes with inputs that can be positioned)
    const processingNodes = this.processedNodes.filter(node => {
      const inputs = inEdges.get(node.id) || [];
      return inputs.length > 0; // Has inputs to process
    });
    
    // Process each node step by step
    for (const node of processingNodes) {
      if (this.debug) console.log(`\n🔧 Processing node: ${node.id}`);
      
      // Check if we can process this node (all inputs positioned)
      const inputs = inEdges.get(node.id) || [];
      const allInputsPositioned = inputs.every(inputId => this.nodeYPositions.has(inputId));
      
      if (!allInputsPositioned) {
        // Position any missing inputs for this node
        const missingInputs = inputs.filter(inputId => !this.nodeYPositions.has(inputId));
        if (this.debug) console.log(`  Missing inputs: [${missingInputs.join(', ')}]`);
        
        for (const missingInput of missingInputs) {
          this.positionLeafInputBasedOnOperation(missingInput, node.id, inEdges, outEdges, minNodeSpacing, processedNodes);
        }
      }
      
      // Now position the node and its outputs
      this.processOperation(node, nodeMap, inEdges, outEdges, processedNodes);
    }
  }

  private positionLeafInputBasedOnOperation(
    leafInput: string,
    processingNodeId: string,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    if (this.debug) console.log(`  🔧 Positioning leaf input: ${leafInput} for processing node: ${processingNodeId}`);
    
    // Find the other inputs of this processing node
    const nodeInputs = inEdges.get(processingNodeId) || [];
    const otherInput = nodeInputs.find(id => id !== leafInput);
    
    if (otherInput && this.nodeYPositions.has(otherInput)) {
      // Choose optimal direction (above or below) for height optimization
      const otherY = this.nodeYPositions.get(otherInput)!;
      const positionAbove = this.chooseOptimalDirection(otherY, minNodeSpacing);
      
      const leafInputY = positionAbove ? 
        otherY - minNodeSpacing : 
        otherY + minNodeSpacing;
      
      this.nodeYPositions.set(leafInput, leafInputY);
      processedNodes.add(leafInput);
      
      const direction = positionAbove ? 'above' : 'below';
      if (this.debug) console.log(`    Positioned ${leafInput} at y=${leafInputY} (${direction} ${otherInput}, spacing=${minNodeSpacing})`);
    } else {
      if (this.debug) console.log(`    Cannot position ${leafInput}: other input not positioned`);
    }
  }

  private chooseOptimalDirection(partnerY: number, minNodeSpacing: number): boolean {
    // Get current graph bounds
    const allYPositions = Array.from(this.nodeYPositions.values());
    if (allYPositions.length === 0) return false; // Default to below if no positions yet
    
    const currentMinY = Math.min(...allYPositions);
    const currentMaxY = Math.max(...allYPositions);
    
    // Calculate potential positions
    const positionAbove = partnerY - minNodeSpacing;
    const positionBelow = partnerY + minNodeSpacing;
    
    // Calculate how much each option extends the graph bounds
    const extendAbove = Math.max(0, currentMinY - positionAbove);
    const extendBelow = Math.max(0, positionBelow - currentMaxY);
    
    // Choose the direction that extends the graph bounds less
    let chooseAbove = extendAbove < extendBelow;
    
    // Deterministic tie-breaking: when extension amounts are equal, prefer above for consistency
    if (Math.abs(extendAbove - extendBelow) < 0.1) {
      chooseAbove = true; // Consistent tie-breaking rule
    }
    
    if (this.debug) console.log(`    Direction choice: above=${positionAbove}(extend:${extendAbove}), below=${positionBelow}(extend:${extendBelow}) → ${chooseAbove ? 'ABOVE' : 'BELOW'} ${Math.abs(extendAbove - extendBelow) < 0.1 ? '[TIE-BROKEN]' : ''}`);
    
    return chooseAbove;
  }

  private processOperation(
    operation: GraphNode,
    nodeMap: Map<string, GraphNode>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    processedNodes: Set<string>
  ): void {
    if (this.debug) console.log(`  🔧 Processing operation: ${operation.id}`);
    
    const inputs = inEdges.get(operation.id) || [];
    
    // Calculate average Y of positioned inputs
    let totalY = 0;
    let validInputs = 0;
    
    inputs.forEach(inputId => {
      const inputY = this.nodeYPositions.get(inputId);
      if (inputY !== undefined) {
        totalY += inputY;
        validInputs++;
      }
    });
    
    if (validInputs > 0) {
      // Position operation at center of its inputs
      const operationY = totalY / validInputs;
      this.nodeYPositions.set(operation.id, operationY);
      processedNodes.add(operation.id);
      
      if (this.debug) console.log(`    Positioned operation ${operation.id} at y=${operationY} (center of inputs)`);
      
      // Position operation output horizontally
      const outputs = outEdges.get(operation.id) || [];
      outputs.forEach(outputId => {
        const outputNode = nodeMap.get(outputId);
        if (outputNode?.shape === 'rect') { // Only position rectangle outputs
          this.nodeYPositions.set(outputId, operationY);
          processedNodes.add(outputId);
          if (this.debug) console.log(`    Positioned output ${outputId} at y=${operationY} (horizontal with operation)`);
        }
      });
    }
  }

  private calculateOptimalWidth(): number {
    // Calculate optimal width based on layout type and node structure
    const { layout } = this.options;
    const nodeCount = this.processedNodes.length;
    const edgeCount = this.processedEdges.length;
    
    if (nodeCount === 0) return this.options.width;
    
    const chartMargins = this.dimensions.margin;
    const baseMargin = 10;
    
    if (layout === 'reverse' && edgeCount > 0) {
      // For reverse layout, estimate column-based width requirements
      return this.calculateReverseLayoutWidth(baseMargin, chartMargins);
    } else {
      // For force layout, use node-density based calculation
      return this.calculateForceLayoutWidth(baseMargin, chartMargins);
    }
  }
  
  private calculateReverseLayoutWidth(baseMargin: number, chartMargins: any): number {
    // Estimate column structure for reverse layout
    const nodeCount = this.processedNodes.length;
    const edgeCount = this.processedEdges.length;
    
    // More conservative column estimation
    let estimatedColumns;
    if (nodeCount <= 4) {
      estimatedColumns = Math.min(nodeCount, 3); // Small graphs: fewer columns
    } else {
      estimatedColumns = Math.min(Math.ceil(Math.sqrt(nodeCount) * 1.2), 5); // Reduced max columns
    }
    
    // Calculate maximum node width across all nodes with generous padding
    let maxNodeWidth = this.options.nodeSize * 2; // Minimum for circles
    let hasDividedLabels = false;
    
    this.processedNodes.forEach(node => {
      const segments = this.parseLabelSegments(node.text);
      if (segments) hasDividedLabels = true;
      
      if (node.shape === 'rect') {
        const width = this.calculateNodeWidth(node, segments);
        maxNodeWidth = Math.max(maxNodeWidth, width);
      }
    });
    
    // More generous spacing calculations
    const baseColumnSpacing = hasDividedLabels ? 150 : 120; // Extra space for divided labels
    const columnSpacing = Math.max(baseColumnSpacing, maxNodeWidth + 80); // More generous spacing
    const totalColumnsWidth = (estimatedColumns - 1) * columnSpacing;
    const nodeMargins = maxNodeWidth + 25; // Extra margin for node boundaries
    const requiredInnerWidth = totalColumnsWidth + nodeMargins + 2 * baseMargin;
    
    // More generous minimum widths
    let minWidth;
    if (nodeCount <= 3) {
      minWidth = Math.max(500, maxNodeWidth * 2.5); // Small graphs need more space per node
    } else if (hasDividedLabels) {
      minWidth = Math.max(600, nodeCount * 100); // Divided labels need extra space
    } else {
      minWidth = Math.max(400, nodeCount * 75); // Standard minimum
    }
    
    const finalInnerWidth = Math.max(requiredInnerWidth, minWidth);
    const result = Math.ceil(finalInnerWidth + chartMargins.left + chartMargins.right);
    
    // Debug output in SVG comments
    if (this.debug) this.svgElements.push(`<!-- WIDTH-DEBUG: nodes=${nodeCount}, cols=${estimatedColumns}, maxNodeW=${maxNodeWidth}, spacing=${columnSpacing}, minW=${minWidth}, final=${result} -->`);
    
    return result;
  }
  
  private calculateForceLayoutWidth(baseMargin: number, chartMargins: any): number {
    // For force layout, estimate based on node density and connections
    const nodeCount = this.processedNodes.length;
    const edgeCount = this.processedEdges.length;
    
    // Calculate maximum node width for proper spacing
    let maxNodeWidth = this.options.nodeSize * 2;
    let hasDividedLabels = false;
    
    this.processedNodes.forEach(node => {
      const segments = this.parseLabelSegments(node.text);
      if (segments) hasDividedLabels = true;
      
      if (node.shape === 'rect') {
        const width = this.calculateNodeWidth(node, segments);
        maxNodeWidth = Math.max(maxNodeWidth, width);
      }
    });
    
    // Estimate required space based on node count and connectivity
    const avgDegree = edgeCount > 0 ? (edgeCount * 2) / nodeCount : 1;
    const densityFactor = Math.min(avgDegree / 2, 2.5); // More generous density factor
    
    // More generous base calculation
    const nodeSpacing = maxNodeWidth + (hasDividedLabels ? 60 : 50); // Extra space for divided labels
    const baseWidth = Math.sqrt(nodeCount) * nodeSpacing * Math.max(densityFactor, 1.5);
    const requiredInnerWidth = Math.max(baseWidth, maxNodeWidth * 4) + 2 * baseMargin;
    
    // More generous minimum widths for force layouts
    let minWidth;
    if (nodeCount <= 3) {
      minWidth = Math.max(450, maxNodeWidth * 2.5);
    } else if (hasDividedLabels) {
      minWidth = Math.max(550, nodeCount * 90); // Divided labels need more space
    } else {
      minWidth = Math.max(400, nodeCount * 70); // Standard minimum
    }
    
    const finalInnerWidth = Math.max(requiredInnerWidth, minWidth);
    const result = Math.ceil(finalInnerWidth + chartMargins.left + chartMargins.right);
    
    // Debug output in SVG comments
    if (this.debug) this.svgElements.push(`<!-- FORCE-WIDTH-DEBUG: nodes=${nodeCount}, edges=${edgeCount}, maxNodeW=${maxNodeWidth}, density=${densityFactor.toFixed(2)}, minW=${minWidth}, final=${result} -->`);
    
    return result;
  }

  private adjustCanvasToBounds(): boolean {
    // Returns true if canvas was resized, false otherwise
    // Only auto-size dimensions that user didn't specify
    
    if (this.processedNodes.length === 0) return false;
    
    // If user specified both dimensions, don't change anything
    if (this.explicitDimensions.width && this.explicitDimensions.height) {
      return false;
    }
    
    let updated = false;
    const originalWidth = this.options.width;
    const originalHeight = this.options.height;
    
    // Smart width calculation if width not explicitly set
    if (!this.explicitDimensions.width) {
      const optimalWidth = this.calculateOptimalWidth();
      if (this.debug) this.svgElements.push(`<!-- AUTO-WIDTH: Calculated ${optimalWidth}px (was ${originalWidth}px) -->`);
      
      // Always apply calculated width when user didn't specify width
      this.options.width = optimalWidth;
      updated = true;
    }
    
    // Smart height calculation if height not explicitly set
    if (!this.explicitDimensions.height) {
      const optimalHeight = this.calculateOptimalHeight();
      if (this.debug) this.svgElements.push(`<!-- AUTO-HEIGHT: Calculated ${optimalHeight}px (was ${originalHeight}px) -->`);
      
      // Always apply calculated height when user didn't specify height
      this.options.height = optimalHeight;
      updated = true;
    }
    
    // Recalculate dimensions if any changes were made
    if (updated) {
      this.dimensions = this.calculateDimensions();
      if (this.debug) this.svgElements.push(`<!-- FINAL-DIMENSIONS: ${this.options.width}x${this.options.height}px -->`);
      return true;
    }
    
    return false;
  }
  
  private calculateOptimalHeight(): number {
    // Calculate optimal height based on positioned nodes or estimates
    const chartMargins = this.dimensions.margin;
    const baseMargin = 10;
    
    // If nodes are positioned, use actual bounds
    const allYPositions = this.processedNodes.map(node => node.y).filter(y => y !== undefined) as number[];
    
    if (allYPositions.length > 0) {
      // Use actual positioned bounds
      const nodeMargin = this.options.nodeSize * 1.2; // Account for node height
      const minY = Math.min(...allYPositions) - nodeMargin;
      const maxY = Math.max(...allYPositions) + nodeMargin;
      const contentHeight = maxY - minY;
      const requiredInnerHeight = contentHeight + 2 * baseMargin;
      
      return Math.ceil(requiredInnerHeight + chartMargins.top + chartMargins.bottom);
    } else {
      // Estimate based on node count and layout
      const nodeCount = this.processedNodes.length;
      const minNodeSpacing = 60;
      const estimatedHeight = nodeCount * minNodeSpacing + 2 * baseMargin;
      const minHeight = Math.max(300, estimatedHeight);
      
      return Math.ceil(minHeight + chartMargins.top + chartMargins.bottom);
    }
  }


  private processOperationChain(
    nodeMap: Map<string, GraphNode>,
    directConnections: Array<{source: string, target: string, priority: number}>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // RESTORED: Process operations in topological order to handle dual-role nodes correctly
    
    // Create topological ordering of operations
    const operations = this.processedNodes.filter(node => node.shape === 'circle');
    const operationQueue = [...operations]; // Simple queue for now, could improve with proper topological sort
    
    // Process each operation
    operationQueue.forEach(operation => {
      const inputs = inEdges.get(operation.id) || [];
      
      // Calculate average Y of positioned inputs
      let totalY = 0;
      let validInputs = 0;
      
      inputs.forEach(inputId => {
        const inputY = this.nodeYPositions.get(inputId);
        if (inputY !== undefined) {
          totalY += inputY;
          validInputs++;
        }
      });
      
      if (validInputs > 0) {
        // Position operation at center of its inputs
        const operationY = totalY / validInputs;
        this.nodeYPositions.set(operation.id, operationY);
        processedNodes.add(operation.id);
        
        // Position operation output horizontally
        const outputs = outEdges.get(operation.id) || [];
        outputs.forEach(outputId => {
          const outputNode = nodeMap.get(outputId);
          if (outputNode?.shape === 'rect') { // Only position rectangle outputs
            this.nodeYPositions.set(outputId, operationY);
            processedNodes.add(outputId);
          }
        });
      }
    });
    
    // Now reposition intermediate nodes that are inputs to other operations
    this.repositionIntermediateNodes(nodeMap, inEdges, outEdges, minNodeSpacing, processedNodes);
  }

  private repositionIntermediateNodes(
    nodeMap: Map<string, GraphNode>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // RESTORED: Reposition nodes that are both operation outputs AND inputs to other operations
    // This ensures diagonal connections for subsequent operations
    
    this.processedNodes.forEach(node => {
      if (node.shape === 'rect' && processedNodes.has(node.id)) {
        // Check if this node is input to any operation
        const isInputToOperation = outEdges.get(node.id)?.some(targetId => {
          const targetNode = nodeMap.get(targetId);
          return targetNode?.shape === 'circle';
        }) || false;
        
        if (isInputToOperation) {
          // Find the operation(s) this node feeds into
          const targetOperations = outEdges.get(node.id)?.filter(targetId => {
            const targetNode = nodeMap.get(targetId);
            return targetNode?.shape === 'circle';
          }) || [];
          
          // For each target operation, ensure this node creates diagonal edge
          targetOperations.forEach(operationId => {
            const operationY = this.nodeYPositions.get(operationId);
            const currentY = this.nodeYPositions.get(node.id);
            
            if (operationY !== undefined && currentY !== undefined) {
              // If node is at same Y as operation, add small offset for diagonal
              if (Math.abs(currentY - operationY) < 1.0) {
                const offset = minNodeSpacing * 0.4;
                this.nodeYPositions.set(node.id, operationY + offset);
              }
            }
          });
        }
      }
    });
  }


  private positionInputNodes(
    columns: string[][],
    nodeMap: Map<string, GraphNode>,
    directConnections: Array<{source: string, target: string, priority: number}>,
    usableHeight: number,
    margin: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Position input nodes (rectangles that are NOT operation outputs)
    
    // Identify nodes that are operation outputs (should not be positioned as inputs)
    const operationOutputs = new Set<string>();
    directConnections.forEach(({target}) => {
      operationOutputs.add(target);
    });
    
    // Find input nodes: rectangles that are not operation outputs
    const inputNodes: string[] = [];
    this.processedNodes.forEach(node => {
      if (node.shape === 'rect' && !operationOutputs.has(node.id)) {
        inputNodes.push(node.id);
      }
    });
    
    // Distribute input nodes evenly across the available height
    if (inputNodes.length > 0) {
      const spacing = inputNodes.length > 1 ? usableHeight / (inputNodes.length - 1) : 0;
      
      inputNodes.forEach((nodeId, index) => {
        const y = margin + index * spacing;
        this.nodeYPositions.set(nodeId, y);
        processedNodes.add(nodeId);
      });
    }
  }

  private centerOperationsAmongInputs(
    nodeMap: Map<string, GraphNode>,
    inEdges: Map<string, string[]>,
    processedNodes: Set<string>
  ): void {
    // Center each operation at the average Y position of its inputs
    
    this.processedNodes.forEach(node => {
      if (node.shape === 'circle') { // This is an operation
        const inputs = inEdges.get(node.id) || [];
        
        if (inputs.length > 0) {
          // Calculate average Y position of inputs
          let totalY = 0;
          let validInputs = 0;
          
          inputs.forEach(inputId => {
            const inputY = this.nodeYPositions.get(inputId);
            if (inputY !== undefined) {
              totalY += inputY;
              validInputs++;
            }
          });
          
          if (validInputs > 0) {
            const averageY = totalY / validInputs;
            this.nodeYPositions.set(node.id, averageY);
            processedNodes.add(node.id);
          }
        }
      }
    });
  }

  private positionResultNodesHorizontally(
    directConnections: Array<{source: string, target: string, priority: number}>,
    processedNodes: Set<string>
  ): void {
    // Position result nodes at the same Y as their operation sources (for horizontal arrows)
    
    directConnections.forEach(({source, target}) => {
      const operationY = this.nodeYPositions.get(source);
      if (operationY !== undefined) {
        this.nodeYPositions.set(target, operationY);
        processedNodes.add(target);
      }
    });
  }

  private positionInputsAroundOperations(
    columns: string[][],
    processedNodes: Set<string>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>,
    usableHeight: number,
    margin: number,
    minNodeSpacing: number
  ): void {
    // Position input nodes to be distributed around their operation targets
    
    // Get node shape information
    const nodeMap = new Map<string, GraphNode>();
    this.processedNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });
    
    // For each operation node that has been positioned
    processedNodes.forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      if (node?.shape === 'circle') { // This is an operation
        const operationY = this.nodeYPositions.get(nodeId)!;
        const inputs = inEdges.get(nodeId) || [];
        
        // Find unprocessed input nodes
        const unprocessedInputs = inputs.filter(inputId => !processedNodes.has(inputId));
        
        if (unprocessedInputs.length > 0) {
          // Distribute inputs vertically around the operation
          this.distributeInputsAroundOperation(unprocessedInputs, operationY, minNodeSpacing, processedNodes);
        }
      }
    });
  }

  private distributeInputsAroundOperation(
    inputNodes: string[],
    operationY: number,
    minNodeSpacing: number,
    processedNodes: Set<string>
  ): void {
    // Distribute input nodes symmetrically around the operation Y position
    
    if (inputNodes.length === 1) {
      // Single input - can be at same Y as operation (will create diagonal due to column difference)
      this.nodeYPositions.set(inputNodes[0], operationY);
      processedNodes.add(inputNodes[0]);
    } else if (inputNodes.length === 2) {
      // Two inputs - place above and below operation
      const offset = minNodeSpacing * 0.7; // Slightly less than full spacing for better visual balance
      this.nodeYPositions.set(inputNodes[0], operationY - offset);
      this.nodeYPositions.set(inputNodes[1], operationY + offset);
      processedNodes.add(inputNodes[0]);
      processedNodes.add(inputNodes[1]);
    } else {
      // Multiple inputs - distribute evenly around operation
      const totalSpread = (inputNodes.length - 1) * minNodeSpacing * 0.6;
      const startY = operationY - totalSpread / 2;
      
      inputNodes.forEach((inputId, index) => {
        const y = startY + index * (totalSpread / Math.max(1, inputNodes.length - 1));
        this.nodeYPositions.set(inputId, y);
        processedNodes.add(inputId);
      });
    }
  }

  private findBestYPosition(
    source: string,
    target: string,
    columns: string[][],
    usableHeight: number,
    margin: number,
    minNodeSpacing: number
  ): number {
    // Find a good Y position for this connected pair
    // For now, distribute pairs evenly across the available height
    
    const numExistingPositions = this.nodeYPositions.size / 2; // Each pair adds 2 nodes
    const availablePositions = Math.floor(usableHeight / minNodeSpacing) + 1;
    const spacing = usableHeight / Math.max(1, availablePositions - 1);
    
    return margin + numExistingPositions * spacing;
  }

  private positionUnconstrainedNodes(
    columns: string[][],
    processedNodes: Set<string>,
    usableHeight: number,
    margin: number,
    minNodeSpacing: number
  ): void {
    // Position nodes that don't have direct connection constraints
    // Distribute them around the constrained nodes
    
    columns.forEach((column, columnIndex) => {
      const unconstrainedNodes = column.filter(nodeId => !processedNodes.has(nodeId));
      
      if (unconstrainedNodes.length === 0) return;
      
      // Get existing Y positions in this column
      const constrainedNodesInColumn = column.filter(nodeId => processedNodes.has(nodeId));
      const existingYPositions = constrainedNodesInColumn
        .map(nodeId => this.nodeYPositions.get(nodeId)!)
        .sort((a, b) => a - b);
      
      // Find gaps and distribute unconstrained nodes
      if (existingYPositions.length === 0) {
        // No constrained nodes in this column - distribute evenly
        this.distributeNodesEvenly(unconstrainedNodes, usableHeight, margin);
      } else {
        // Fill gaps around constrained nodes
        this.fillGapsAroundConstrainedNodes(unconstrainedNodes, existingYPositions, usableHeight, margin, minNodeSpacing);
      }
    });
  }

  private distributeNodesEvenly(nodeIds: string[], usableHeight: number, margin: number): void {
    const spacing = nodeIds.length > 1 ? usableHeight / (nodeIds.length - 1) : 0;
    
    nodeIds.forEach((nodeId, index) => {
      const y = margin + index * spacing;
      this.nodeYPositions.set(nodeId, y);
    });
  }

  private fillGapsAroundConstrainedNodes(
    unconstrainedNodes: string[],
    existingYPositions: number[],
    usableHeight: number,
    margin: number,
    minNodeSpacing: number
  ): void {
    // Simple strategy: place unconstrained nodes between constrained ones
    let nodeIndex = 0;
    
    for (let i = 0; i < existingYPositions.length + 1 && nodeIndex < unconstrainedNodes.length; i++) {
      let gapStart = i === 0 ? margin : existingYPositions[i - 1] + minNodeSpacing;
      let gapEnd = i === existingYPositions.length ? margin + usableHeight : existingYPositions[i] - minNodeSpacing;
      
      // Place nodes in this gap if there's space
      if (gapEnd > gapStart && nodeIndex < unconstrainedNodes.length) {
        const y = (gapStart + gapEnd) / 2; // Center in the gap
        this.nodeYPositions.set(unconstrainedNodes[nodeIndex], y);
        nodeIndex++;
      }
    }
    
    // If we still have nodes left, space them out more aggressively
    while (nodeIndex < unconstrainedNodes.length) {
      const y = margin + Math.random() * usableHeight; // Fallback random positioning
      this.nodeYPositions.set(unconstrainedNodes[nodeIndex], y);
      nodeIndex++;
    }
  }

  private resolveHorizontalConstraints(
    constraints: Array<{source: string, target: string, priority: number}>,
    columns: string[][]
  ): Map<string, number> {
    // Resolve conflicting constraints by assigning Y positions
    // Higher priority constraints get satisfied first
    
    const nodePositions = new Map<string, number>(); // nodeId -> Y position index
    const positionOccupied = new Set<string>(); // "columnIndex_position" -> occupied
    
    // Process constraints in priority order
    constraints.forEach(constraint => {
      const {source, target} = constraint;
      
      // Check if either node already has a position assigned
      const sourcePos = nodePositions.get(source);
      const targetPos = nodePositions.get(target);
      
      if (sourcePos !== undefined && targetPos !== undefined) {
        // Both already positioned - skip if they conflict
        return;
      }
      
      if (sourcePos !== undefined) {
        // Source has position, try to align target
        this.assignPositionIfPossible(target, sourcePos, columns, nodePositions, positionOccupied);
      } else if (targetPos !== undefined) {
        // Target has position, try to align source  
        this.assignPositionIfPossible(source, targetPos, columns, nodePositions, positionOccupied);
      } else {
        // Neither positioned - find best position for both
        const bestPosition = this.findBestPositionForPair(source, target, columns, positionOccupied);
        this.assignPositionIfPossible(source, bestPosition, columns, nodePositions, positionOccupied);
        this.assignPositionIfPossible(target, bestPosition, columns, nodePositions, positionOccupied);
      }
    });
    
    return nodePositions;
  }

  private assignPositionIfPossible(
    nodeId: string,
    position: number,
    columns: string[][],
    nodePositions: Map<string, number>,
    positionOccupied: Set<string>
  ): boolean {
    // Find which column this node is in
    let nodeColumn = -1;
    columns.forEach((column, columnIndex) => {
      if (column.includes(nodeId)) {
        nodeColumn = columnIndex;
      }
    });
    
    if (nodeColumn === -1) return false;
    
    const positionKey = `${nodeColumn}_${position}`;
    
    if (!positionOccupied.has(positionKey)) {
      nodePositions.set(nodeId, position);
      positionOccupied.add(positionKey);
      return true;
    }
    
    return false;
  }

  private findBestPositionForPair(
    source: string,
    target: string,
    columns: string[][],
    positionOccupied: Set<string>
  ): number {
    // Find current positions of both nodes
    let sourceColumn = -1, sourceCurrentPos = -1;
    let targetColumn = -1, targetCurrentPos = -1;
    
    columns.forEach((column, columnIndex) => {
      const sourceIdx = column.indexOf(source);
      const targetIdx = column.indexOf(target);
      
      if (sourceIdx !== -1) {
        sourceColumn = columnIndex;
        sourceCurrentPos = sourceIdx;
      }
      if (targetIdx !== -1) {
        targetColumn = columnIndex;
        targetCurrentPos = targetIdx;
      }
    });
    
    // Try positions around their current average
    const avgPosition = (sourceCurrentPos + targetCurrentPos) / 2;
    const candidates = [
      Math.floor(avgPosition),
      Math.ceil(avgPosition),
      sourceCurrentPos,
      targetCurrentPos
    ];
    
    // Find first available position
    for (const pos of candidates) {
      if (pos >= 0) {
        const sourceKey = `${sourceColumn}_${pos}`;
        const targetKey = `${targetColumn}_${pos}`;
        
        if (!positionOccupied.has(sourceKey) && !positionOccupied.has(targetKey)) {
          return pos;
        }
      }
    }
    
    // Fallback to first available position
    const maxColumnSize = Math.max(...columns.map(col => col.length));
    for (let pos = 0; pos < maxColumnSize + 2; pos++) {
      const sourceKey = `${sourceColumn}_${pos}`;
      const targetKey = `${targetColumn}_${pos}`;
      
      if (!positionOccupied.has(sourceKey) && !positionOccupied.has(targetKey)) {
        return pos;
      }
    }
    
    return 0; // Ultimate fallback
  }

  private applyConstrainedPositioning(
    columns: string[][],
    constrainedPositions: Map<string, number>,
    inEdges: Map<string, string[]>,
    outEdges: Map<string, string[]>
  ): void {
    // Apply positioning while maintaining column grouping by shared targets
    
    columns.forEach((column, columnIndex) => {
      // Create new ordering for this column
      const positioned: Array<{node: string, position: number}> = [];
      const unpositioned: string[] = [];
      
      column.forEach(nodeId => {
        const assignedPosition = constrainedPositions.get(nodeId);
        if (assignedPosition !== undefined) {
          positioned.push({node: nodeId, position: assignedPosition});
        } else {
          unpositioned.push(nodeId);
        }
      });
      
      // Sort positioned nodes by their assigned positions
      positioned.sort((a, b) => a.position - b.position);
      
      // Group unpositioned nodes by their targets (maintain original grouping logic)
      const targetGroups = new Map<string, string[]>();
      unpositioned.forEach(nodeId => {
        const outputs = outEdges.get(nodeId) || [];
        const primaryTarget = outputs.length > 0 ? outputs[0] : '_no_outputs';
        
        if (!targetGroups.has(primaryTarget)) {
          targetGroups.set(primaryTarget, []);
        }
        targetGroups.get(primaryTarget)!.push(nodeId);
      });
      
      // Interleave positioned and unpositioned nodes
      const finalOrder: string[] = [];
      let positionedIndex = 0;
      let nextAvailablePosition = 0;
      
      // Insert positioned nodes at their correct positions
      positioned.forEach(({node, position}) => {
        // Fill gaps with unpositioned nodes
        while (nextAvailablePosition < position && targetGroups.size > 0) {
          const nextGroup = Array.from(targetGroups.values())[0];
          if (nextGroup.length > 0) {
            finalOrder.push(nextGroup.shift()!);
            if (nextGroup.length === 0) {
              targetGroups.delete(Array.from(targetGroups.keys())[0]);
            }
          }
          nextAvailablePosition++;
        }
        
        finalOrder.push(node);
        nextAvailablePosition = Math.max(nextAvailablePosition, position + 1);
      });
      
      // Add remaining unpositioned nodes
      targetGroups.forEach(group => {
        finalOrder.push(...group);
      });
      
      // Update the column
      columns[columnIndex] = finalOrder;
    });
  }

  private computeForceLayout(): void {
    // For force layout, use D3's force simulation
    const { innerWidth, innerHeight } = this.dimensions;
    
    // Create a simple force simulation
    const simulation = forceSimulation(this.processedNodes as any)
      .force('link', forceLink(this.processedEdges as any).id((d: any) => d.id).distance(100))
      .force('charge', forceManyBody().strength(-300))
      .force('center', forceCenter(innerWidth / 2, innerHeight / 2))
      .force('x', forceX(innerWidth / 2).strength(0.1))
      .force('y', forceY(innerHeight / 2).strength(0.1));

    // Run simulation to completion
    for (let i = 0; i < 300; ++i) simulation.tick();
    
    // Ensure positions are within bounds
    this.processedNodes.forEach(node => {
      const margin = this.options.nodeSize + 10;
      node.x = Math.max(margin, Math.min(innerWidth - margin, node.x || innerWidth / 2));
      node.y = Math.max(margin, Math.min(innerHeight - margin, node.y || innerHeight / 2));
    });
  }

  // Override axis rendering - graphs don't need axes
  protected override renderAxes(): void {
    // No axes for graph visualizations
  }

  protected override renderAxisLines(): void {
    // No axis lines for graph visualizations  
  }

  protected override renderAxisLabels(): void {
    // No axis labels for graph visualizations
  }

  public override render(): string {
    // Two-pass rendering for optimal auto-sizing:
    // Pass 1: Compute layout with current dimensions
    this.computeLayout();
    
    // Pass 2: Adjust canvas to fit actual content bounds (if auto-sizing)
    if (this.adjustCanvasToBounds()) {
      // Canvas was resized - recreate scales and re-layout
      this.createScales();
      this.computeLayout();
    }
    
    // Call parent render method
    return super.render();
  }

  protected override renderChartElements(): void {
    // Add a visible test comment to check if changes are being picked up
    if (this.debug) this.svgElements.push(`<!-- TEST: GraphChart changes are working - timestamp: ${Date.now()} -->`);
    this.renderEdges();
    this.renderNodes();
  }

  private renderEdges(): void {
    const { edgeWidth, arrowSize } = this.options;
    const { axis } = this.themeColors;

    // Define arrow marker
    this.svgElements.push(`
      <defs>
        <marker id="arrowhead" markerWidth="${arrowSize}" markerHeight="${arrowSize}" 
                refX="${arrowSize-1}" refY="${arrowSize/2}" orient="auto">
          <polygon points="0 0, ${arrowSize} ${arrowSize/2}, 0 ${arrowSize}" 
                   fill="${axis}" stroke="none"/>
        </marker>
      </defs>
    `);

    this.processedEdges.forEach(edge => {
      const sourceNode = typeof edge.source === 'string' 
        ? this.processedNodes.find(n => n.id === edge.source)
        : edge.source as GraphNode;
      const targetNode = typeof edge.target === 'string'
        ? this.processedNodes.find(n => n.id === edge.target)  
        : edge.target as GraphNode;

      if (!sourceNode || !targetNode || sourceNode.x === undefined || targetNode.x === undefined) return;

      // Calculate edge endpoints (accounting for actual node boundaries)
      const dx = targetNode.x - sourceNode.x;
      const dy = targetNode.y! - sourceNode.y!;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance === 0) return;

      const sourceRadius = this.getNodeBoundaryRadius(sourceNode);
      const targetRadius = this.getNodeBoundaryRadius(targetNode);
      const unitX = dx / distance;
      const unitY = dy / distance;

      const startX = sourceNode.x + unitX * sourceRadius;
      const startY = sourceNode.y! + unitY * sourceRadius;
      const endX = targetNode.x - unitX * targetRadius;
      const endY = targetNode.y! - unitY * targetRadius;

      this.svgElements.push(`
        <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" 
              stroke="${axis}" stroke-width="${edgeWidth}" 
              marker-end="url(#arrowhead)" opacity="0.7"/>
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
    });
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
    
    // If no explicit weights provided, use smart defaults
    if (!hasExplicitWeights) {
      this.applyDefaultWeights(result);
    }
    
    // Normalize weights to sum to 1
    const totalWeight = result.reduce((sum, seg) => sum + (seg.weight || 0), 0);
    if (totalWeight > 0) {
      result.forEach(seg => {
        if (seg.weight) seg.weight /= totalWeight;
      });
    }
    
    return result;
  }
  
  private applyDefaultWeights(segments: LabelSegment[]): void {
    // Smart defaults: first segment smaller for labels, others equal
    const numSegments = segments.length;
    
    if (numSegments === 2) {
      // Two segments: 40% first, 60% second (existing behavior, slightly adjusted)
      segments[0].weight = 0.4;
      segments[1].weight = 0.6;
    } else if (numSegments === 3) {
      // Three segments: 25% first (labels), 45% second (data), 30% third (grad/misc)
      segments[0].weight = 0.25;
      segments[1].weight = 0.45;
      segments[2].weight = 0.30;
    } else {
      // More segments: 20% first, others equal
      segments[0].weight = 0.2;
      const remainingWeight = 0.8;
      const equalWeight = remainingWeight / (numSegments - 1);
      for (let i = 1; i < numSegments; i++) {
        segments[i].weight = equalWeight;
      }
    }
  }

  protected override estimateTextWidth(text: string, fontSize: number = 12): number {
    // Rough estimation: average character width is ~0.6 * fontSize for most fonts
    // This is a simple approximation that works reasonably well for Arial/sans-serif
    const avgCharWidth = fontSize * 0.6;
    return text.length * avgCharWidth;
  }

  private calculateNodeWidth(node: GraphNode, segments: LabelSegment[] | null): number {
    const { nodeSize } = this.options;
    const minWidth = nodeSize * 1.5;
    const maxWidth = nodeSize * 16;
    const padding = 10; // Horizontal padding inside the node
    
    if (segments && segments.length > 0) {
      // Divided node: calculate width needed for all segments plus padding and dividers
      let totalTextWidth = 0;
      const fontSize = 11;
      
      // Calculate text width for each segment weighted by their allocation
      segments.forEach(segment => {
        const segmentTextWidth = this.estimateTextWidth(segment.text, fontSize);
        // Ensure minimum readable width per segment, adjust by weight
        const weightedWidth = Math.max(segmentTextWidth, fontSize * 3) / (segment.weight || 0.1);
        totalTextWidth = Math.max(totalTextWidth, weightedWidth);
      });
      
      // Add space for dividers (2px per divider) and padding
      const dividerSpace = (segments.length - 1) * 2;
      const totalWidth = totalTextWidth + padding * 2 + dividerSpace;
      
      return Math.max(minWidth, Math.min(maxWidth, totalWidth));
    } else {
      // Simple node: calculate width needed for the text plus padding
      const textWidth = this.estimateTextWidth(node.text, 12);
      const totalWidth = textWidth + padding;
      return Math.max(minWidth, Math.min(maxWidth, totalWidth));
    }
  }

  private getNodeBoundaryRadius(node: GraphNode): number {
    // Calculate the effective radius for edge connection based on node shape
    const { nodeSize } = this.options;
    
    if (node.shape === 'circle') {
      return nodeSize; // Use actual radius for circles
    } else {
      // For rectangles, calculate radius based on dynamic width
      const segments = this.parseLabelSegments(node.text);
      const width = this.calculateNodeWidth(node, segments);
      const height = nodeSize * 1.5;
      
      // Use half the width as the effective radius for horizontal connections
      // This ensures arrows connect to the rectangle edge, not the center
      return width / 2;
    }
  }

  private processNodeColor(color: string): string {
    // Use BaseChart's named color processing logic
    const namedColor = BaseChart.NAMED_COLORS[color.toLowerCase()];
    if (namedColor) {
      return namedColor;
    }
    // Return as-is if it's already a hex code or other valid CSS color
    return color;
  }

  private renderNodes(): void {
    const { nodeSize } = this.options;
    const { text, background } = this.themeColors;

    this.processedNodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;

      const color = node.color ? this.processNodeColor(node.color) : this.colorScale(node.id);
      const segments = this.parseLabelSegments(node.text);
      
      if (node.shape === 'circle') {
        // Circular node for operations (no dividers supported)
        this.svgElements.push(`
          <circle cx="${node.x}" cy="${node.y}" r="${nodeSize}" 
                  fill="${color}" stroke="${background}" stroke-width="2" 
                  opacity="0.9">
            <title>${node.tooltip || node.text}</title>
          </circle>
        `);
        
        // Simple text for circular nodes (concatenate all segments)
        const displayText = segments ? segments.map(s => s.text).join('') : node.text;
        this.svgElements.push(`
          <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" 
                fill="${text}" font-size="12px" font-weight="600"
                pointer-events="none">${displayText}</text>
        `);
      } else {
        // Rectangular node - support dividers
        if (segments && segments.length > 0) {
          // Multi-segment rectangular node - calculate width dynamically
          const width = this.calculateNodeWidth(node, segments);
          const height = nodeSize * 1.5;
          
          this.svgElements.push(`
            <rect x="${node.x - width/2}" y="${node.y - height/2}" 
                  width="${width}" height="${height}" rx="4"
                  fill="${color}" stroke="${background}" stroke-width="2" 
                  opacity="0.9">
              <title>${node.tooltip || node.text}</title>
            </rect>
          `);
          
          // Draw dividers and text for each segment
          this.renderSegmentedNode(node, segments, width, height, text);
        } else {
          // Simple rectangular node - calculate width dynamically
          const width = this.calculateNodeWidth(node, null);
          const height = nodeSize * 1.5;
          this.svgElements.push(`
            <rect x="${node.x - width/2}" y="${node.y - height/2}" 
                  width="${width}" height="${height}" rx="4"
                  fill="${color}" stroke="${background}" stroke-width="2" 
                  opacity="0.9">
              <title>${node.tooltip || node.text}</title>
            </rect>
          `);
          
          // Simple text
          this.svgElements.push(`
            <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" 
                  fill="${text}" font-size="12px" font-weight="600"
                  pointer-events="none">${node.text}</text>
          `);
        }
      }
    });
  }

  private renderSegmentedNode(node: GraphNode, segments: LabelSegment[], width: number, height: number, textColor: string): void {
    const numSegments = segments.length;
    const nodeX = node.x!;
    const nodeY = node.y!;
    
    // Calculate segment positions based on weights
    let currentX = nodeX - width / 2;
    
    for (let i = 0; i < numSegments; i++) {
      const segment = segments[i];
      const segmentWidth = width * (segment.weight || (1 / numSegments));
      const segmentCenterX = currentX + segmentWidth / 2;
      
      // Draw vertical divider (except before first segment)
      if (i > 0) {
        this.svgElements.push(`
          <line x1="${currentX}" y1="${nodeY - height/2}" 
                x2="${currentX}" y2="${nodeY + height/2}" 
                stroke="${textColor}" stroke-width="1" opacity="0.6"/>
        `);
      }
      
      // Draw segment text
      this.svgElements.push(`
        <text x="${segmentCenterX}" y="${nodeY + 4}" text-anchor="middle" 
              fill="${textColor}" font-size="11px" font-weight="600"
              pointer-events="none">${segment.text}</text>
      `);
      
      currentX += segmentWidth;
    }
  }
}

// Custom CLI handling for graph data structure
if (import.meta.main) {
  try {
    const inputArg = Deno.args[0];
    if (!inputArg) {
      console.error('Error: No input data provided');
      console.error('Usage: deno run --allow-all GraphChart.ts DATA_JSON');
      Deno.exit(1);
    }

    const input = JSON.parse(inputArg);
    
    if (!input.data || !input.data.nodes || !Array.isArray(input.data.nodes) || !Array.isArray(input.data.edges)) {
      console.error('Error: Invalid data format. Expected {data: {nodes: [...], edges: [...]}}');
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

export { GraphChart as createGraphChart };