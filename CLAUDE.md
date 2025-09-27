# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

d3pm is a Python package that provides academic-style visualizations by bridging Python with D3.js through Deno runtime. It generates publication-ready SVG charts with clean, minimal styling optimized for research and academic use.

## Architecture

### Core Components

**Python Layer (`src/d3pm/`)**
- `bridge.py`: Main interface between Python and Deno D3.js scripts. Contains the `D3DenoBridge` class for subprocess communication and `Chart` class for composition operations (+, *, /)
- `__init__.py`: Public API exposing convenience functions (`bar`, `line`, `scatter`, `hist`) and core classes

**TypeScript/Deno Layer (`src/d3pm/charts/`)**
- `BaseChart.ts`: Abstract base class providing shared functionality, theme management, and chart composition interface
- Individual chart implementations: `BarChart.ts`, `LineChart.ts`, `ScatterChart.ts`, `HistogramChart.ts`
- `ChartComposer.ts`: Handles chart composition operations (overlay, side-by-side, vertical layouts)

### Data Flow

1. Python functions (`d3pm.bar()`, etc.) serialize data to JSON
2. `D3DenoBridge` spawns Deno subprocess with TypeScript chart script
3. Deno script generates SVG using D3.js and returns to Python
4. Python `Chart` object wraps SVG and enables composition operations
5. Display through Jupyter widgets or direct SVG output

## Development Commands

**Installation:**
```bash
pip install -e .                    # Development install
conda env create -f environment.yml # Create conda environment with Deno
```

**Testing Examples:**
```bash
cd examples/
jupyter notebook examples.ipynb     # Run main examples
jupyter notebook experiments.ipynb  # Development playground
```

## Key Requirements

- **Deno Runtime**: Required for D3.js chart generation. Charts are TypeScript modules executed via Deno subprocess calls
- **Path Resolution**: `bridge.py` includes complex path resolution logic to find chart scripts from various execution contexts (package install, development, Jupyter notebooks)
- **Chart Composition**: Mathematical operators (+, *, /) enable chart composition through the `ChartComposer` TypeScript module

## Chart Types and Data Formats

**New Array-Based API (Current):**
- **Bar Charts**: `d3pm.bar(categories, values)` where categories=list of strings, values=list of numbers
- **Line Charts**: `d3pm.line(x, y)` where x,y=arrays of numbers. Multi-series: `d3pm.line([x1,x2], [y1,y2], label=["S1","S2"])`
- **Scatter Plots**: `d3pm.scatter(x, y, size=None)` where x,y=arrays, optional size array for variable point sizes
- **Histograms**: `d3pm.hist(values, bins=20)` where values=array of numbers, auto-bins or custom bin count

**Internal Data Format (converted automatically):**
- Bar Charts: `[{"label": str, "value": float}]`
- Line/Scatter: `[{"name": str, "data": [{"x": float, "y": float, "size"?: float}]}]`
- Histograms: `[{"binStart": float, "binEnd": float, "count": int}]`

## TypeScript Chart Architecture

All chart classes extend `BaseChart<TData, TOptions>` which provides:
- Theme management (dark/light mode detection)
- Scale creation utilities (linear, ordinal, equal aspect ratio)
- Tick formatting and smart label management
- Composition interface implementation

Chart generation follows template method pattern: `render()` calls `renderBackground()`, `renderAxes()`, `renderChartElements()` (abstract), etc.

## API Changes

**Current simplified API eliminates complex nested dictionaries:**
- Labels/titles default to `None` (not rendered) instead of empty strings
- Direct array inputs instead of nested data structures
- Keyword arguments for styling instead of options dictionaries
- Multi-series support through array-of-arrays inputs
- Automatic numpy array conversion in bridge.py