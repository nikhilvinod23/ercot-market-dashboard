const fs = require("node:fs");
const path = require("node:path");
const { marketData, fetchWithTimeout } = require("./server");
async function main() {
  const data = await marketData.collectAll();
  if (!data.current.prices)
    throw Error("No prices available; retain previous dashboard snapshot.");
  data.mode = "published";
  data.publishedAt = new Date().toISOString();
  data.contourUrl = "data/contour.png";
  const out = path.join(__dirname, "public", "data");
  fs.mkdirSync(out, { recursive: true });
  try {
    const r = await fetchWithTimeout(
      "https://www.ercot.com/content/cdr/contours/rtmLmp.png",
    );
    if (r.ok)
      fs.writeFileSync(
        path.join(out, "contour.png"),
        Buffer.from(await r.arrayBuffer()),
      );
  } catch {}
  fs.writeFileSync(path.join(out, "dashboard.json.tmp"), JSON.stringify(data));
  fs.renameSync(
    path.join(out, "dashboard.json.tmp"),
    path.join(out, "dashboard.json"),
  );
  console.log("Supplemental market snapshot saved.");
}
main().catch(() => {
  console.error(
    "Supplemental snapshot collection failed; prior edition retained.",
  );
  process.exitCode = 1;
});
