// Zero-dependency internal web server for the roadmap.
// Serves the page at "/" and the data at "/api/roadmap".
// Run with:  NOTION_TOKEN=... node server.js
// Intended to sit behind your company VPN or an SSO reverse proxy (see SETUP.md).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchInitiatives } = require("./notion");

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, "index.html"));

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/api/roadmap") {
    try {
      const data = await fetchInitiatives();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(INDEX);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`roadmap running on http://localhost:${PORT}`);
});
