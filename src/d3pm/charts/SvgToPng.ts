/**
 * SvgToPng.ts - SVG to PNG conversion using @resvg/resvg-js
 * 
 * Uses the pure JavaScript/WASM resvg library for high-quality SVG to PNG conversion.
 * No system dependencies required - works entirely within Deno's JavaScript runtime.
 */

interface ConversionOptions {
    scale?: number;
    dpi?: number;
}

interface ConversionResult {
    success: boolean;
    data?: Uint8Array;
    error?: string;
    width?: number;
    height?: number;
}

/**
 * Convert SVG string to PNG using Deno's canvas APIs
 */
async function convertSvgToPng(svgString: string, options: ConversionOptions = {}): Promise<ConversionResult> {
    try {
        // Parse options with defaults
        const { scale = 1.0, dpi } = options;
        
        // Calculate effective scale (DPI takes precedence over scale)
        let effectiveScale = scale;
        if (dpi !== undefined) {
            effectiveScale = dpi / 72; // 72 DPI is the baseline
        }
        
        // Extract SVG dimensions
        const svgDimensions = extractSvgDimensions(svgString);
        if (!svgDimensions) {
            return {
                success: false,
                error: "Could not extract SVG dimensions from SVG string"
            };
        }
        
        // Calculate final canvas dimensions
        const finalWidth = Math.round(svgDimensions.width * effectiveScale);
        const finalHeight = Math.round(svgDimensions.height * effectiveScale);
        
        // Debug output
        console.warn(`SVG dimensions: ${svgDimensions.width}x${svgDimensions.height}`);
        console.warn(`Scale: ${effectiveScale}, Final dimensions: ${finalWidth}x${finalHeight}`);
        
        // Try different canvas approaches
        const result = await tryCanvasConversion(svgString, finalWidth, finalHeight);
        
        if (result.success) {
            return {
                ...result,
                width: finalWidth,
                height: finalHeight
            };
        }
        
        return {
            success: false,
            error: "PNG conversion failed. The @resvg/resvg-js library is required for SVG to PNG conversion."
        };
        
    } catch (error) {
        return {
            success: false,
            error: `PNG conversion failed: ${error.message}`
        };
    }
}

/**
 * Convert SVG to PNG using @resvg/resvg-js
 */
async function tryCanvasConversion(svgString: string, width: number, height: number): Promise<ConversionResult> {
    try {
        return await convertWithResvg(svgString, width, height);
    } catch (error) {
        return {
            success: false,
            error: `PNG conversion failed: ${error.message}. Ensure Deno can access npm:@resvg/resvg-js`
        };
    }
}

/**
 * Convert using @resvg/resvg-js (pure JS/WASM implementation)
 */
async function convertWithResvg(svgString: string, width: number, height: number): Promise<ConversionResult> {
    try {
        // Dynamic import to avoid errors if not available
        const { Resvg } = await import("npm:@resvg/resvg-js");
        
        // Limit maximum dimensions to prevent stack overflow
        const maxDimension = 4096; // 4K max to prevent stack overflow
        const finalWidth = Math.min(width, maxDimension);
        const finalHeight = Math.min(height, maxDimension);
        
        // Configure resvg options - use explicit dimensions instead of scale
        const opts = {
            fitTo: {
                mode: 'width' as const,
                value: finalWidth
            },
            font: {
                loadSystemFonts: true
            },
            background: 'transparent'
        };
        
        console.warn(`Resvg options: ${JSON.stringify(opts)}`);
        
        // Clean SVG string and ensure proper font specifications
        let cleanSvg = svgString.trim();
        
        // Ensure text elements have proper font-family if missing
        if (!cleanSvg.includes('font-family')) {
            cleanSvg = cleanSvg.replace(
                /<text([^>]*)>/g, 
                '<text$1 font-family="Arial, sans-serif">'
            );
        }
        
        // Add a style block for consistent text rendering
        if (cleanSvg.includes('<svg') && !cleanSvg.includes('<style>')) {
            cleanSvg = cleanSvg.replace(
                '<svg',
                '<svg'
            ).replace(
                /(<svg[^>]*>)/,
                '$1<style>text { font-family: Arial, sans-serif; } .title { font-weight: bold; }</style>'
            );
        }
        
        // Create resvg instance and render
        const resvg = new Resvg(cleanSvg, opts);
        const pngData = resvg.render();
        const pngBuffer = pngData.asPng();
        
        return {
            success: true,
            data: new Uint8Array(pngBuffer)
        };
        
    } catch (error) {
        // Provide more specific error information
        let errorMessage = error.message;
        if (errorMessage.includes("stack")) {
            errorMessage = "Image too large or complex. Try reducing scale or chart size.";
        }
        throw new Error(`Resvg conversion failed: ${errorMessage}`);
    }
}



/**
 * Extract width and height from SVG string
 */
function extractSvgDimensions(svgString: string): { width: number; height: number } | null {
    try {
        // Look for width and height attributes in SVG tag
        const svgMatch = svgString.match(/<svg[^>]*>/);
        if (!svgMatch) {
            return null;
        }
        
        const svgTag = svgMatch[0];
        
        // Extract width and height attributes
        const widthMatch = svgTag.match(/width\s*=\s*["']?(\d+(?:\.\d+)?)["']?/);
        const heightMatch = svgTag.match(/height\s*=\s*["']?(\d+(?:\.\d+)?)["']?/);
        
        if (widthMatch && heightMatch) {
            return {
                width: parseFloat(widthMatch[1]),
                height: parseFloat(heightMatch[1])
            };
        }
        
        // Fallback: try to extract from viewBox
        const viewBoxMatch = svgTag.match(/viewBox\s*=\s*["']?[\d\.\s]*\s+[\d\.\s]*\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']?/);
        if (viewBoxMatch) {
            return {
                width: parseFloat(viewBoxMatch[1]),
                height: parseFloat(viewBoxMatch[2])
            };
        }
        
        return null;
        
    } catch (error) {
        return null;
    }
}

/**
 * Main function - called from command line
 */
async function main() {
    try {
        // Parse command line arguments
        const args = Deno.args;
        if (args.length < 2) {
            console.error("Usage: deno run --allow-all SvgToPng.ts <svg_string> <options_json>");
            Deno.exit(1);
        }
        
        const svgString = args[0];
        const optionsJson = args[1];
        
        let options: ConversionOptions = {};
        try {
            options = JSON.parse(optionsJson);
        } catch (error) {
            console.error("Invalid options JSON:", error.message);
            Deno.exit(1);
        }
        
        // Convert SVG to PNG
        const result = await convertSvgToPng(svgString, options);
        
        if (result.success && result.data) {
            // Write PNG data to stdout as base64
            const base64Data = btoa(String.fromCharCode(...result.data));
            console.log(JSON.stringify({
                success: true,
                data: base64Data,
                width: result.width,
                height: result.height
            }));
        } else {
            console.error(JSON.stringify({
                success: false,
                error: result.error
            }));
            Deno.exit(1);
        }
        
    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            error: `Conversion failed: ${error.message}`
        }));
        Deno.exit(1);
    }
}

// Run main function if this script is executed directly
if (import.meta.main) {
    await main();
}

export { convertSvgToPng, ConversionOptions, ConversionResult };