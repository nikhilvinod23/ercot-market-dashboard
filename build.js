const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const out = path.join(__dirname, "dist");
fs.mkdirSync(out, { recursive: true });
for (const name of [
  "styles.css",
  "app.js",
  "extensions.js",
  "data-client.js",
  "predictions.js",
  "icons.js",
  "charts.js",
  "maps.js",
  "analytics.js",
])
  fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
fs.cpSync(path.join(__dirname, "public", "data"), path.join(out, "data"), {
  recursive: true,
});
fs.writeFileSync(path.join(out, ".nojekyll"), "");
fs.writeFileSync(
  path.join(out, "ercot.html"),
  fs
    .readFileSync(path.join(__dirname, "index.html"), "utf8")
    .replace('content="live"', 'content="published"')
    .replace('href="home.html"', 'href="./"')
    .replace(/(src|href)="([\w-]+\.(?:js|css))"/g,(_,attribute,file)=>
      `${attribute}="${file}?v=${createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex').slice(0,12)}"`),
);
const europeOut = path.join(out, "europe");
fs.mkdirSync(europeOut, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "map.js", "market.js", "zones.js", "demo.js"]) {
  fs.copyFileSync(path.join(__dirname, "europe", file), path.join(europeOut, file));
}
let publishedEndpoint = "";
if (process.env.EUROPE_API_URL) {
  const url = new URL(process.env.EUROPE_API_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw Error("EUROPE_API_URL must be an HTTPS endpoint without credentials or query parameters.");
  publishedEndpoint = url.href;
}
fs.writeFileSync(path.join(europeOut, "public-api.js"),
  "export const publishedApi = " + JSON.stringify(publishedEndpoint) + ";\nexport const publishedBuild = true;\n");
const europePage = path.join(europeOut, "index.html");
fs.writeFileSync(europePage, fs.readFileSync(europePage, "utf8")
  .replace('href="http://127.0.0.1:8000/home.html"', 'href="../"'));
fs.writeFileSync(path.join(out, "index.html"), fs.readFileSync(path.join(__dirname, "home.html"), "utf8")
  .replace('href="./index.html"', 'href="./ercot.html"')
  .replace('href="http://127.0.0.1:4173/"', 'href="./europe/"'));
fs.copyFileSync(path.join(__dirname, "home.css"), path.join(out, "home.css"));
const dashboard = JSON.parse(
  fs.readFileSync(path.join(out, "data", "dashboard.json")),
);
if (!dashboard.current?.prices || !dashboard.geometry?.shapes?.length)
  throw Error("A complete market snapshot is required for publication.");
fs.writeFileSync(
  path.join(out, "data", "status.json"),
  JSON.stringify({
    revision: ["dashboard", "latest", "fuels", "reports", "kalshi"]
      .reduce((hash, name) => {
        const file = path.join(out, "data", name + ".json");
        if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
        return hash;
      }, createHash("sha256"))
      .digest("hex"),
    publishedAt: dashboard.publishedAt,
    latestPrice: dashboard.current.prices.timestamp,
    targetCadenceMinutes: 30,
  }),
);
for (const relative of fs.readdirSync(path.join(out, "data"), {
  recursive: true,
})) {
  if (String(relative).endsWith(".json")) {
    const file = path.join(out, "data", relative);
    fs.writeFileSync(
      file + ".gz",
      gzipSync(fs.readFileSync(file), { level: 9 }),
    );
  }
}
console.log("One dashboard packaged in dist/.");
