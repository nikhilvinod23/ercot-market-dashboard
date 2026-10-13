window.UI = (() => {
  const colors = [
    "#88b6e4",
    "#e9b078",
    "#79c9b5",
    "#abb3c9",
    "#d49aa9",
    "#96adbf",
    "#c9bc79",
    "#b49ed6",
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
  function chart(id, data, lines, unit = "", options = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const values = options.stacked
      ? data.flatMap((r) => {
          if (!lines.every((l) => valid(r[l.key]))) return [];
          return [
            lines.reduce((s, l) => s + Math.max(0, Number(r[l.key])), 0),
            lines.reduce((s, l) => s + Math.min(0, Number(r[l.key])), 0),
          ];
        })
      : data.flatMap((r) =>
          lines
            .map((l) => r[l.key])
            .filter(valid)
            .map(Number),
        );
    if (!values.length) {
      el.innerHTML = '<div class="empty">No readings for this period</div>';
      return;
    }
    const w = Math.max(200, Math.round(el.clientWidth || 760)),
      h = 245,
      left = Math.max(
        60,
        Math.max(
          ...values.map((v) => number(v, Math.abs(v) < 100 ? 1 : 0).length),
        ) *
          8 +
          18,
      ),
      right = 16,
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
            : data.length === 1
              ? 0.5
              : i / Math.max(data.length - 1, 1)),
      y = (v) => h - bottom - ((v - low) / (high - low)) * (h - top - bottom);
    let svg = "";
    for (let j = 0; j < 4; j++) {
      const v = low + ((high - low) * j) / 3;
      svg += `<line class="chart-grid" x1="${left}" y1="${y(v)}" x2="${w - right}" y2="${y(v)}"/><text class="chart-axis" x="${left - 8}" y="${y(v) + 3}" text-anchor="end">${number(v, Math.abs(v) < 100 ? 1 : 0)}</text>`;
    }
    const positive = data.map(() => 0),
      negative = data.map(() => 0);
    lines.forEach((l, j) => {
      if (options.stacked) {
        let segment = [];
        const flush = () => {
          if (segment.length)
            svg += `<path d="M${segment.map((p) => `${p.x},${p.upper}`).join(" L")} L${segment
              .slice()
              .reverse()
              .map((p) => `${p.x},${p.lower}`)
              .join(
                " L",
              )} Z" fill="${l.color || colors[j % colors.length]}" opacity=".8"/>`;
          segment = [];
        };
        data.forEach((r, i) => {
          if (!lines.every((line) => valid(r[line.key]))) {
            flush();
            return;
          }
          const value = Number(r[l.key]),
            totals = value < 0 ? negative : positive,
            base = totals[i];
          totals[i] += value;
          segment.push({ x: x(i), upper: y(totals[i]), lower: y(base) });
        });
        flush();
        return;
      }
      let path = "",
        connected = false;
      data.forEach((r, i) => {
        if (valid(r[l.key])) {
          path += `${connected ? "L" : "M"}${x(i)},${y(Number(r[l.key]))} `;
          connected = true;
        } else connected = false;
      });
      svg += `<path class="chart-line" d="${path}" stroke="${l.color || colors[j % colors.length]}" ${l.dash ? 'stroke-dasharray="5 5"' : ""}/>`;
      if (data.length === 1 && valid(data[0][l.key]))
        svg += `<circle cx="${x(0)}" cy="${y(Number(data[0][l.key]))}" r="4" fill="${l.color || colors[j % colors.length]}"/>`;
    });
    [
      ...new Set(
        w < 420
          ? [0, data.length - 1]
          : [0, Math.floor(data.length / 2), data.length - 1],
      ),
    ].forEach(
      (i) =>
        (svg += `<text class="chart-axis" x="${x(i)}" y="${h - 5}" text-anchor="${data.length === 1 ? "middle" : i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}">${escape(temporal && times.at(-1) - times[0] > 86400000 ? String(data[i]?.timestamp).slice(w < 420 ? 5 : 0, 10) : time(data[i]?.timestamp))}</text>`),
    );
    svg += `<line class="crosshair" y1="18" y2="217"/><rect x="${left}" y="0" width="${w - left - right}" height="235" fill="transparent"/>`;
    el.innerHTML = `<div class="legend">${lines.map((l, j) => `<span><i style="background:${l.color || colors[j % colors.length]}"></i>${escape(l.label)}</span>`).join("")}<span>${escape(unit)}</span></div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(lines.map((l) => l.label).join(", "))} over time${options.stacked ? " · stacked generation" : ""}">${svg}</svg>`;
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
    root.onpointerleave = (ev) => {
      if (ev.pointerType !== "touch") hide();
    };
    root.onpointerdown = root.onpointermove;
    root.onpointercancel = hide;
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
      `<details class="chart-data"><summary>Data table · ${data.length} readings${data.length > 2000 ? " · first 2,000 shown; export for full history" : ""}</summary><div class="table-scroll"></div></details>`,
    );
    const detail = el.querySelector("details");
    detail.ontoggle = () => {
      if (!detail.open || detail.dataset.loaded) return;
      detail.dataset.loaded = "true";
      detail.querySelector(".table-scroll").innerHTML =
        `<table><thead><tr><th>Timestamp</th>${lines.map((l) => "<th>" + escape(l.label) + " " + escape(unit) + "</th>").join("")}</tr></thead><tbody>${data
          .slice(0, 2000)
          .map(
            (r) =>
              "<tr><td>" +
              escape(r.timestamp) +
              "</td>" +
              lines
                .map((l) => "<td>" + number(r[l.key], 2) + "</td>")
                .join("") +
              "</tr>",
          )
          .join("")}</tbody></table>`;
    };
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
    const width = Math.max(200, el.clientWidth || 760),
      left = Math.max(
        62,
        number(Math.max(Math.abs(loY), Math.abs(hiY)), 0).length * 8 + 14,
      ),
      right = 25;
    const x = (v) =>
        left + ((v - loX) / (hiX - loX || 1)) * (width - left - right),
      y = (v) => 210 - ((v - loY) / (hiY - loY || 1)) * 185;
    let guides = "";
    for (let i = 0; i < 4; i++) {
      const vx = loX + ((hiX - loX) * i) / 3,
        vy = loY + ((hiY - loY) * i) / 3;
      guides += `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(vy)}" y2="${y(vy)}"/><text class="chart-axis" x="${left - 8}" y="${y(vy) + 4}" text-anchor="end">${number(vy, 0)}</text><text class="chart-axis" x="${x(vx)}" y="235" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${number(vx, 2)}</text>`;
    }
    el.innerHTML =
      '<div class="legend"><span>Henry Hub $/MMBtu → daily power $/MWh</span></div>' +
      `<svg viewBox="0 0 ${width} 250" role="img" aria-label="Daily Henry Hub versus electricity prices">${guides}${points.map((p, i) => `<circle cx="${x(p.gas)}" cy="${y(p.power)}" r="4" fill="${colors[0]}" opacity=".65" tabindex="0" data-point="${i}"/>`).join("")}</svg>`;
    el.querySelectorAll("circle").forEach((c) => {
      const p = points[+c.dataset.point];
      c.onpointermove = (ev) =>
        tooltip(
          ev,
          `<strong>${escape(p.date)}</strong><div>Henry Hub $${number(p.gas, 2)}/MMBtu</div><div>Power $${number(p.power, 2)}/MWh</div>`,
        );
      c.onpointerleave = hide;
      c.onpointerdown = c.onpointermove;
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
    el.innerHTML = `<div class="bars" aria-label="Current generation by fuel">${rows
      .map((r, i) => {
        const y = i * 36 + 20,
          color =
            r.fuel === "Solar"
              ? colors[1]
              : r.fuel === "Wind"
                ? colors[0]
                : colors[2];
        return `<div tabindex="0" data-fuel="${i}"><div class="bar-head"><span>${escape(r.fuel)}</span><strong>${number(r.value)} MW</strong></div><div class="bar-track"><div class="bar-fill" style="width:${(Math.abs(r.value) / Math.max(hi, Math.abs(lo))) * 100}%;background:${r.value < 0 ? "#d49aa9" : color}"></div></div></div>`;
      })
      .join(
        "",
      )}</div><div class="map-time-note">${escape(reading.timestamp)} CT · negative storage = charging</div>`;
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
  document.addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest(".chart,.map-svg")) hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
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
