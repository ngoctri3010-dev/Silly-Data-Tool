import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const startPort = Number(process.argv[2] || process.env.PORT || 8787);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const fullPath = normalize(join(root, requested));
  if (fullPath !== root && !fullPath.startsWith(`${root}${sep}`)) {
    return null;
  }
  return fullPath;
}

function serve(port) {
  const server = createServer(async (request, response) => {
    const filePath = safePath(request.url || "/");
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const type = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < startPort + 30) {
      serve(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, "0.0.0.0", async () => {
    await writeFile(join(root, ".server-url"), `http://localhost:${port}\n`, "utf8");
    await readFile(join(root, "index.html"), "utf8");
    console.log(`Silly Data Builder running at http://localhost:${port}`);
  });
}

serve(startPort);
