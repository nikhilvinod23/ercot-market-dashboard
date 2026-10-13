window.Maps = (() => {
  const { escape: e, number: n, tooltip, hide, valid } = UI;
  const zones = {
    NORTH: "north",
    EAST: "east",
    "NORTH CENTRAL": "northC",
    WEST: "west",
    "FAR WEST": "farWest",
    "SOUTH CENTRAL": "southC",
    COAST: "coast",
    SOUTH: "southern",
  };
  const positions = {
    Dallas: [690, -670],
    Houston: [860, -390],
    Austin: [720, -430],
    "San Antonio": [680, -360],
    Midland: [320, -580],
    Abilene: [490, -670],
    "Wichita Falls": [600, -766],
    Tyler: [830, -630],
    "Corpus Christi": [700, -220],
  };
  function color(v, lo, hi) {
    if (!valid(v)) return "#e8ecf0";
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    const a = t < 0.5 ? [44, 104, 159] : [239, 222, 185],
      b = t < 0.5 ? [239, 222, 185] : [177, 58, 55],
      k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(",")})`;
  }
  function timeline(id, frames, draw) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!frames?.length) {
      el.innerHTML = '<div class="empty">Waiting for source data</div>';
      return;
    }
    el.innerHTML =
      '<div class="map-shell"></div><div class="map-controls"><input type="range" aria-label="Map timestamp" min="0" max="' +
      (frames.length - 1) +
      '" value="' +
      (frames.length - 1) +
      '"><output></output></div><div class="selected-detail">Hover a region or location for its value.</div>';
    const range = el.querySelector("input"),
      output = el.querySelector("output");
    const render = () => {
      const f = frames[+range.value];
      output.textContent = f.timestamp || "Latest";
      draw(
        el.querySelector(".map-shell"),
        f,
        el.querySelector(".selected-detail"),
      );
    };
    range.oninput = render;
    render();
  }
  function bind(el, details) {
    el.querySelectorAll("[data-tip]").forEach((node) => {
      node.onpointermove = (ev) => tooltip(ev, node.dataset.tip);
      node.onpointerleave = hide;
      node.onclick = () => (details.innerHTML = node.dataset.tip);
      node.setAttribute("tabindex", "0");
      node.onfocus = () => (details.innerHTML = node.dataset.tip);
    });
  }
  function regional(id, geometry, frames, { unit = "", markers = false } = {}) {
    const scaleValues = (frames || [])
        .flatMap((f) => Object.values(f.values || {}))
        .filter(valid)
        .map(Number),
      fixedLow = Math.min(...scaleValues),
      fixedHigh = Math.max(...scaleValues);
    timeline(id, frames, (el, f, details) => {
      if (!geometry?.shapes) {
        el.innerHTML = '<div class="empty">Region boundaries unavailable</div>';
        return;
      }
      const vals = Object.values(f.values || {})
          .filter(valid)
          .map(Number),
        lo = fixedLow,
        hi = fixedHigh;
      let content = geometry.shapes
        .map((s) => {
          const v = f.values?.[zones[s.name]];
          return `<path class="map-shape" d="${e(s.path)}" fill="${markers || s.name === "Texas" ? "#f1f3f5" : color(v, lo, hi)}" stroke="#fff" stroke-width="2" data-tip="${e("<strong>" + s.name + "</strong><div>" + n(v, 1) + " " + unit + "</div><div>" + f.timestamp + "</div>")}"/>`;
        })
        .join("");
      if (markers)
        content += (f.markers || [])
          .map((p) => {
            const xy = positions[p.name];
            if (!xy) return "";
            return `<circle cx="${xy[0]}" cy="${xy[1]}" r="14" fill="${color(p.value, lo, hi)}" stroke="#fff" stroke-width="3" data-tip="${e("<strong>" + p.name + "</strong><div>" + n(p.value, 2) + " " + unit + "</div><div>" + f.timestamp + "</div>")}"/><text x="${xy[0] + 18}" y="${xy[1] + 5}" font-size="20">${e(p.name)}</text>`;
          })
          .join("");
      el.innerHTML = `<svg class="map-svg" viewBox="0 -1000 1000 1000" aria-label="Regional map">${content}</svg><div class="map-scale">${n(lo, 1)} ${unit}<span></span>${n(hi, 1)} ${unit}</div>`;
      bind(el, details);
    });
  }
  function nodal(id, frames) {
    const all = (frames || []).flatMap((f) => f.points.map((p) => p.price)),
      fixedLow = Math.min(...all),
      fixedHigh = Math.max(...all);
    timeline(id, frames, (el, f, details) => {
      const vals = f.points.map((p) => p.price),
        lo = fixedLow,
        hi = fixedHigh;
      el.innerHTML = `<svg class="map-svg" viewBox="0 0 600 600" aria-label="ERCOT nodal LMP"><image href="/api/contour" width="600" height="600" opacity=".15" style="filter:grayscale(1)"/>${f.points.map((p) => `<circle class="map-node" cx="${p.x}" cy="${p.y}" r="4" fill="${color(p.price, lo, hi)}" data-tip="${e("<strong>" + p.name + "</strong><div>$" + n(p.price, 2) + "/MWh</div><div>" + f.timestamp + " CT</div>")}"/>`).join("")}</svg><div class="map-scale">$${n(lo, 2)}<span></span>$${n(hi, 2)}</div>`;
      bind(el, details);
    });
  }
  function plants(id, plants) {
    const el = document.getElementById(id);
    if (!el) return;
    const z = 5,
      size = 256,
      px = (lon) => ((lon + 180) / 360) * 2 ** z * size,
      py = (lat) =>
        ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) *
        2 ** z *
        size;
    const ox = 6 * size,
      oy = 12 * size;
    let tiles = "";
    for (let x = 6; x <= 8; x++)
      for (let y = 12; y <= 14; y++)
        tiles += `<image href="https://tile.openstreetmap.org/${z}/${x}/${y}.png" x="${x * size - ox}" y="${y * size - oy}" width="256" height="256"/>`;
    el.innerHTML = `<div class="map-shell"><svg class="map-svg" viewBox="95 110 455 405" aria-label="Texas generation locations">${tiles}${plants.map((p) => `<circle cx="${px(p.lon) - ox}" cy="${py(p.lat) - oy}" r="${Math.max(3, Math.min(11, Math.sqrt(p.capacity || 0) / 4))}" fill="${p.battery > 0 ? "#8b66a8" : p.wind > 0 ? "#25836d" : p.solar > 0 ? "#c07938" : "#638191"}" stroke="#fff" data-tip="${e("<strong>" + p.name + "</strong><div>" + p.fuel + " · " + n(p.capacity) + " MW</div><div>Wind " + n(p.wind) + " · Solar " + n(p.solar) + " · Battery " + n(p.battery) + " MW</div><div>" + n(p.lat, 4) + ", " + n(p.lon, 4) + "</div><div>Inventory " + p.period + "</div>")}"/>`).join("")}</svg></div><div class="selected-detail">Hover a resource for capacity and location.</div><div class="map-caption">© OpenStreetMap contributors · EIA plant inventory · Texas scope; ERCOT membership unverified</div>`;
    bind(el, el.querySelector(".selected-detail"));
  }
  return { regional, nodal, plants };
})();
