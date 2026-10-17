import http from "node:http";
import { build } from "esbuild";

const HOST = "127.0.0.1";
const PORT = 3338;

const bundle = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["scripts/fixtures/private-browser-harness.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  sourcemap: false,
  // The isolated harness never loads the application's provider environment.
  define: { "process.env": "{}" },
  logLevel: "warning",
});
const script = bundle.outputFiles[0].text;
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private browser harness</title></head><body><p>Loading synthetic private browser harness...</p><script>${script}</script></body></html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/" || request.url?.startsWith("/?account=")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'" });
    response.end(page);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Private browser harness listening at http://${HOST}:${PORT}/?account=A`);
  console.log(`Open the second synthetic tab at http://${HOST}:${PORT}/?account=B`);
  console.log("Synthetic-only: no app routes, environment values, secrets, or network calls are used.");
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
