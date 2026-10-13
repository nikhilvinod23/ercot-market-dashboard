window.DataClient = (() => {
  const published =
    document.querySelector('meta[name="market-mode"]')?.content === "published";
  async function json(url) {
    if (published && typeof DecompressionStream !== "undefined") {
      try {
        const response = await fetch(url + ".gz", { cache: "no-cache" });
        if (response.ok) {
          // Some CDNs decode Content-Encoding themselves; static .gz files usually do not.
          if (response.headers.get("Content-Encoding")?.includes("gzip"))
            return response.json();
          return await new Response(
            response.body.pipeThrough(new DecompressionStream("gzip")),
          ).json();
        }
      } catch {
        /* Original JSON remains available to older browsers and failed decoders. */
      }
    }
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw Error("Dashboard dataset unavailable");
    return response.json();
  }
  return { json };
})();
