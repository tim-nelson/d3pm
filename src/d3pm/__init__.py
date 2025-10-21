"""
d3pm - D3.js charts for Python via Deno

Academic-style visualizations powered by D3.js through Deno runtime.
Provides clean, publication-ready charts with mathematical precision.

Features:
- Bar charts: For histograms and frequency distributions
- Line charts: For continuous data and time series  
- Scatter plots: For correlation analysis and point data
- Histogram charts: For statistical distributions
- Graph visualization: For networks, neural networks, and computational graphs
- Chart composition with +, *, / operators
- SVG output for high-quality publications

Usage:
    import d3pm
    
    # Create basic charts
    chart1 = d3pm.bar(categories, values, title="Bar Chart")
    chart2 = d3pm.scatter(x_data, y_data, title="Scatter Plot") 
    
    # Create graph visualizations
    nodes = [d3pm.Node("a", "2.0", "rect"), d3pm.Node("op", "+", "circle")]
    edges = [d3pm.Edge("a", "op")]
    graph_chart = d3pm.graph(nodes, edges, layout='fixed', title="Computation")
    
    # Display charts
    display(chart1)        # Jupyter: direct SVG display
    chart1.show()          # Explicit display method
    
    # Compose charts
    horizontal = chart1 + chart2  # Side-by-side
    overlay = chart1 * chart2     # Superimposed
    vertical = chart1 / chart2    # Top-bottom
"""

from .bridge import bar, line, scatter, hist, graph, Chart, D3DenoBridge, Node, Edge

__version__ = "0.1.0"
__author__ = "Tim Nelson"

__all__ = ['bar', 'line', 'scatter', 'hist', 'graph', 'Chart', 'D3DenoBridge', 'Node', 'Edge']