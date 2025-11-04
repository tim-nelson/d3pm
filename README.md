# d3pm - D3.js Charts for Python

Academic-style visualizations powered by D3.js through Deno runtime.

## Features

- **Bar charts**: For histograms and frequency distributions
- **Line charts**: For continuous data and time series  
- **Scatter plots**: For correlation analysis and point data
- **Histogram charts**: For statistical distributions
- **Heatmap charts**: For 2D matrix visualization with color mapping
- **Graph visualization**: For networks, neural networks, and computational graphs
- **Chart composition**: Combine charts with `+`, `*`, `/` operators
- **SVG output**: High-quality publications ready
- **Academic styling**: Clean, minimal design optimized for research

## Requirements

- Python 3.8+
- [Deno](https://deno.land/manual/getting_started/installation) runtime

## Installation

```bash
pip install d3pm
```

For development:
```bash
pip install -e .
```

## Quick Start

```python
import d3pm

# Create a simple bar chart
categories = ["A", "B", "C"]
values = [10, 20, 15]
chart = d3pm.bar(categories, values)

# Display in Jupyter
display(chart)

# Or use explicit plotting
chart.plot()

# With titles and labels
chart = d3pm.bar(categories, values, title="Sample Data", ylabel="Count")

# Compose charts
chart1 = d3pm.bar(["X", "Y"], [10, 20])
chart2 = d3pm.line([1, 2, 3], [5, 10, 7])

# Side by side
combined = chart1 + chart2

# Overlaid (for line/scatter)
line1 = d3pm.line(x1, y1, label="Series 1")
line2 = d3pm.line(x2, y2, label="Series 2")
overlaid = line1 * line2

# Vertical
stacked = chart1 / chart2
```

## Chart Types

### Bar Chart
```python
categories = ["A", "B", "C"]
values = [10, 20, 15]
d3pm.bar(categories, values, title="Bar Chart", xlabel="Categories", ylabel="Values")
```

### Line Chart
```python
# Single series
x = [1, 2, 3, 4]
y = [10, 15, 12, 18]
d3pm.line(x, y, title="Time Series")

# Multiple series
d3pm.line([x1, x2], [y1, y2], label=["Series A", "Series B"])
```

### Scatter Plot
```python
x = [1, 2, 3, 4]
y = [2, 4, 1, 5]
d3pm.scatter(x, y, title="Scatter Plot")

# With variable point sizes
sizes = [5, 10, 8, 12]
d3pm.scatter(x, y, size=sizes, title="Bubble Chart")
```

### Histogram
```python
# From raw data
data = [1.2, 1.5, 2.1, 1.8, 2.3, 1.9, 2.0]
d3pm.hist(data, title="Distribution")

# Custom number of bins
d3pm.hist(data, bins=10, title="Distribution")
```

### Heatmap Charts
```python
# 2D matrix visualization with color mapping
data = [
    {"x": 0, "y": 0, "value": 10}, 
    {"x": 1, "y": 0, "value": 20},
    {"x": 0, "y": 1, "value": 15}
]
d3pm.imshow(data, title="Heatmap Example", colormap="viridis")

# With custom colormap and dimensions
d3pm.imshow(data, colormap="Blues", title="Temperature Map", 
           rows=2, cols=2, aspect="equal")
```

### Graph Visualization
```python
# Define nodes with shapes and labels
nodes = [
    d3pm.Node("a", "2.0", "rect"),      # Rectangular node for values  
    d3pm.Node("b", "-3.0", "rect"),
    d3pm.Node("mul1", "*", "circle"),   # Circular node for operations
    d3pm.Node("result", "-6.0", "rect")
]

# Define edges connecting nodes
edges = [
    d3pm.Edge("a", "mul1"),      # a -> *
    d3pm.Edge("b", "mul1"),      # b -> *  
    d3pm.Edge("mul1", "result")  # * -> result
]

# Create computational graph with fixed left-to-right layout
d3pm.graph(nodes, edges, layout='fixed', title="Computational Graph")

# Or use force-directed layout for interactive exploration
d3pm.graph(nodes, edges, layout='force', title="Network Graph")
```

**Computational Graph Example:**
```python
# Neural network computation: a*b + c*f
nodes = [
    d3pm.Node("a", "2.0", "rect"), d3pm.Node("b", "-3.0", "rect"),
    d3pm.Node("mul1", "*", "circle"), d3pm.Node("e", "-6.0", "rect"),
    d3pm.Node("c", "10.0", "rect"), d3pm.Node("add1", "+", "circle"),
    d3pm.Node("d", "4.0", "rect"), d3pm.Node("f", "-2.0", "rect"),
    d3pm.Node("mul2", "*", "circle"), d3pm.Node("L", "-8.0", "rect")
]

edges = [
    d3pm.Edge("a", "mul1"), d3pm.Edge("b", "mul1"), d3pm.Edge("mul1", "e"),
    d3pm.Edge("e", "add1"), d3pm.Edge("c", "add1"), d3pm.Edge("add1", "d"),
    d3pm.Edge("d", "mul2"), d3pm.Edge("f", "mul2"), d3pm.Edge("mul2", "L")
]

d3pm.graph(nodes, edges, layout='fixed', title="Neural Network Forward Pass")
```

## License

MIT