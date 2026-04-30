import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeLaunches } from "./yc.js";
import { writeExports } from "./exporters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const exportsDir = path.join(rootDir, "exports");
const dataPath = path.join(rootDir, "data", "yc-launches.json");
const port = Number(process.env.PORT || 3000);

let activeScrape = null;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/data" && request.method === "GET") {
      await sendSavedData(response);
      return;
    }

    if (url.pathname === "/api/scrape" && (request.method === "GET" || request.method === "POST")) {
      await handleScrape(request, response, url);
      return;
    }

    if (url.pathname.startsWith("/exports/")) {
      await sendFile(request, response, safeJoin(exportsDir, url.pathname.replace("/exports/", "")));
      return;
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const filePath = url.pathname === "/"
      ? path.join(publicDir, "index.html")
      : safeJoin(publicDir, url.pathname);
    await sendFile(request, response, filePath);
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT to another value or stop the existing server.`);
  } else {
    console.error(error.stack || error.message);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log(`YC Launches scraper running at http://localhost:${port}`);
});

async function handleScrape(request, response, url) {
  if (activeScrape) {
    sendJson(response, 409, { error: "A scrape is already running" });
    return;
  }

  const body = request.method === "POST" ? await readJsonBody(request) : {};
  const options = {
    pages: parsePages(body.pages ?? url.searchParams.get("pages") ?? 1),
    hitsPerPage: parseInteger(body.hitsPerPage ?? url.searchParams.get("hitsPerPage"), 100, 1, 100),
    concurrency: parseInteger(body.concurrency ?? url.searchParams.get("concurrency"), 4, 1, 10),
    limit: parseInteger(body.limit ?? url.searchParams.get("limit"), 0, 0, 10000),
    includeLaunchDetails: parseBool(body.includeLaunchDetails ?? url.searchParams.get("includeLaunchDetails") ?? true),
    includeCompanyDetails: parseBool(body.includeCompanyDetails ?? url.searchParams.get("includeCompanyDetails") ?? true)
  };

  activeScrape = scrapeLaunches(options)
    .then(async ({ records, meta }) => {
      const paths = await writeExports(records, { meta });
      return { records, meta, paths };
    })
    .finally(() => {
      activeScrape = null;
    });

  const result = await activeScrape;
  sendJson(response, 200, result);
}

async function sendSavedData(response) {
  try {
    const data = JSON.parse(await readFile(dataPath, "utf8"));
    sendJson(response, 200, data);
  } catch {
    sendJson(response, 404, { records: [], meta: {}, error: "No saved scrape yet" });
  }
}

async function sendFile(request, response, filePath) {
  let content;
  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }

  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

function safeJoin(baseDir, requestedPath) {
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const resolved = path.join(baseDir, normalized);
  if (!resolved.startsWith(baseDir)) {
    throw new Error("Invalid path");
  }
  return resolved;
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8"
  }[ext] || "application/octet-stream";
}

function parsePages(value) {
  if (value === "all") {
    return Infinity;
  }
  return parseInteger(value, 1, 1, 50);
}

function parseInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function parseBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}
