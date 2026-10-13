const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const out = path.join(__dirname, "dist");
fs.mkdirSync(out, { recursive: true });
for (const name of [
  "index.html",
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
  path.join(out, "index.html"),
  fs
    .readFileSync(path.join(out, "index.html"), "utf8")
    .replace('content="live"', 'content="published"'),
);
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
