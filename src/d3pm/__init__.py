"""
d3pm - D3.js charts for Python via Deno

Academic-style visualizations powered by D3.js through Deno runtime.
Provides clean, publication-ready charts with mathematical precision.

Features:
- Bar charts: For histograms and frequency distributions
- Line charts: For continuous data and time series  
- Scatter plots: For correlation analysis and point data
- Histogram charts: For statistical distributions
- Chart composition with +, *, / operators
- SVG output for high-quality publications

Usage:
    import d3pm
    
    # Create charts
    chart1 = d3pm.bar(data, {"title": "Bar Chart"}, width=400)
    chart2 = d3pm.scatter(data, {"title": "Scatter"}, width=500) 
    
    # Display charts
    display(chart1)        # Jupyter: direct SVG display
    chart1.plot()          # Explicit plotting method
    
    # Compose charts
    horizontal = chart1 + chart2  # Side-by-side
    overlay = chart1 * chart2     # Superimposed
    vertical = chart1 / chart2    # Top-bottom
"""

from .bridge import bar, line, scatter, hist, Chart, D3DenoBridge

__version__ = "0.1.0"
__author__ = "Tim Nelson"

__all__ = ['bar', 'line', 'scatter', 'hist', 'Chart', 'D3DenoBridge']