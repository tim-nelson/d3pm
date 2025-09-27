# d3pm - D3.js Charts for Python

Academic-style visualizations powered by D3.js through Deno runtime.

## Features

- **Bar charts**: For histograms and frequency distributions
- **Line charts**: For continuous data and time series  
- **Scatter plots**: For correlation analysis and point data
- **Histogram charts**: For statistical distributions
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

## License

MIT