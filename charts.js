window.UI = (() => {
  const colors = [
    "#88b6e4",
    "#e9b078",
    "#79c9b5",
    "#abb3c9",
    "#d49aa9",
    "#96adbf",
  ];
  const valid = (v) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  const escape = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const number = (v, d = 0) =>
    valid(v)
      ? Number(v).toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        })
      : "—";
  const time = (t) => (t ? String(t).slice(11, 16) : "—");
  const tooltip = (event, html) => {
    const el = document.querySelector("#tooltip");
    el.innerHTML = html;
    el.style.display = "block";
    el.style.left =
      Math.max(
        8,
        Math.min(event.clientX + 14, innerWidth - el.offsetWidth - 12),
      ) + "px";
    el.style.top =
      Math.max(
        8,
        Math.min(event.clientY + 14, innerHeight - el.offsetHeight - 12),
      ) + "px";
  };
  const hide = () =>
    (document.querySelector("#tooltip").style.display = "none");
  function chart(id, data, lines, unit = "") {
    const el = document.getElementById(id);
    if (!el) return;
    const values = data.flatMap((r) =>
      lines
        .map((l) => r[l.key])
        .filter(valid)
        .map(Number),
    );
    if (!values.length) {
      el.innerHTML = '<div class="empty">No readings for this period</div>';
      return;
    }
    const w = 760,
      h = 245,
      left = 58,
      right = 12,
      top = 18,
      bottom = 28;
    const min = Math.min(...values),
      max = Math.max(...values),
      pad = Math.max(1, (max - min) * 0.12),
      low = min - pad,
      high = max + pad;
    const times = data.map((r) =>
      Date.parse(
        String(r.timestamp)
          .replace(" ", "T")
          .replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
      ),
    );
    const temporal = times.every(Number.isFinite) && times.at(-1) > times[0];
    const x = (i) =>
        left +
        (w - left - right) *
          (temporal
            ? (times[i] - times[0]) / (times.at(-1) - times[0])
            : i / Math.max(data.length - 1, 1)),
      y = (v) => h - bottom - ((v - low) / (high - low)) * (h - top - bottom);
    let svg = "";
    for (let j = 0; j < 4; j++) {
      const v = low + ((high - low) * j) / 3;
      svg += `<line class="chart-grid" x1="${left}" y1="${y(v)}" x2="${w - right}" y2="${y(v)}"/><text class="chart-axis" x="${left - 8}" y="${y(v) + 3}" text-anchor="end">${number(v, Math.abs(v) < 100 ? 1 : 0)}</text>`;
    }
    lines.forEach((l, j) => {
      let path = "",
        connected = false;
      data.forEach((r, i) => {
        if (valid(r[l.key])) {
          path += `${connected ? "L" : "M"}${x(i)},${y(Number(r[l.key]))} `;
          connected = true;
        } else connected = false;
      });
      svg += `<path class="chart-line" d="${path}" stroke="${l.color || colors[j]}" ${l.dash ? 'stroke-dasharray="5 5"' : ""}/>`;
    });
    [0, Math.floor(data.length / 2), data.length - 1].forEach(
      (i) =>
        (svg += `<text class="chart-axis" x="${x(i)}" y="${h - 5}" text-anchor="${i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}">${escape(temporal && times.at(-1) - times[0] > 86400000 ? String(data[i]?.timestamp).slice(0, 10) : time(data[i]?.timestamp))}</text>`),
    );
    svg +=
      '<line class="crosshair" y1="18" y2="217"/><rect x="58" y="0" width="690" height="235" fill="transparent"/>';
    el.innerHTML = `<div class="legend">${lines.map((l, j) => `<span><i style="background:${l.color || colors[j]}"></i>${escape(l.label)}</span>`).join("")}<span>${escape(unit)}</span></div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(lines.map((l) => l.label).join(", "))} over time">${svg}</svg>`;
    const root = el.querySelector("svg");
    root.onpointermove = (e) => {
      const b = root.getBoundingClientRect();
      const pointerX = ((e.clientX - b.left) / b.width) * w;
      const i = data.reduce(
        (best, _, index) =>
          Math.abs(x(index) - pointerX) < Math.abs(x(best) - pointerX)
            ? index
            : best,
        0,
      );
      const r = data[i];
      const c = root.querySelector(".crosshair");
      c.setAttribute("x1", x(i));
      c.setAttribute("x2", x(i));
      tooltip(
        e,
        `<strong>${escape(r.timestamp)} CT</strong>${lines.map((l) => `<div class="tip-row"><span>${escape(l.label)}</span><b>${number(r[l.key], 2)} ${escape(unit)}</b></div>`).join("")}`,
      );
    };
    root.onpointerleave = hide;
    root.setAttribute("tabindex", "0");
    let focusIndex = 0;
    root.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      focusIndex = Math.max(
        0,
        Math.min(
          data.length - 1,
          focusIndex + (e.key === "ArrowRight" ? 1 : -1),
        ),
      );
      const b = root.getBoundingClientRect();
      root.onpointermove({
        clientX: b.left + (x(focusIndex) / w) * b.width,
        clientY: b.top + 20,
      });
    };
    root.onblur = hide;
    el.insertAdjacentHTML(
      "beforeend",
      `<details class="chart-data"><summary>Data table · ${data.length} readings</summary><div class="table-scroll"><table><thead><tr><th>Timestamp</th>${lines.map((l) => "<th>" + escape(l.label) + " " + escape(unit) + "</th>").join("")}</tr></thead><tbody>${data
        .slice(0, 2000)
        .map(
          (r) =>
            "<tr><td>" +
            escape(r.timestamp) +
            "</td>" +
            lines.map((l) => "<td>" + number(r[l.key], 2) + "</td>").join("") +
            "</tr>",
        )
        .join("")}</tbody></table></div></details>`,
    );
  }
  function scatter(id, points) {
    const el = document.getElementById(id);
    if (!el) return;
    points = points.filter((p) => valid(p.gas) && valid(p.power));
    if (!points.length) {
      el.innerHTML =
        '<div class="empty">No matched daily observations yet</div>';
      return;
    }
    const xs = points.map((p) => p.gas),
      ys = points.map((p) => p.power),
      loX = Math.min(...xs),
      hiX = Math.max(...xs),
      loY = Math.min(...ys),
      hiY = Math.max(...ys);
    const x = (v) => 60 + ((v - loX) / (hiX - loX || 1)) * 680,
      y = (v) => 210 - ((v - loY) / (hiY - loY || 1)) * 185;
    let guides = "";
    for (let i = 0; i < 4; i++) {
      const vx = loX + ((hiX - loX) * i) / 3,
        vy = loY + ((hiY - loY) * i) / 3;
      guides += `<line class="chart-grid" x1="60" x2="740" y1="${y(vy)}" y2="${y(vy)}"/><text class="chart-axis" x="53" y="${y(vy) + 4}" text-anchor="end">${number(vy, 0)}</text><text class="chart-axis" x="${x(vx)}" y="235" text-anchor="middle">${number(vx, 2)}</text>`;
    }
    el.innerHTML =
      '<div class="legend"><span>Henry Hub $/MMBtu → daily power $/MWh</span></div>' +
      `<svg viewBox="0 0 760 250" role="img" aria-label="Daily Henry Hub versus electricity prices">${guides}${points.map((p, i) => `<circle cx="${x(p.gas)}" cy="${y(p.power)}" r="4" fill="${colors[0]}" opacity=".65" tabindex="0" data-point="${i}"/>`).join("")}</svg>`;
    el.querySelectorAll("circle").forEach((c) => {
      const p = points[+c.dataset.point];
      c.onpointermove = (ev) =>
        tooltip(
          ev,
          `<strong>${escape(p.date)}</strong><div>Henry Hub $${number(p.gas, 2)}/MMBtu</div><div>Power $${number(p.power, 2)}/MWh</div>`,
        );
      c.onpointerleave = hide;
      c.onfocus = () => {
        const r = c.getBoundingClientRect();
        c.onpointermove({ clientX: r.left, clientY: r.top });
      };
      c.onblur = hide;
    });
  }
  function fuelBars(id, reading) {
    const el = document.getElementById(id);
    if (!el) return;
    const rows = Object.entries(reading || {})
      .filter(([key, v]) => key !== "timestamp" && valid(v))
      .map(([fuel, value]) => ({ fuel, value }))
      .sort((a, b) => b.value - a.value);
    if (!rows.length) {
      el.innerHTML =
        '<div class="empty">No measured generation available</div>';
      return;
    }
    const lo = Math.min(0, ...rows.map((r) => r.value)),
      hi = Math.max(1, ...rows.map((r) => r.value));
    const x = (v) => 180 + ((v - lo) / (hi - lo)) * 490,
      zero = x(0);
    el.innerHTML = `<svg viewBox="0 0 760 ${rows.length * 36 + 10}" role="img" aria-label="Current generation by fuel">${rows
      .map((r, i) => {
        const y = i * 36 + 20,
          color =
            r.fuel === "Solar"
              ? colors[1]
              : r.fuel === "Wind"
                ? colors[0]
                : colors[2];
        return `<g tabindex="0" data-fuel="${i}"><text class="chart-axis" x="0" y="${y + 5}">${escape(r.fuel)}</text><line x1="180" x2="670" y1="${y}" y2="${y}" stroke="#263442" stroke-width="9"/><rect x="${Math.min(zero, x(r.value))}" y="${y - 4.5}" width="${Math.max(1, Math.abs(x(r.value) - zero))}" height="9" fill="${color}"/><text class="chart-axis" x="752" y="${y + 5}" text-anchor="end">${number(r.value)}</text></g>`;
      })
      .join(
        "",
      )}</svg><div class="map-time-note">${escape(reading.timestamp)} CT · MW · negative storage = charging</div>`;
    el.querySelectorAll("[data-fuel]").forEach((g) => {
      const r = rows[+g.dataset.fuel];
      g.onpointermove = (ev) =>
        tooltip(
          ev,
          `<strong>${escape(r.fuel)}</strong>${number(r.value, 2)} MW<div>${escape(reading.timestamp)} CT</div>`,
        );
      g.onpointerleave = hide;
      g.onfocus = () => {
        const b = g.getBoundingClientRect();
        g.onpointermove({ clientX: b.left, clientY: b.top });
      };
      g.onblur = hide;
    });
  }
  return {
    colors,
    valid,
    escape,
    number,
    time,
    tooltip,
    hide,
    chart,
    scatter,
    fuelBars,
  };
})();
