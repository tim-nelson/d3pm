"""
D3 Deno Bridge - Python interface to Deno D3.js chart generators
Handles subprocess communication and SVG generation
"""

import subprocess
import json
import os
import base64
import tempfile
from pathlib import Path
from typing import Dict, List, Any, Optional, Union, Literal
from dataclasses import dataclass, asdict

# Optional GraphViz import for layout positioning
try:
    import graphviz
    GRAPHVIZ_AVAILABLE = True
except ImportError:
    graphviz = None
    GRAPHVIZ_AVAILABLE = False

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
            "heatmap": "HeatmapChart.ts",
            "graph": "GraphChart.ts",
            "graphviz": "GraphChart.ts",  # Use new GraphChart for GraphViz data
            "composite": "composite.ts"  # Universal mixed chart overlay
        }
        
        if script_name not in script_mapping:
            raise ValueError(f"Unknown script name: {script_name}")
        
        script_path = os.path.join(self.viz_path, script_mapping[script_name])
        
        if not os.path.exists(script_path):
            raise FileNotFoundError(f"Deno script not found: {script_path}")
        
        # Serialize data to JSON and write to temporary file
        json_data = json.dumps(data, ensure_ascii=False)
        
        # Create temporary file for large data communication
        temp_file = None
        try:
            temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
            temp_file.write(json_data)
            temp_file.close()
            
            # Run Deno script with temp file path
            result = subprocess.run(
                [self.deno_path, "run", "--allow-all", script_path, temp_file.name],
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
        finally:
            # Clean up temporary file
            if temp_file and os.path.exists(temp_file.name):
                try:
                    os.unlink(temp_file.name)
                except OSError:
                    pass  # Ignore cleanup errors
    
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

    def create_heatmap_chart(self, data: List[Dict[str, Any]], 
                            options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a heatmap/matrix chart using D3.js via Deno.
        
        Args:
            data: List of heatmap cells: [{"x": int, "y": int, "value": float, "text": str?}]
            options: Chart options (title, colormap, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("heatmap", chart_input)

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
    
    def create_graphviz_chart(self, data: Dict[str, Any], 
                             options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a graph chart from GraphViz data using the new lightweight wrapper.
        
        Args:
            data: GraphViz data: {"nodes": [GraphVizNode...], "edges": [GraphVizEdge...], ...}
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("graphviz", chart_input)
    
    def create_composite_chart(self, data: List[Dict[str, Any]], 
                              options: Optional[Dict[str, Any]] = None) -> str:
        """
        Create a composite chart that can render multiple chart types with harmonized scales.
        
        Args:
            data: Unified chart data with renderType annotations
            options: Chart options (title, colors, size, etc.)
            
        Returns:
            SVG string
        """
        chart_input = {"data": data, "options": options or {}}
        return self._call_deno_script("composite", chart_input)
    
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
    
    def convert_svg_to_png(self, svg_string: str, scale: float = 1.0, 
                          dpi: Optional[float] = None) -> bytes:
        """
        Convert SVG string to PNG bytes using Deno canvas API.
        
        Args:
            svg_string: SVG content as string
            scale: Scale factor for output size (default: 1.0)
            dpi: DPI for output (overrides scale if provided)
            
        Returns:
            PNG image as bytes
            
        Raises:
            RuntimeError: If conversion fails
        """
        # Validate scale and DPI parameters
        if dpi is not None and scale != 1.0:
            raise ValueError("Cannot specify both dpi and scale parameters")
        
        # Prepare conversion options
        options = {}
        if dpi is not None:
            options['dpi'] = dpi
        else:
            options['scale'] = scale
        
        # Path to SvgToPng script
        svg_to_png_script = os.path.join(self.viz_path, 'SvgToPng.ts')
        
        if not os.path.exists(svg_to_png_script):
            raise FileNotFoundError(f"SvgToPng script not found: {svg_to_png_script}")
        
        try:
            # Run Deno script with SVG and options
            result = subprocess.run(
                [self.deno_path, "run", "--allow-all", svg_to_png_script, 
                 svg_string, json.dumps(options)],
                capture_output=True,
                text=True,
                timeout=60,  # 60 second timeout for first-time npm package download
                cwd=self.viz_path
            )
            
            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown error occurred"
                raise RuntimeError(f"PNG conversion failed: {error_msg}")
            
            # Parse result
            try:
                conversion_result = json.loads(result.stdout.strip())
            except json.JSONDecodeError as e:
                raise RuntimeError(f"Invalid response from PNG converter: {e}")
            
            if not conversion_result.get('success'):
                error_msg = conversion_result.get('error', 'Unknown conversion error')
                raise RuntimeError(f"PNG conversion failed: {error_msg}")
            
            # Decode base64 PNG data
            png_base64 = conversion_result.get('data')
            if not png_base64:
                raise RuntimeError("No PNG data returned from converter")
            
            png_bytes = base64.b64decode(png_base64)
            return png_bytes
            
        except subprocess.TimeoutExpired:
            raise RuntimeError("PNG conversion timed out after 30 seconds")
        except Exception as e:
            raise RuntimeError(f"Failed to convert SVG to PNG: {str(e)}")




# Global instance for matplotlib-style API
_default_bridge = None

def _get_default_bridge() -> D3DenoBridge:
    """Get or create the default D3 bridge instance."""
    global _default_bridge
    if _default_bridge is None:
        _default_bridge = D3DenoBridge()
    return _default_bridge


# Matplotlib-style convenience functions
def bar(categories, values, colors=None, title=None, xlabel=None, ylabel=None,
        width=320, height=240, show=False, yticks=5, legend_position='right', 
        legend_offset=(0, 0), legend_style='standard', tick_numbers='nice', 
        origin_labels=False, axis_at_origin=False, **kwargs) -> 'Chart':
    """
    Create a bar chart with academic styling.
    
    Args:
        categories: Array-like category labels (strings)
        values: Array-like values for each category (numbers)
        colors: List of colors for bars (hex codes, named colors, or mix)
                Examples: ['red', 'blue'], ['#FF5733', '#33FF57'], ['red', '#FF5733', 'blue']
                Available named colors: 'red', 'blue', 'green', 'orange', 'purple', 'yellow'
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 320) 
        height: Chart height in pixels (default: 240)
        show: Whether to display the chart immediately
        yticks: Number of Y-axis ticks (default: 5, 0 = no ticks)
        legend_position: Legend position - 'top-left', 'top-right', 'bottom-left', 'bottom-right', 
                        'left', 'right', 'top', 'bottom' (default: 'right')
        legend_offset: Tuple (x, y) for fine-tuning legend position (default: (0, 0))
        legend_style: Legend style - 'standard' (positioned) or 'tags' (horizontal above chart) (default: 'standard')
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.bar(["A", "B", "C"], [10, 20, 15])
        d3pm.bar(categories, values, colors=['red', 'blue', 'green'])
        d3pm.bar(categories, values, colors=['#FF5733', '#33FF57'], title="Sample Data")
        d3pm.bar(categories, values, yticks=0)  # No Y-axis ticks
        d3pm.bar(categories, values, legend_position="top-left")
        d3pm.bar(categories, values, legend_style="tags")  # GitHub-style tags
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
    options = _build_chart_options(config, yticks=yticks, 
                                   tickNumbers=tick_numbers, originLabels=origin_labels, 
                                   axisAtOrigin=axis_at_origin, **kwargs)
    
    # Add colors if provided
    if colors is not None:
        options['colors'] = colors
    
    # Add legend options
    options['legendPosition'] = legend_position
    options['legendOffset'] = list(legend_offset)
    options['legendStyle'] = legend_style
    
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


def line(x, y=None, colors=None, label=None, title=None, xlabel=None, ylabel=None, 
         width=320, height=240, show=False, xticks=5, yticks=5, legend_position='right', 
         legend_offset=(0, 0), legend_style='standard', tick_numbers='nice', 
         origin_labels=False, axis_at_origin=False, **kwargs) -> 'Chart':
    """
    Create a line chart with academic styling.
    
    Args:
        x: Array-like x values, or if y=None, then y values (x will be auto-generated)
            Can also be a list of x arrays for multiple series
        y: Array-like y values (optional if x contains y values)
            Can also be a list of y arrays for multiple series
        colors: List of colors for line series (hex codes, named colors, or mix)
                Examples: ['red', 'blue'], ['#FF5733', '#33FF57'], ['red', '#FF5733']
                Available named colors: 'red', 'blue', 'green', 'orange', 'purple', 'yellow'
        label: Label for the line series (optional)
               Can be a list of labels for multiple series
        title: Chart title (optional)
        xlabel: X-axis label (optional) 
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 320)
        height: Chart height in pixels (default: 240)
        show: Whether to display the chart immediately
        xticks: Number of X-axis ticks (default: 5, 0 = no ticks)
        yticks: Number of Y-axis ticks (default: 5, 0 = no ticks)
        legend_position: Legend position - 'top-left', 'top-right', 'bottom-left', 'bottom-right', 
                        'left', 'right', 'top', 'bottom' (default: 'right')
        legend_offset: Tuple (x, y) for fine-tuning legend position (default: (0, 0))
        legend_style: Legend style - 'standard' (positioned) or 'tags' (horizontal above chart) (default: 'standard')
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.line(x_vals, y_vals)
        d3pm.line(x_vals, y_vals, colors=['red'], label="Series 1", title="My Chart")
        d3pm.line(y_vals)  # Auto-generate x values
        d3pm.line([x1, x2], [y1, y2], colors=['red', 'blue'], label=["Series 1", "Series 2"])
        d3pm.line(x_vals, y_vals, xticks=0, yticks=0)  # No ticks on either axis
        d3pm.line(x_vals, y_vals, legend_position="top-left", legend_offset=(10, 5))
        d3pm.line([x1, x2], [y1, y2], label=["A", "B"], legend_style="tags")  # Tag-style legend
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
        series_name = label if label is not None and str(label).strip() != "" else ""
        clean_data = [{
            "name": series_name,
            "data": [{"x": x, "y": y} for x, y in zip(x_clean, y_clean)]
        }]
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, xticks=xticks, yticks=yticks, 
                                   tickNumbers=tick_numbers, originLabels=origin_labels, 
                                   axisAtOrigin=axis_at_origin, **kwargs)
    
    # Add colors if provided
    if colors is not None:
        options['colors'] = colors
    
    # Add legend options
    options['legendPosition'] = legend_position
    options['legendOffset'] = list(legend_offset)
    options['legendStyle'] = legend_style
    
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


def scatter(x, y, size=None, colors=None, labels=None, label=None, title=None, xlabel=None, ylabel=None,
           width=320, height=240, show=False, xticks=5, yticks=5, legend_position='right', 
           legend_offset=(0, 0), legend_style='standard', tick_numbers='nice', 
           origin_labels=False, axis_at_origin=False, label_color=None, label_position='above', **kwargs) -> 'Chart':
    """
    Create a scatter plot with academic styling.
    
    Args:
        x: Array-like x values
        y: Array-like y values
        size: Array-like size values (optional, for variable point sizes)
        colors: List of colors for scatter points (hex codes, named colors, or mix)
                Examples: ['red', 'blue'], ['#FF5733', '#33FF57'], ['red', '#FF5733']
                Available named colors: 'red', 'blue', 'green', 'orange', 'purple', 'yellow'
        labels: Array-like text labels for each point (optional)
        label: Label for the scatter series (optional)
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional) 
        width: Chart width in pixels (default: 320)
        height: Chart height in pixels (default: 240)
        show: Whether to display the chart immediately
        xticks: Number of X-axis ticks (default: 5, 0 = no ticks)
        yticks: Number of Y-axis ticks (default: 5, 0 = no ticks)
        legend_position: Legend position - 'top-left', 'top-right', 'bottom-left', 'bottom-right', 
                        'left', 'right', 'top', 'bottom' (default: 'right')
        legend_offset: Tuple (x, y) for fine-tuning legend position (default: (0, 0))
        legend_style: Legend style - 'standard' (positioned) or 'tags' (horizontal above chart) (default: 'standard')
        label_color: Color for point labels (default: theme text color)
        label_position: Position of labels relative to points - 'center', 'above', 'below', 'left', 'right' (default: 'above')
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.scatter(x_vals, y_vals)
        d3pm.scatter(x_vals, y_vals, colors=['blue'], size=sizes, label="Data Points")
        d3pm.scatter(x_vals, y_vals, colors=['#FF5733'], title="X vs Y", xlabel="X axis")
        d3pm.scatter(x_vals, y_vals, labels=['A', 'B', 'C'])  # Label each point
        d3pm.scatter(x_vals, y_vals, labels=itos, label_position='center', label_color='white')  # Matplotlib-style
        d3pm.scatter(x_vals, y_vals, xticks=0, yticks=0)  # No ticks
        d3pm.scatter(x_vals, y_vals, legend_position="bottom-right", legend_offset=(5, 5))
        d3pm.scatter(x_vals, y_vals, label="Points", legend_style="tags")  # Tag-style legend
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
    
    # Handle optional labels array
    if labels is not None:
        if len(labels) != len(x_clean):
            raise ValueError("Labels array must have same length as x and y arrays")
        labels_clean = [str(label) for label in labels]
    else:
        labels_clean = None
    
    # Create data points
    data_points = []
    for i, (x_val, y_val) in enumerate(zip(x_clean, y_clean)):
        point = {"x": x_val, "y": y_val}
        if size_clean is not None:
            point["size"] = size_clean[i]
        if labels_clean is not None:
            point["label"] = labels_clean[i]
        data_points.append(point)
    
    # Create series data in expected format
    series_name = label if label is not None and str(label).strip() != "" else ""
    clean_data = [{
        "name": series_name,
        "data": data_points
    }]
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, xticks=xticks, yticks=yticks, 
                                   tickNumbers=tick_numbers, originLabels=origin_labels, 
                                   axisAtOrigin=axis_at_origin, **kwargs)
    
    # Add colors if provided
    if colors is not None:
        options['colors'] = colors
    
    # Add legend options
    options['legendPosition'] = legend_position
    options['legendOffset'] = list(legend_offset)
    options['legendStyle'] = legend_style
    
    # Add label options
    if label_color is not None:
        options['labelColor'] = label_color
    if label_position is not None:
        options['labelPosition'] = label_position
    
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


def hist(values, bins=20, colors=None, title=None, xlabel=None, ylabel=None,
         width=320, height=240, show=False, xticks=5, yticks=5, legend_position='right', 
         legend_offset=(0, 0), legend_style='standard', tick_numbers='nice', 
         origin_labels=False, axis_at_origin=False, **kwargs) -> 'Chart':
    """
    Create a histogram chart with continuous x-axis and no gaps between bars.
    
    Args:
        values: Array-like data values to bin
        bins: Number of bins (default: 20) or array of bin edges
        colors: List of colors for histogram bars (hex codes, named colors, or mix)
                Examples: ['red'], ['#FF5733'], ['blue', 'green'] for multiple colors
                Available named colors: 'red', 'blue', 'green', 'orange', 'purple', 'yellow'
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 320)
        height: Chart height in pixels (default: 240)
        show: Whether to display the chart immediately
        xticks: Number of X-axis ticks (default: 5, 0 = no ticks)
        yticks: Number of Y-axis ticks (default: 5, 0 = no ticks)
        legend_position: Legend position - 'top-left', 'top-right', 'bottom-left', 'bottom-right', 
                        'left', 'right', 'top', 'bottom' (default: 'right')
        legend_offset: Tuple (x, y) for fine-tuning legend position (default: (0, 0))
        legend_style: Legend style - 'standard' (positioned) or 'tags' (horizontal above chart) (default: 'standard')
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.hist(data_values)
        d3pm.hist(data_values, colors=['green'], bins=30, title="Distribution")
        d3pm.hist(data_values, colors=['#FF5733'], xticks=0, yticks=0)  # No ticks, custom color
        d3pm.hist(data_values, bins=[0, 1, 2, 5, 10])  # Custom bin edges
        d3pm.hist(data_values, legend_position="bottom-left", legend_offset=(0, -10))
        d3pm.hist(data_values, legend_style="tags")  # Tag-style legend
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
    options = _build_chart_options(config, xticks=xticks, yticks=yticks, 
                                   tickNumbers=tick_numbers, originLabels=origin_labels, 
                                   axisAtOrigin=axis_at_origin, **kwargs)
    
    # Add colors if provided
    if colors is not None:
        options['colors'] = colors
    
    # Add legend options
    options['legendPosition'] = legend_position
    options['legendOffset'] = list(legend_offset)
    options['legendStyle'] = legend_style
    
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


def imshow(matrix, cmap='viridis', annotations=None, title=None, xlabel=None, ylabel=None,
           width=320, height=240, show=False, interpolation='nearest', aspect='auto', 
           xticks=5, yticks=5, tick_numbers='nice', origin_labels=False, axis_at_origin=False, **kwargs) -> 'Chart':
    """
    Create a heatmap/matrix visualization from 2D array data.
    
    Args:
        matrix: 2D array-like data (list of lists, numpy array, etc.)
        cmap: Colormap options:
            - D3 interpolators: 'viridis', 'Blues', 'grays', 'RdBu', 'coolwarm', 'plasma', 'inferno'
            - d3pm colors: 'red', 'blue', 'green', 'yellow' (creates white-to-color gradients)
            - d3pm palette: 'd3pm' (uses all 4 d3pm colors)
            - Custom arrays: ['white', 'red'], ['blue', 'white', 'red'], etc.
        annotations: Optional 2D array of text annotations for each cell
        title: Chart title (optional)
        xlabel: X-axis label (optional)
        ylabel: Y-axis label (optional)
        width: Chart width in pixels (default: 320)
        height: Chart height in pixels (default: 240)
        show: Whether to display the chart immediately
        interpolation: Interpolation method - 'nearest', 'bilinear' (default: 'nearest')
        aspect: Cell aspect ratio - 'auto' (fill space) or 'equal' (square cells) (default: 'auto')
        xticks: Number of X-axis ticks (default: 5, 0 = no ticks)
        yticks: Number of Y-axis ticks (default: 5, 0 = no ticks)
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        d3pm.imshow(matrix_2d, cmap='Blues', title='Heatmap')
        d3pm.imshow(matrix_2d, cmap='red', aspect='equal', title='Square Cells')
        d3pm.imshow(binary_matrix, cmap='gray', interpolation='nearest')
        d3pm.imshow(matrix_2d, cmap=['white', 'red'], title='Custom Gradient')
        d3pm.imshow(matrix_2d, cmap='d3pm', title='d3pm Colors')
        d3pm.imshow(matrix_2d, cmap='viridis', xticks=3, yticks=4, title='Custom Ticks')
        d3pm.imshow(matrix_2d, cmap='Blues', xticks=0, yticks=0, title='No Axis Ticks')
    """
    bridge = _get_default_bridge()
    
    # Convert matrix to numpy-safe format and handle numpy arrays
    def safe_convert_matrix(matrix):
        """Convert 2D matrix to list of lists, handling numpy arrays and boolean values."""
        result = []
        for row in matrix:
            converted_row = []
            for val in row:
                if hasattr(val, 'item') and callable(getattr(val, 'item')):
                    # NumPy scalar - extract the value and check if boolean
                    extracted_val = val.item()
                    if isinstance(extracted_val, bool):
                        converted_val = int(extracted_val)
                    else:
                        converted_val = float(extracted_val)
                elif isinstance(val, bool):
                    # Python boolean - convert to int (True->1, False->0)
                    converted_val = int(val)
                else:
                    # Regular value - convert to float
                    converted_val = float(val)
                converted_row.append(converted_val)
            result.append(converted_row)
        return result
    
    def safe_convert_annotations(annotations):
        """Convert 2D annotations matrix to list of lists."""
        if annotations is None:
            return None
        result = []
        for row in annotations:
            converted_row = []
            for val in row:
                if hasattr(val, 'item') and callable(getattr(val, 'item')):
                    converted_row.append(str(val.item()))
                else:
                    converted_row.append(str(val))
            result.append(converted_row)
        return result
    
    # Convert 2D matrix to list of lists
    clean_matrix = safe_convert_matrix(matrix)
    clean_annotations = safe_convert_annotations(annotations)
    
    # Validate matrix dimensions
    if not clean_matrix or not clean_matrix[0]:
        raise ValueError("Matrix must be a non-empty 2D array")
    
    rows = len(clean_matrix)
    cols = len(clean_matrix[0])
    
    # Debug output for troubleshooting
    if 'DEBUG_HEATMAP' in os.environ:
        print(f"DEBUG: Matrix dimensions: {rows}x{cols}")
        print(f"DEBUG: First few matrix values: {clean_matrix[0][:min(5, cols)]}")
        print(f"DEBUG: Matrix value types: {[type(clean_matrix[0][i]) for i in range(min(3, cols))]}")
    
    # Validate that all rows have the same length
    for i, row in enumerate(clean_matrix):
        if len(row) != cols:
            raise ValueError(f"Matrix must be rectangular: row {i} has {len(row)} columns, expected {cols}")
    
    # Validate annotations matrix if provided
    if clean_annotations is not None:
        if len(clean_annotations) != rows:
            raise ValueError(f"Annotations matrix must have same dimensions as data matrix: got {len(clean_annotations)} rows, expected {rows}")
        for i, row in enumerate(clean_annotations):
            if len(row) != cols:
                raise ValueError(f"Annotations matrix must have same dimensions as data matrix: row {i} has {len(row)} columns, expected {cols}")
    
    # Convert matrix to flat data format expected by HeatmapChart
    clean_data = []
    for y in range(rows):
        for x in range(cols):
            cell_data = {
                "x": x,
                "y": y,
                "value": clean_matrix[y][x]
            }
            # Add annotation text if provided
            if clean_annotations is not None:
                cell_data["text"] = clean_annotations[y][x]
            clean_data.append(cell_data)
    
    # Build options using shared configuration
    config = ChartConfig(title=title, xlabel=xlabel, ylabel=ylabel, 
                        width=width, height=height, show=show)
    options = _build_chart_options(config, xticks=xticks, yticks=yticks, 
                                   tickNumbers=tick_numbers, originLabels=origin_labels, 
                                   axisAtOrigin=axis_at_origin, **kwargs)
    
    # Add heatmap-specific options
    options['colormap'] = cmap
    options['interpolation'] = interpolation
    options['aspect'] = aspect
    options['rows'] = rows
    options['cols'] = cols
    
    # Debug output for troubleshooting
    if 'DEBUG_HEATMAP' in os.environ:
        print(f"DEBUG: Total data points: {len(clean_data)}")
        print(f"DEBUG: First few data points: {clean_data[:min(5, len(clean_data))]}")
        print(f"DEBUG: Chart options: {options}")
    
    svg = bridge.create_heatmap_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='heatmap',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def _calculate_graphviz_positions(nodes: List[Node], edges: List[Edge], engine: str = 'dot', 
                                  graph_attr: Optional[Dict[str, str]] = None,
                                  node_attr: Optional[Dict[str, str]] = None,
                                  edge_attr: Optional[Dict[str, str]] = None) -> List[Node]:
    """
    Use GraphViz to calculate node positions, return nodes with x,y coordinates.
    
    Args:
        nodes: List of Node objects
        edges: List of Edge objects  
        engine: GraphViz layout engine ('dot', 'neato', 'circo', 'fdp', 'sfdp', 'twopi')
        graph_attr: Graph attributes (e.g., {'rankdir': 'LR'})
        node_attr: Default node attributes
        edge_attr: Default edge attributes
        
    Returns:
        List of Node objects with updated x,y coordinates
    """
    if not GRAPHVIZ_AVAILABLE:
        raise ImportError("GraphViz library not available. Install with: pip install graphviz")
    
    # Create GraphViz Digraph
    dot = graphviz.Digraph(engine=engine)
    
    # Apply graph attributes
    if graph_attr:
        dot.attr('graph', **graph_attr)
    
    # Apply default node attributes
    if node_attr:
        dot.attr('node', **node_attr)
    
    # Apply default edge attributes
    if edge_attr:
        dot.attr('edge', **edge_attr)
    
    # Add nodes to GraphViz graph
    for node in nodes:
        # Convert d3pm shape to GraphViz shape
        gv_shape = 'box' if node.shape == 'rect' else 'circle'
        dot.node(node.id, label=node.text, shape=gv_shape)
    
    # Add edges to GraphViz graph
    for edge in edges:
        label = edge.label if edge.label else ''
        dot.edge(edge.source, edge.target, label=label)
    
    # Render with position information
    # Use 'json' format to get precise coordinates
    try:
        json_output = dot.pipe(format='json', encoding='utf-8')
        layout_data = json.loads(json_output)
        
        # Extract node positions from GraphViz output
        positioned_nodes = []
        node_map = {node.id: node for node in nodes}
        
        # Parse GraphViz coordinate data
        for gv_node in layout_data.get('objects', []):
            node_id = gv_node.get('name')
            if node_id in node_map:
                original_node = node_map[node_id]
                
                # Extract position (GraphViz format: "x,y")
                pos_str = gv_node.get('pos', '0,0')
                x_str, y_str = pos_str.split(',')
                x = float(x_str)
                y = float(y_str)
                
                # GraphViz uses bottom-left origin, we need top-left
                # Get bounding box to flip Y coordinate
                bbox = layout_data.get('bb', '0,0,100,100')
                _, y_min, _, y_max = map(float, bbox.split(','))
                flipped_y = (y_max - y_min) - (y - y_min)
                
                # Create new Node with position
                positioned_node = Node(
                    id=original_node.id,
                    text=original_node.text,
                    shape=original_node.shape,
                    x=x,
                    y=flipped_y,
                    color=original_node.color,
                    tooltip=original_node.tooltip
                )
                positioned_nodes.append(positioned_node)
        
        return positioned_nodes
        
    except Exception as e:
        raise RuntimeError(f"GraphViz positioning failed: {e}")


def graph(nodes_or_digraph, edges=None, layout='reverse', title=None, 
          width=None, height=None, show=False, graph_attr=None, node_attr=None, 
          edge_attr=None, **kwargs) -> 'Chart':
    """
    Create a graph/network visualization from nodes and edges OR from a GraphViz Digraph.
    
    Args:
        nodes_or_digraph: Either a List of Node objects OR a GraphViz Digraph object
        edges: List of Edge objects (required when using Node objects, ignored for GraphViz)
        layout: Layout algorithm - 'reverse', 'force' for d3pm layouts, or GraphViz engines: 'dot', 'neato', 'circo', 'fdp', 'sfdp', 'twopi'
        title: Chart title (optional)
        width: Chart width in pixels (None for auto-sizing)
        height: Chart height in pixels (None for auto-sizing) 
        show: Whether to display the chart immediately
        graph_attr: Dict of GraphViz graph attributes (e.g., {'rankdir': 'LR'})
        node_attr: Dict of default GraphViz node attributes
        edge_attr: Dict of default GraphViz edge attributes
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        # Using Node/Edge objects:
        nodes = [Node("a", "2.0", "rect"), Node("op", "+", "circle"), Node("b", "5.0", "rect")]
        edges = [Edge("a", "op"), Edge("op", "b")]
        d3pm.graph(nodes, edges, layout='fixed', title="Computation Graph")
        
        # Using GraphViz Digraph:
        dot = graphviz.Digraph()
        dot.node('a', '2.0', shape='box')
        dot.node('op', '+', shape='circle')
        dot.edge('a', 'op')
        d3pm.graph(dot, title="GraphViz Example")
    """
    # Dispatch based on input type
    if hasattr(nodes_or_digraph, 'pipe'):
        # GraphViz Digraph object - delegate to graph_from_graphviz
        return graph_from_graphviz(nodes_or_digraph, title=title, width=width, height=height, show=show, **kwargs)
    
    # Node/Edge objects - continue with original implementation
    nodes = nodes_or_digraph
    if edges is None:
        raise ValueError("When using Node objects, edges parameter is required")
    
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
    
    # Check if GraphViz layout is requested
    graphviz_layouts = ['dot', 'neato', 'circo', 'fdp', 'sfdp', 'twopi']
    if layout in graphviz_layouts:
        # Use GraphViz for positioning
        positioned_nodes = _calculate_graphviz_positions(
            nodes, edges, engine=layout,
            graph_attr=graph_attr,
            node_attr=node_attr,
            edge_attr=edge_attr
        )
        nodes_to_use = positioned_nodes
    else:
        # Use original nodes for d3pm layouts
        nodes_to_use = nodes
    
    # Convert Node and Edge objects to dictionaries
    nodes_data = [asdict(node) for node in nodes_to_use]
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


def graph_from_graphviz(digraph, title=None, width=None, height=None, show=False, **kwargs) -> 'Chart':
    """
    Create a graph visualization directly from a GraphViz Digraph object.
    This is a lightweight wrapper that uses GraphViz for positioning and d3pm for visual styling.
    
    Args:
        digraph: A graphviz.Digraph object
        title: Chart title (optional)
        width: Chart width in pixels (None for auto-sizing)
        height: Chart height in pixels (None for auto-sizing) 
        show: Whether to display the chart immediately
        **kwargs: Additional chart options
        
    Returns:
        Chart object with composition operators (+, *, /)
        
    Examples:
        dot = graphviz.Digraph()
        dot.attr(rankdir='LR')
        dot.node('a', '2.0', shape='box')
        dot.node('op', '+', shape='circle')
        dot.edge('a', 'op')
        chart = d3pm.graph(dot, title="GraphViz Example")
    """
    if not GRAPHVIZ_AVAILABLE:
        raise ImportError("GraphViz is required for graph_from_graphviz. Install with: pip install graphviz")
    
    if not hasattr(digraph, 'pipe'):
        raise TypeError("Expected a graphviz.Digraph object")
    
    # Extract GraphViz data as JSON
    try:
        json_output = digraph.pipe(format='json', encoding='utf-8')
        graphviz_data = json.loads(json_output)
    except Exception as e:
        raise RuntimeError(f"Failed to extract GraphViz JSON data: {e}")
    
    # Convert GraphViz JSON to our expected format
    clean_data = _convert_graphviz_json_to_d3pm_format(graphviz_data)
    
    bridge = _get_default_bridge()
    
    # Build options using shared configuration
    config = ChartConfig(title=title, width=width, height=height, show=show)
    options = _build_chart_options(config, **kwargs)
    # Don't override layout - use whatever GraphViz determined
    
    # Use the new GraphChart for GraphViz rendering
    svg = bridge.create_graphviz_chart(clean_data, options)
    
    # Create Chart object with metadata for composition
    chart = Chart(
        data=clean_data,
        chart_type='graphviz',
        options=options,
        svg=svg,
        width=width,
        height=height
    )
    
    if show:
        chart.show()
    
    return chart


def _convert_graphviz_json_to_d3pm_format(graphviz_data: dict) -> dict:
    """Convert GraphViz JSON output to d3pm GraphChart format."""
    
    
    # Extract nodes from GraphViz objects
    nodes = []
    edges = []
    
    # Extract nodes from GraphViz objects array
    for obj in graphviz_data.get('objects', []):
        if obj.get('_gvid') is not None:  # This is a node
            node_data = {
                'id': obj.get('name', str(obj.get('_gvid'))),
                'label': obj.get('label', obj.get('name', '')),
                'shape': obj.get('shape', 'ellipse'),
                'pos': f"{obj.get('pos', '0,0')}",  # x,y coordinates
                'width': str(obj.get('width', '1.0')),
                'height': str(obj.get('height', '1.0')),
            }
            
            # Add color if specified
            if 'color' in obj:
                node_data['color'] = obj['color']
            if 'style' in obj:
                node_data['style'] = obj['style']
            
            nodes.append(node_data)
    
    # Create mapping from GraphViz internal IDs to node names for edges
    gvid_to_name = {}
    for obj in graphviz_data.get('objects', []):
        if obj.get('_gvid') is not None:
            gvid_to_name[obj.get('_gvid')] = obj.get('name', str(obj.get('_gvid')))
    
    # Extract edges from GraphViz top-level edges array
    for edge_obj in graphviz_data.get('edges', []):
        # Convert GraphViz internal IDs to actual node names
        tail_id = edge_obj.get('tail', edge_obj.get('_tail', ''))
        head_id = edge_obj.get('head', edge_obj.get('_head', ''))
        
        edge_data = {
            'source': gvid_to_name.get(tail_id, str(tail_id)),
            'target': gvid_to_name.get(head_id, str(head_id)),
            'pos': edge_obj.get('pos', ''),  # Spline path
        }
        
        # Add label if specified
        if 'label' in edge_obj:
            edge_data['label'] = edge_obj['label']
            
        edges.append(edge_data)
    
    # Extract graph-level attributes
    graph_attrs = {}
    if 'bb' in graphviz_data:
        graph_attrs['bb'] = graphviz_data['bb']
    if 'rankdir' in graphviz_data:
        graph_attrs['rankdir'] = graphviz_data['rankdir']
    if 'layout' in graphviz_data:
        graph_attrs['layout'] = graphviz_data['layout']
    
    
    return {
        'nodes': nodes,
        'edges': edges,
        **graph_attrs
    }


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
        elif self.chart_type == 'heatmap':
            self._svg = bridge.create_heatmap_chart(self.data, self.options)
        elif self.chart_type == 'graph':
            self._svg = bridge.create_graph_chart(self.data, self.options)
        elif self.chart_type == 'graphviz':
            self._svg = bridge.create_graphviz_chart(self.data, self.options)
        elif self.chart_type == 'composite':
            self._svg = bridge.create_composite_chart(self.data, self.options)
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
        
        # Universal chart overlay - convert all chart types to unified format
        if self.chart_type == other.chart_type:
            # Same chart types - use optimized path
            if self.chart_type in ['line', 'scatter']:
                # For line/scatter charts, combine series directly
                combined_data = list(self.data) + list(other.data)
                combined_chart_type = self.chart_type
            else:
                # For other same-type combinations, use composite chart
                unified_data = self._convert_to_unified_format() + other._convert_to_unified_format()
                combined_data = unified_data
                combined_chart_type = 'composite'
        else:
            # Different chart types - use universal composite chart
            unified_data = self._convert_to_unified_format() + other._convert_to_unified_format()
            combined_data = unified_data
            combined_chart_type = 'composite'
        
        # Merge options, preferring the first chart's settings but combining titles and colors
        merged_options = self.options.copy()
        if other.options.get('title') and self.options.get('title'):
            merged_options['title'] = f"{self.options['title']} & {other.options['title']}"
        elif other.options.get('title') and not self.options.get('title'):
            merged_options['title'] = other.options['title']
        
        # Merge colors from both charts
        colors1 = self.options.get('colors', [])
        colors2 = other.options.get('colors', [])
        
        # Build combined color array for all series
        # Count series from each chart
        series1_count = len(self.data) if self.data else 1
        series2_count = len(other.data) if other.data else 1
        
        merged_colors = []
        
        # Add colors for first chart's series
        if colors1:
            merged_colors.extend(colors1)
        else:
            # Use default colors for first chart's series
            default_colors = ['#658DCD', '#B1A04C', '#75A592', '#CF7280', '#A97ACC', '#C98C6C', '#E58BB7', '#7C7FB0']  # Base defaults
            # default_colors = ['#CF7280', '#DBB55C', '#658DCD', '#96ceb4']  # Base defaults
            merged_colors.extend(default_colors[:series1_count])
        
        # Add colors for second chart's series  
        if colors2:
            merged_colors.extend(colors2)
        else:
            # Use remaining default colors for second chart's series
            default_colors = ['#658DCD', '#B1A04C', '#75A592', '#CF7280', '#A97ACC', '#C98C6C', '#E58BB7', '#7C7FB0']
            # default_colors = ['#CF7280', '#DBB55C', '#658DCD', '#96ceb4']
            start_idx = len(merged_colors)
            merged_colors.extend(default_colors[start_idx:start_idx + series2_count])
        
        merged_options['colors'] = merged_colors
        
        # Use the larger dimensions
        width = max(self.width, other.width)
        height = max(self.height, other.height)
        merged_options['width'] = width
        merged_options['height'] = height
        
        # Create new Chart with combined data
        return Chart(
            data=combined_data,
            chart_type=combined_chart_type,
            options=merged_options,
            width=width,
            height=height
        )
    
    def _convert_to_unified_format(self):
        """
        Convert chart data to unified format for composite charts.
        
        Returns:
            List of unified series data compatible with CompositeChart
        """
        unified_data = []
        
        if self.chart_type == 'bar':
            # Convert bar chart data: [{label, value}] -> [{name, renderType, data}]
            series_data = {
                'name': self.options.get('title', 'Bar Data'),
                'renderType': 'bar',
                'data': []
            }
            
            for i, item in enumerate(self.data):
                series_data['data'].append({
                    'x': i,  # Use index as x position
                    'y': item['value'],
                    'label': item['label']
                })
            
            unified_data.append(series_data)
            
        elif self.chart_type in ['line', 'scatter']:
            # Convert line/scatter: already close to unified format
            for series in self.data:
                unified_series = {
                    'name': series['name'],
                    'renderType': self.chart_type,
                    'data': []
                }
                
                for point in series['data']:
                    unified_point = {'x': point['x'], 'y': point['y']}
                    if 'size' in point:
                        unified_point['size'] = point['size']
                    unified_series['data'].append(unified_point)
                
                unified_data.append(unified_series)
                
        elif self.chart_type == 'hist':
            # Convert histogram: [{binStart, binEnd, count}] -> bar-like representation
            series_data = {
                'name': self.options.get('title', 'Histogram'),
                'renderType': 'histogram',
                'data': []
            }
            
            for item in self.data:
                bin_center = (item['binStart'] + item['binEnd']) / 2
                series_data['data'].append({
                    'x': bin_center,
                    'y': item['count'],
                    'binStart': item['binStart'],
                    'binEnd': item['binEnd']
                })
            
            unified_data.append(series_data)
            
        else:
            # For other chart types, try to preserve as much as possible
            series_data = {
                'name': self.options.get('title', f'{self.chart_type} Data'),
                'renderType': self.chart_type,
                'data': self.data if isinstance(self.data, list) else [self.data]
            }
            unified_data.append(series_data)
        
        return unified_data
    
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
    
    def _extract_svg_dimensions(self):
        """Extract width and height from SVG string. Returns (width, height) or None."""
        import re
        try:
            # Look for width and height attributes in SVG tag
            svg_match = re.search(r'<svg[^>]*>', self.svg)
            if not svg_match:
                return None
            
            svg_tag = svg_match.group(0)
            
            # Extract width and height attributes
            width_match = re.search(r'width\s*=\s*["\']?(\d+(?:\.\d+)?)["\']?', svg_tag)
            height_match = re.search(r'height\s*=\s*["\']?(\d+(?:\.\d+)?)["\']?', svg_tag)
            
            if width_match and height_match:
                return (int(float(width_match.group(1))), int(float(height_match.group(1))))
            
            # Fallback: try to extract from viewBox
            viewbox_match = re.search(r'viewBox\s*=\s*["\']?[\d\.\s]*\s+[\d\.\s]*\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["\']?', svg_tag)
            if viewbox_match:
                return (int(float(viewbox_match.group(1))), int(float(viewbox_match.group(2))))
            
            return None
        except:
            return None
    
    def save_svg(self, filepath: str):
        """
        Save chart as SVG file.
        
        Args:
            filepath: Path to save the SVG file (relative or absolute)
        
        Example:
            chart.save_svg("figure.svg")
            chart.save_svg("results/chart.svg")
        """
        # Resolve and validate file path
        full_path = Path(filepath).expanduser().resolve()
        
        # Create parent directories if they don't exist
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            # Write SVG content to file
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(self.svg)
        except Exception as e:
            raise RuntimeError(f"Failed to save SVG to {full_path}: {str(e)}")
    
    def save_png(self, filepath: str, scale: float = 1.0, dpi: Optional[float] = None):
        """
        Save chart as PNG file.
        
        Args:
            filepath: Path to save the PNG file (relative or absolute)
            scale: Scale factor for output size (default: 1.0, mutually exclusive with dpi)
            dpi: DPI for output (overrides scale if provided, mutually exclusive with scale)
        
        Examples:
            chart.save_png("figure.png")                # Native resolution
            chart.save_png("figure.png", scale=2.0)     # 2x resolution
            chart.save_png("figure.png", dpi=300)       # Publication quality
        """
        # Validate parameters
        if dpi is not None and scale != 1.0:
            raise ValueError("Cannot specify both dpi and scale parameters")
        
        # Resolve and validate file path
        full_path = Path(filepath).expanduser().resolve()
        
        # Create parent directories if they don't exist
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            # Get bridge instance and convert to PNG
            bridge = _get_default_bridge()
            png_bytes = bridge.convert_svg_to_png(self.svg, scale=scale, dpi=dpi)
            
            # Write PNG bytes to file
            with open(full_path, 'wb') as f:
                f.write(png_bytes)
                
        except Exception as e:
            error_msg = str(e)
            if "stack" in error_msg.lower() or "maximum call stack" in error_msg.lower():
                # Calculate suggested max scale
                svg_dims = self._extract_svg_dimensions()
                if svg_dims:
                    max_scale = min(4096 // svg_dims[0], 4096 // svg_dims[1])
                    max_scale = max(1, max_scale)  # At least 1
                    raise RuntimeError(f"Image too large for scale={scale}. Try scale={max_scale} or smaller.\n"
                                     f"Current dimensions would be {svg_dims[0]*scale}×{svg_dims[1]*scale}, max supported is 4096×4096.\n"
                                     f"Or use SVG instead: chart.save_svg('{full_path.with_suffix('.svg')}')")
                else:
                    raise RuntimeError(f"Image too large for scale={scale}. Try a smaller scale factor.\n"
                                     f"Or use SVG instead: chart.save_svg('{full_path.with_suffix('.svg')}')")
            elif "resvg" in error_msg.lower() or "npm:" in error_msg:
                raise RuntimeError(f"PNG export requires @resvg/resvg-js. This will be downloaded automatically on first use.\n"
                                 f"If the error persists, try:\n"
                                 f"  deno cache npm:@resvg/resvg-js\n"
                                 f"Or use SVG instead:\n"
                                 f"  chart.save_svg('{full_path.with_suffix('.svg')}')")
            else:
                raise RuntimeError(f"Failed to save PNG to {full_path}: {error_msg}")
    
    def save(self, filepath: str, **kwargs):
        """
        Save chart with format auto-detected from file extension.
        
        Args:
            filepath: Path to save the file (extension determines format)
            **kwargs: Additional arguments passed to format-specific save method
        
        Supported formats:
            .svg - Scalable Vector Graphics
            .png - Portable Network Graphics
        
        Examples:
            chart.save("figure.svg")                    # SVG format
            chart.save("figure.png")                    # PNG format 
            chart.save("figure.png", dpi=300)          # PNG with 300 DPI
            chart.save("figure.png", scale=2.0)        # PNG at 2x scale
        """
        file_path = Path(filepath)
        extension = file_path.suffix.lower()
        
        if extension == '.svg':
            # Only pass kwargs that svg save method accepts (none currently)
            svg_kwargs = {}
            self.save_svg(filepath, **svg_kwargs)
        elif extension == '.png':
            # Pass kwargs to PNG save method
            self.save_png(filepath, **kwargs)
        else:
            supported_formats = ['.svg', '.png']
            raise ValueError(f"Unsupported file format '{extension}'. "
                           f"Supported formats: {', '.join(supported_formats)}")



