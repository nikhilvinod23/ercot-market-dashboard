window.UI = (() => {
  const colors = [
    "#245db4",
    "#c07938",
    "#25836d",
    "#8b66a8",
    "#ba5054",
    "#638191",
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
    const times = data.map((r) => Date.parse(String(r.timestamp).replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')));
    const temporal = times.every(Number.isFinite) && times.at(-1) > times[0];
    const x = (i) =>
        left + (w - left - right) * (temporal ? (times[i]-times[0])/(times.at(-1)-times[0]) : i/Math.max(data.length-1,1)),
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
        (svg += `<text class="chart-axis" x="${x(i)}" y="${h - 5}" text-anchor="middle">${escape(time(data[i]?.timestamp))}</text>`),
    );
    svg +=
      '<line class="crosshair" y1="18" y2="217"/><rect x="58" y="0" width="690" height="235" fill="transparent"/>';
    el.innerHTML = `<div class="legend">${lines.map((l, j) => `<span><i style="background:${l.color || colors[j]}"></i>${escape(l.label)}</span>`).join("")}<span>${escape(unit)}</span></div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(lines.map((l) => l.label).join(", "))} over time">${svg}</svg>`;
    const root = el.querySelector("svg");
    root.onpointermove = (e) => {
      const b = root.getBoundingClientRect();
      const pointerX = (e.clientX-b.left)/b.width*w;
      const i = data.reduce((best,_,index)=>Math.abs(x(index)-pointerX)<Math.abs(x(best)-pointerX)?index:best,0);
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
  }
  return { colors, valid, escape, number, time, tooltip, hide, chart };
})();
