/**
 * Static file serving middleware.
 *
 * Serves pre-built frontend files from `dist/web/`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/**
 * Create a static file handler for the given directory.
 *
 * Returns true if the request was served, false otherwise.
 */
export function createStaticHandler(
  staticDir: string,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    if (!fs.existsSync(staticDir)) return false;

    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return false;

    const urlPath = (req.url ?? "/").split("?")[0]!;

    // Skip API and WebSocket paths
    if (urlPath.startsWith("/api/") || urlPath.startsWith("/ws/")) return false;

    // Resolve file path
    let filePath: string;
    if (urlPath === "/" || urlPath === "") {
      filePath = path.join(staticDir, "index.html");
    } else {
      filePath = path.join(staticDir, urlPath);
    }

    // Security: prevent directory traversal
    const resolved = path.resolve(filePath);
    const resolvedBase = path.resolve(staticDir);
    if (!resolved.startsWith(resolvedBase)) {
      return false;
    }

    // Try the exact file
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      serveFile(resolved, res);
      return true;
    }

    // SPA fallback: serve index.html for non-file routes
    const ext = path.extname(resolved);
    if (!ext) {
      const indexPath = path.join(staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        serveFile(indexPath, res);
        return true;
      }
    }

    return false;
  };
}

function serveFile(filePath: string, res: ServerResponse): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });

  fs.createReadStream(filePath).pipe(res);
}
