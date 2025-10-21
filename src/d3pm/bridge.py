"""
D3 Deno Bridge - Python interface to Deno D3.js chart generators
Handles subprocess communication and SVG generation
"""

import subprocess
import json
import os
from typing import Dict, List, Any, Optional, Union, Literal
from dataclasses import dataclass, asdict

# Optional imports for Jupyter notebook support
try:
    import ipywidgets as widgets
    from IPython.display import display
    JUPYTER_AVAILABLE = True
except ImportError:
    widgets = None
    display = None
    JUPYTER_AVAILABLE = False


@dataclass
class ChartConfig:
    """Shared configuration for chart styling and dimensions."""
    title: Optional[str] = None
    xlabel: Optional[str] = None
    ylabel: Optional[str] = None
    width: int = 320
    height: int = 240
    show: bool = False


@dataclass 
class Node:
    """Graph node with shape, text content, and optional styling."""
    id: str
    text: str
    shape: Literal['rect', 'circle']
    x: Optional[float] = None
    y: Optional[float] = None
    color: Optional[str] = None
    tooltip: Optional[str] = None


@dataclass
class Edge:
    """Graph edge connecting two nodes with optional label."""
    source: str
    target: str
    label: Optional[str] = None


def _build_chart_options(config: ChartConfig, **kwargs) -> Dict[str, Any]:
    """Build options dictionary from ChartConfig and additional kwargs."""
    options = {}
    if config.title is not None:
        options['title'] = config.title
    if config.xlabel is not None:
        options['xLabel'] = config.xlabel  
    if config.ylabel is not None:
        options['yLabel'] = config.ylabel
    
    # Only include width/height in options if explicitly provided
    if config.width is not None:
        options['width'] = config.width
    if config.height is not None:
        options['height'] = config.height
    
    # Add any additional kwargs
    options.update(kwargs)
    return options


class D3DenoBridge:
    """
    Bridge between Python and Deno D3.js chart generators.
    Handles data serialization, subprocess calls, and SVG rendering.
    """
    
    def __init__(self, deno_path: str = "deno"):
        """
        Initialize the D3 Deno bridge.
        
        Args:
            deno_path: Path to Deno executable (default: "deno")
        """
        self.deno_path = deno_path
        self.viz_path = self._find_viz_path()
        
        # Check if Deno is available
        try:
            result = subprocess.run([deno_path, "--version"], 
                                  capture_output=True, text=True, timeout=5)
            if result.returncode != 0:
                raise RuntimeError(f"Deno not found at path: {deno_path}")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            raise RuntimeError(f"Deno not available or not responding at path: {deno_path}")
    
    def _find_viz_path(self) -> str:
        """Find the viz directory containing Deno scripts."""
        # Try current directory first (when running from src/viz/)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        chart_types = ["BarChart", "LineChart", "ScatterChart", "GraphChart"]
        
        # Check if charts are in current directory or charts subdirectory
        if all(os.path.exists(os.path.join(current_dir, f"{chart}.ts")) for chart in chart_types):
            return current_dir
        elif all(os.path.exists(os.path.join(current_dir, "charts", f"{chart}.ts")) for chart in chart_types):
            return os.path.join(current_dir, "charts")
        
        # For Jupyter notebooks, search from current working directory
        cwd = os.getcwd()
        search_dir = cwd
        while search_dir != os.path.dirname(search_dir):  # Stop at filesystem root
            if os.path.exists(os.path.join(search_dir, 'environment.yml')):
                project_root = search_dir
                viz_path = os.path.join(project_root, 'src', 'viz')
                charts_path = os.path.join(viz_path, 'charts')
                
                # Check if charts are in viz/ or viz/charts/
                if all(os.path.exists(os.path.join(viz_path, f"{chart}.ts")) for chart in chart_types):
                    return viz_path
                elif all(os.path.exists(os.path.join(charts_path, f"{chart}.ts")) for chart in chart_types):
                    return charts_path
                break
            search_dir = os.path.dirname(search_dir)
        
        # Fallback: assume we're in notebooks/ and go up one level
        fallback_path = os.path.join(os.path.dirname(cwd), 'src', 'viz')
        fallback_charts_path = os.path.join(fallback_path, 'charts')
        
        if all(os.path.exists(os.path.join(fallback_path, f"{chart}.ts")) for chart in chart_types):
            return fallback_path
        elif all(os.path.exists(os.path.join(fallback_charts_path, f"{chart}.ts")) for chart in chart_types):
            return fallback_charts_path
        
        raise FileNotFoundError(f"Chart scripts not found in {current_dir}, {fallback_path}, or project search")
    
    def _call_deno_script(self, script_name: str, data: Dict[str, Any]) -> str:
        """
        Call a Deno D3 script with data and return SVG string.
        
        Args:
            script_name: Name of the Deno script (e.g., "bar", "line", "scatter")
            data: Chart data and options
            
        Returns:
            SVG string generated by D3.js
        """
        # Map script names to actual file names
        script_mapping = {
            "bar": "BarChart.ts",
            "line": "LineChart.ts", 
            "scatter": "ScatterChart.ts",
            "histogram": "HistogramChart.ts",
            "graph": "GraphChart.ts"
        }
        
        if script_name not in script_mapping:
            raise ValueError(f"Unknown script name: {script_name}")
        
        script_path = os.path.join(self.viz_path, script_mapping[script_name])
        
        if not os.path.exists(script_path):
            raise FileNotFoundError(f"Deno script not found: {script_path}")
        
        # Serialize data to JSON
        json_data = json.dumps(data, ensure_ascii=False)
        
        try:
            # Run Deno script
            result = subprocess.run(
                [self.deno_path, "run", "--allow-all", script_path, json_data],
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                cwd=self.viz_path
            )
            
            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown error occurred"
                raise RuntimeError(f"Deno script failed: {error_msg}")
            
            svg_output = result.stdout.strip()
            if not svg_output:
                raise RuntimeError("Deno script produced no output")
            
            return svg_output
            
        except subprocess.TimeoutExpired:
            raise RuntimeError("Deno script timed out after 30 seconds")
        except Exception as e:
            raise RuntimeError(f"Failed to execute Deno script: {str(e)}")
    
    def create_bar_chart(self, data: List[Dict[str, Union[str, float]]], 
                        options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a bar chart using D3.js via Deno.
        
        Args:
            data: List of {"label": str, "value": float} dictionaries
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("bar", chart_input)
    
    def create_line_chart(self, data: List[Dict[str, Any]], 
                         options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a line chart using D3.js via Deno.
        
        Args:
            data: List of series: [{"name": str, "data": [{"x": float, "y": float}, ...]}]
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("line", chart_input)
    
    def create_scatter_chart(self, data: List[Dict[str, Any]], 
                            options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a scatter plot using D3.js via Deno.
        
        Args:
            data: List of series: [{"name": str, "data": [{"x": float, "y": float, "size"?: float}, ...]}]
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("scatter", chart_input)
    
    def create_histogram_chart(self, data: List[Dict[str, Union[float, int]]], 
                              options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a histogram chart using D3.js via Deno.
        
        Args:
            data: List of histogram bins: [{"binStart": float, "binEnd": float, "count": int}]
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("histogram", chart_input)

    def create_graph_chart(self, data: Dict[str, List[Dict[str, Any]]], 
                          options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a graph/network chart using D3.js via Deno.
        
        Args:
            data: Graph data: {"nodes": [Node...], "edges": [Edge...]}
            options: Chart options (title, layout, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("graph", chart_input)
    
    def display_svg(self, svg_string: str, width: int = 600, height: int = 400):
        """
        Display an SVG string using ipywidgets HTML (if available).
        
        Args:
            svg_string: SVG content as string
            width: Container width
            height: Container height
            
        Returns:
            ipywidgets.HTML widget if Jupyter is available, otherwise None
        """
        if not JUPYTER_AVAILABLE:
            print(f"Jupyter not available. SVG generated ({len(svg_string)} chars) but cannot display.")
            return None
        
        # Create HTML widget with SVG content
        html_content = f"""
        <div style="width: {width}px; height: {height}px; margin: 10px 0; 
                    border: 1px solid #ddd; border-radius: 8px; 
                    background: white; overflow: hidden;">
            {svg_string}
        </div>
        """
        
        if widgets is not None and display is not None:
            widget = widgets.HTML(value=html_content)
            display(widget)
            return widget
        return None




# Global instance for matplotlib-style API
_default_bridge = None

def _get_default_bridge() -> D3DenoBridge:
    """Get or create the default D3 bridge instance."""
    global _default_bridge
    if _default_bridge is None:
        _default_bridge = D3DenoBridge()
    return _default_bridge


# Matplotlib-style convenience functions
def bar(categories, values, title=None, xlabel=None, ylabel=None,
        width=320, height=240, show=False, **kwargs) -> 'Chart':
    """
    Create a bar chart with academic styling.
    
    Args:
        categories: Array-like category labels (strings)
        values: Array-like values for each category (numbers)
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 600) 
        height: Chart height in pixels (default: 400)
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.bar(["A", "B", "C"], [10, 20, 15])
        d3pm.bar(categories, values, title="Sample Data", ylabel="Count")
    """
    bridge = _get_default_bridge()
    
    # Validate inputs
    if len(categories) != len(values):
        raise ValueError("Categories and values arrays must have the same length")
    
    # Convert to numpy-safe format and handle numpy arrays
    def safe_convert_value(val):
        if hasattr(val, 'item') and callable(getattr(val, 'item')):
            return val.item()
        else:
            return float(val)
    
    def safe_convert_label(val):
        if hasattr(val, 'item') and callable(getattr(val, 'item')):
            return str(val.item())
        else:
            return str(val)
    
    # Create data in expected format
    clean_data = []
    for cat, val in zip(categories, values):
        clean_data.append({
            "label": safe_convert_label(cat),
            "value": safe_convert_value(val)
        })
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    
    svg = bridge.create_bar_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='bar',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def line(x, y=None, label=None, title=None, xlabel=None, ylabel=None, 
         width=320, height=240, show=False, **kwargs) -> 'Chart':
    """
    Create a line chart with academic styling.
    
    Args:
        x: Array-like x values, or if y=None, then y values (x will be auto-generated)
            Can also be a list of x arrays for multiple series
        y: Array-like y values (optional if x contains y values)
            Can also be a list of y arrays for multiple series
        label: Label for the line series (optional)
               Can be a list of labels for multiple series
        title: Chart title (optional)
        xlabel: X-axis label (optional) 
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 600)
        height: Chart height in pixels (default: 400)
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.line(x_vals, y_vals)
        d3pm.line(x_vals, y_vals, label="Series 1", title="My Chart")
        d3pm.line(y_vals)  # Auto-generate x values
        d3pm.line([x1, x2], [y1, y2], label=["Series 1", "Series 2"])  # Multiple series
    """
    bridge = _get_default_bridge()
    
    # Convert to numpy-safe format and handle numpy arrays
    def safe_convert(arr):
        converted = []
        for val in arr:
            if hasattr(val, 'item') and callable(getattr(val, 'item')):
                converted.append(val.item())
            else:
                converted.append(float(val))
        return converted
    
    # Check if we have multiple series (lists of lists)
    is_multi_series = False
    if y is not None and hasattr(x, '__len__') and hasattr(y, '__len__'):
        # Check if x and y contain arrays/lists
        try:
            if len(x) > 0 and hasattr(x[0], '__len__') and not isinstance(x[0], str):
                is_multi_series = True
        except (TypeError, IndexError):
            pass
    
    if is_multi_series:
        # Multiple series case
        x_arrays = x
        y_arrays = y
        
        # Handle labels
        if label is None:
            labels = [""] * len(x_arrays)
        elif isinstance(label, (list, tuple)):
            labels = list(label)
            # Pad with empty strings if not enough labels
            while len(labels) < len(x_arrays):
                labels.append("")
        else:
            labels = [str(label)] + [""] * (len(x_arrays) - 1)
        
        # Create series data
        clean_data = []
        for i, (x_vals, y_vals) in enumerate(zip(x_arrays, y_arrays)):
            x_clean = safe_convert(x_vals)
            y_clean = safe_convert(y_vals)
            
            clean_data.append({
                "name": labels[i],
                "data": [{"x": x, "y": y} for x, y in zip(x_clean, y_clean)]
            })
    else:
        # Single series case
        if y is None:
            # If only x provided, treat as y values and auto-generate x
            y_values = x
            x_values = list(range(len(y_values)))
        else:
            x_values = x
            y_values = y
        
        x_clean = safe_convert(x_values)
        y_clean = safe_convert(y_values)
        
        # Create series data in expected format
        series_name = label if label is not None else ""
        clean_data = [{
            "name": series_name,
            "data": [{"x": x, "y": y} for x, y in zip(x_clean, y_clean)]
        }]
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    
    svg = bridge.create_line_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='line',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def scatter(x, y, size=None, label=None, title=None, xlabel=None, ylabel=None,
           width=320, height=240, show=False, **kwargs) -> 'Chart':
    """
    Create a scatter plot with academic styling.
    
    Args:
        x: Array-like x values
        y: Array-like y values
        size: Array-like size values (optional, for variable point sizes)
        label: Label for the scatter series (optional)
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional) 
        width: Chart width in pixels (default: 600)
        height: Chart height in pixels (default: 400)
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.scatter(x_vals, y_vals)
        d3pm.scatter(x_vals, y_vals, size=sizes, label="Data Points")
        d3pm.scatter(x_vals, y_vals, title="X vs Y", xlabel="X axis", ylabel="Y axis")
    """
    bridge = _get_default_bridge()
    
    # Convert to numpy-safe format and handle numpy arrays
    def safe_convert(arr):
        converted = []
        for val in arr:
            if hasattr(val, 'item') and callable(getattr(val, 'item')):
                converted.append(val.item())
            else:
                converted.append(float(val))
        return converted
    
    x_clean = safe_convert(x)
    y_clean = safe_convert(y)
    
    # Handle optional size array
    if size is not None:
        size_clean = safe_convert(size)
        if len(size_clean) != len(x_clean):
            raise ValueError("Size array must have same length as x and y arrays")
    else:
        size_clean = None
    
    # Create data points
    data_points = []
    for i, (x_val, y_val) in enumerate(zip(x_clean, y_clean)):
        point = {"x": x_val, "y": y_val}
        if size_clean is not None:
            point["size"] = size_clean[i]
        data_points.append(point)
    
    # Create series data in expected format
    series_name = label if label is not None else ""
    clean_data = [{
        "name": series_name,
        "data": data_points
    }]
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    
    svg = bridge.create_scatter_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='scatter',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def hist(values, bins=20, title=None, xlabel=None, ylabel=None,
         width=320, height=240, show=False, **kwargs) -> 'Chart':
    """
    Create a histogram chart with continuous x-axis and no gaps between bars.
    
    Args:
        values: Array-like data values to bin
        bins: Number of bins (default: 20) or array of bin edges
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 600)
        height: Chart height in pixels (default: 400)
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.hist(data_values)
        d3pm.hist(data_values, bins=30, title="Distribution")
        d3pm.hist(data_values, bins=[0, 1, 2, 5, 10])  # Custom bin edges
    """
    bridge = _get_default_bridge()
    
    # Convert values to numpy-safe format
    def safe_convert(arr):
        converted = []
        for val in arr:
            if hasattr(val, 'item') and callable(getattr(val, 'item')):
                converted.append(val.item())
            else:
                converted.append(float(val))
        return converted
    
    clean_values = safe_convert(values)
    
    # Create histogram bins
    if isinstance(bins, int):
        # Auto-generate bin edges
        min_val, max_val = min(clean_values), max(clean_values)
        if min_val == max_val:
            # Handle edge case of all same values
            bin_edges = [min_val - 0.5, max_val + 0.5]
        else:
            bin_width = (max_val - min_val) / bins
            bin_edges = [min_val + i * bin_width for i in range(bins + 1)]
    else:
        # User-provided bin edges
        bin_edges = safe_convert(bins)
        bins = len(bin_edges) - 1
    
    # Count values in each bin
    hist_counts = [0] * bins
    for value in clean_values:
        # Find which bin this value belongs to
        for i in range(bins):
            if i == bins - 1:  # Last bin includes right edge
                if bin_edges[i] <= value <= bin_edges[i + 1]:
                    hist_counts[i] += 1
                    break
            else:
                if bin_edges[i] <= value < bin_edges[i + 1]:
                    hist_counts[i] += 1
                    break
    
    # Create data in expected format
    clean_data = []
    for i in range(bins):
        clean_data.append({
            "binStart": bin_edges[i],
            "binEnd": bin_edges[i + 1],
            "count": hist_counts[i]
        })
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    
    svg = bridge.create_histogram_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='hist',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def graph(nodes: List[Node], edges: List[Edge], layout='reverse', title=None, 
          width=None, height=None, show=False, **kwargs) -> 'Chart':
    """
    Create a graph/network visualization with nodes and edges.
    
    Args:
        nodes: List of Node objects defining graph vertices
        edges: List of Edge objects defining graph connections  
        layout: Layout algorithm - 'reverse' for structured flow, 'force' for interactive
        title: Chart title (optional)
        width: Chart width in pixels (None for auto-sizing)
        height: Chart height in pixels (None for auto-sizing) 
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        nodes = [Node("a", "2.0", "rect"), Node("op", "+", "circle"), Node("b", "5.0", "rect")]
        edges = [Edge("a", "op"), Edge("op", "b")]
        d3pm.graph(nodes, edges, layout='fixed', title="Computation Graph")
    """
    bridge = _get_default_bridge()
    
    # Validate inputs
    if not nodes:
        raise ValueError("Must provide at least one node")
    
    node_ids = {node.id for node in nodes}
    for edge in edges:
        if edge.source not in node_ids:
            raise ValueError(f"Edge source '{edge.source}' not found in nodes")
        if edge.target not in node_ids:
            raise ValueError(f"Edge target '{edge.target}' not found in nodes")
    
    # Convert Node and Edge objects to dictionaries
    nodes_data = [asdict(node) for node in nodes]
    edges_data = [asdict(edge) for edge in edges]
    
    # Create data in expected format
    clean_data = {
        "nodes": nodes_data,
        "edges": edges_data
    }
    
    # Build options using shared configuration
    config = ChartConfig(title=title, width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    options['layout'] = layout
    
    svg = bridge.create_graph_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='graph',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


class Chart:
    """
    Chart wrapper class that supports composition operations.
    Enables matplotlib-style chart composition with * + / operators.
    """
    
    def __init__(self, data=None, chart_type=None, options=None, svg=None, width=320, height=240):
        """
        Initialize a Chart object with plotting metadata for composition.
        
        Args:
            data: Original chart data for composition
            chart_type: Type of chart ('bar', 'line', 'scatter', 'hist')
            options: Chart options (title, labels, colors, etc.)
            svg: Pre-rendered SVG string (optional, will be generated if needed)
            width: Chart width in pixels
            height: Chart height in pixels
        """
        # Plotting metadata for composition
        self.data = data
        self.chart_type = chart_type
        self.options = options or {}
        self.width = width
        self.height = height
        
        # Lazy SVG generation
        self._svg = svg
        self._bridge = None
    
    @property
    def svg(self):
        """Get SVG string, generating it if needed."""
        if self._svg is None:
            self._generate_svg()
        return self._svg
    
    def _generate_svg(self):
        """Generate SVG from metadata."""
        if self.data is None or self.chart_type is None:
            raise ValueError("Cannot generate SVG: missing data or chart_type")
        
        bridge = _get_default_bridge()
        
        if self.chart_type == 'bar':
            self._svg = bridge.create_bar_chart(self.data, self.options)
        elif self.chart_type == 'line':
            self._svg = bridge.create_line_chart(self.data, self.options)
        elif self.chart_type == 'scatter':
            self._svg = bridge.create_scatter_chart(self.data, self.options)
        elif self.chart_type == 'hist':
            self._svg = bridge.create_histogram_chart(self.data, self.options)
        else:
            raise ValueError(f"Unknown chart type: {self.chart_type}")
    
    def show(self, display_width: int = None, display_height: int = None):
        """Display the chart in Jupyter notebook."""
        bridge = _get_default_bridge()
        w = display_width or self.width
        h = display_height or self.height
        bridge.display_svg(self.svg, w, h)
    
    def plot(self, display_width: int = None, display_height: int = None):
        """
        Display the chart (alias for show() - more intuitive for plotting).
        
        Args:
            display_width: Override display width
            display_height: Override display height
        """
        self.show(display_width, display_height)
    
    def _repr_html_(self):
        """Enable direct display in Jupyter notebooks via display()."""
        # Return the SVG directly for Jupyter display
        return self.svg
    
    def __repr__(self):
        """String representation of the Chart object."""
        return f"<Chart {self.width}x{self.height}>"
    
    def __mul__(self, other: 'Chart') -> 'Chart':
        """
        Stack charts (overlay) - * operator
        Charts are layered on top of each other with proper scale harmonization.
        
        Example:
            chart1 * chart2  # Overlay chart2 on chart1
        """
        return self._overlay_charts(other)
    
    def __add__(self, other: 'Chart') -> 'Chart':
        """
        Place charts side-by-side - + operator
        
        Example:
            chart1 + chart2  # Place chart2 to the right of chart1
        """
        return self._compose_charts(other, 'sideBySide')
    
    def __truediv__(self, other: 'Chart') -> 'Chart':
        """
        Place charts vertically - / operator
        
        Example:
            chart1 / chart2  # Place chart2 below chart1
        """
        return self._compose_charts(other, 'vertical')
    
    def _overlay_charts(self, other: 'Chart') -> 'Chart':
        """
        Overlay charts with proper scale harmonization using metadata.
        
        Args:
            other: Another Chart object to overlay
            
        Returns:
            New Chart object with combined data and harmonized scales
        """
        # Check if both charts have metadata for overlay
        if self.data is None or other.data is None:
            # Fallback to old SVG-based composition for backward compatibility
            return self._compose_charts(other, 'stack')
        
        # Check chart type compatibility
        if self.chart_type != other.chart_type:
            raise ValueError(f"Cannot overlay different chart types: {self.chart_type} and {other.chart_type}")
        
        # Combine data based on chart type
        if self.chart_type in ['line', 'scatter']:
            # For line/scatter charts, combine series
            combined_data = list(self.data) + list(other.data)
        elif self.chart_type == 'bar':
            # For bar charts, would need different logic (not common to overlay)
            raise ValueError("Bar chart overlay not supported - use side-by-side (+) instead")
        elif self.chart_type == 'hist':
            # For histograms, would need bin alignment (complex)
            raise ValueError("Histogram overlay not supported - consider combining source data")
        else:
            raise ValueError(f"Overlay not supported for chart type: {self.chart_type}")
        
        # Merge options, preferring the first chart's settings but combining titles
        merged_options = self.options.copy()
        if other.options.get('title') and self.options.get('title'):
            merged_options['title'] = f"{self.options['title']} & {other.options['title']}"
        elif other.options.get('title') and not self.options.get('title'):
            merged_options['title'] = other.options['title']
        
        # Use the larger dimensions
        width = max(self.width, other.width)
        height = max(self.height, other.height)
        merged_options['width'] = width
        merged_options['height'] = height
        
        # Create new Chart with combined data
        return Chart(
            data=combined_data,
            chart_type=self.chart_type,
            options=merged_options,
            width=width,
            height=height
        )
    
    def _compose_charts(self, other: 'Chart', operation: str) -> 'Chart':
        """
        Compose two charts using TypeScript ChartComposer.
        
        Args:
            other: Another Chart object
            operation: 'stack', 'sideBySide', or 'vertical'
        
        Returns:
            New Chart object with composed SVG
        """
        bridge = _get_default_bridge()
        
        # Create a temporary TypeScript file to handle composition
        compose_script = f'''
import {{ ChartComposer }} from "./ChartComposer.ts";

// Mock chart components that wrap SVG strings
class MockChart {{
    constructor(private svg: string, private w: number, private h: number) {{}}
    
    render(): string {{
        return this.svg;
    }}
    
    getDimensions(): {{ width: number; height: number }} {{
        return {{ width: this.w, height: this.h }};
    }}
}}

const chart1 = new MockChart(`{self.svg}`, {self.width}, {self.height});
const chart2 = new MockChart(`{other.svg}`, {other.width}, {other.height});

const result = ChartComposer.{operation}(chart1, chart2);
console.log(JSON.stringify({{
    svg: result.svg,
    width: result.width,
    height: result.height
}}));
'''
        
        # Write temporary script
        temp_script_path = os.path.join(bridge.viz_path, 'temp_compose.ts')
        with open(temp_script_path, 'w') as f:
            f.write(compose_script)
        
        try:
            # Execute composition
            cmd = [
                bridge.deno_path, "run", "--allow-read", "--allow-write",
                temp_script_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                raise RuntimeError(f"Chart composition failed: {result.stderr}")
            
            # Parse result
            composition_result = json.loads(result.stdout.strip())
            
            return Chart(
                svg=composition_result['svg'],
                width=composition_result['width'],
                height=composition_result['height']
            )
            
        finally:
            # Clean up temporary file
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)



