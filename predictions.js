window.Predictions = (() => {
  const { number: n, escape: e, valid, chart } = UI;
  const cents = (v) => (valid(v) ? n(v * 100, 1) + "¢" : "—");
  const fee = (count, price, multiplier) =>
    Math.ceil((0.07 * multiplier * count * price * (1 - price) - 1e-10) * 100) /
    100;
  function render(view, data, { panel, plot, table }) {
    if (view !== "predictions") return false;
    const target = document.querySelector("#content"),
      k = data.predictions;
    if (!k) {
      target.innerHTML = panel(
        "ERCOT peak demand",
        '<div class="empty">Prediction-market data has not been collected yet. See Data health.</div>',
      );
      return true;
    }
    const days = [...new Set(k.active.map((m) => m.operating_day))];
    target.innerHTML =
      `<div class="controls"><label>Contract operating day <select id="kalshi-day">${days.map((d) => `<option>${e(d)}</option>`).join("")}</select></label><span class="subtle">Quotes captured ${e(Extensions.stamp(k.captured_at))} CT</span><a class="download" href="${e(k.source)}" target="_blank" rel="noopener">Kalshi market ↗</a></div><div id="prediction-quotes"></div>` +
      panel(
        "Settled daily peaks",
        table(
          [
            "Operating day",
            "Kalshi resolved peak · MW",
            "ERCOT day-ahead peak · MW",
            "Actual − forecast · MW",
            "Forecast captured before day?",
            "Contracts traded across strikes",
          ],
          k.settled_days.map((d) => [
            d.day,
            n(d.settled_peak, 2),
            n(d.day_ahead_peak, 2),
            valid(d.day_ahead_peak)
              ? n(d.settled_peak - d.day_ahead_peak, 2)
              : "—",
            d.captured_before_day === undefined
              ? "—"
              : d.captured_before_day
                ? "Yes"
                : "No · historical source vintage",
            n(d.volume),
          ]),
        ),
        "Actuals use the settlement report definition, not instantaneous peak readings",
      ) +
      panel(
        "Probability performance by capture hour",
        table(
          [
            "Capture hour · CT",
            "Resolved days",
            "Threshold samples",
            "Brier score ↓",
            "Mean bid–ask spread",
          ],
          k.performance.map((p) => [
            String(p.hour).padStart(2, "0") + ":00–:59",
            p.days,
            p.contracts,
            n(p.brier, 4),
            cents(p.spread),
          ]),
        ),
        "One quote per threshold/hour · related thresholds are correlated",
      ) +
      panel(
        "How to interpret this market",
        `<details><summary>Contract structure, liquidity and performance</summary><p>Each threshold is an independent Yes/No contract. A winning contract pays $1; buying Yes above 75,000 MW does not create a 75,000–75,500 MW range. Volume counts completed trades; order-book sizes show what can be traded at the displayed price now.</p><p>${e(k.methodology)}</p><p>There is no established optimal trading hour yet. Evaluate a defined strategy on prior days, then on new days it has not seen, with entry asks, exit bids, fees and available quantities. Brier scores measure probability calibration and do not measure trading profit. Forecast differences alone do not establish an edge.</p></details>`,
      );
    const redraw = () => {
      const day = document.querySelector("#kalshi-day").value,
        markets = k.active.filter((m) => m.operating_day === day),
        box = document.querySelector("#prediction-quotes");
      const forecast = k.forecast_peaks[day];
      const liquid = markets
        .filter(
          (m) =>
            m.yes_bid_size_fp > 0 &&
            m.yes_ask_size_fp > 0 &&
            m.yes_bid_dollars > 0 &&
            m.yes_ask_dollars < 1 &&
            m.yes_ask_dollars >= m.yes_bid_dollars &&
            m.yes_ask_dollars - m.yes_bid_dollars <= 0.15,
        )
        .map((m) => ({
          strike: m.floor_strike,
          p: (m.yes_bid_dollars + m.yes_ask_dollars) / 2,
        }));
      const coherent = liquid.every((m, i) => !i || m.p <= liquid[i - 1].p),
        lower = liquid.filter((m) => m.p >= 0.5).at(-1),
        upper = liquid.find((m) => m.p < 0.5);
      const crossing =
        coherent && lower && upper
          ? n(lower.strike) + "–" + n(upper.strike)
          : "Unavailable";
      box.innerHTML =
        `<div class="metrics"><div class="metric"><label>Market 50% threshold bracket</label><strong>${crossing}</strong><small>MW · two-sided quotes, spread ≤15¢; midpoints, not fills</small></div><div class="metric"><label>ERCOT day-ahead peak forecast</label><strong>${n(forecast?.day_ahead_peak)} <small>MW</small></strong><small>Pre-midnight source-issued forecast</small></div><div class="metric"><label>Active threshold markets</label><strong>${n(markets.length)}</strong><small>${n(liquid.length)} meet the quote filter</small></div><div class="metric"><label>Contracts traded across strikes</label><strong>${n(markets.reduce((sum, m) => sum + (m.volume_fp || 0), 0))}</strong><small>Includes repeated turnover; not available liquidity</small></div></div>` +
        panel(
          "Threshold quotes",
          table(
            [
              "Above · MW",
              "Yes bid / ask",
              "No bid / ask",
              "Yes spread",
              "Yes bid / ask size",
              "24h volume",
              "Total volume",
              "Open interest",
            ],
            markets.map((m) => [
              n(m.floor_strike),
              cents(m.yes_bid_dollars) + " / " + cents(m.yes_ask_dollars),
              cents(m.no_bid_dollars) + " / " + cents(m.no_ask_dollars),
              valid(m.yes_ask_dollars) && valid(m.yes_bid_dollars)
                ? cents(m.yes_ask_dollars - m.yes_bid_dollars)
                : "—",
              n(m.yes_bid_size_fp) + " / " + n(m.yes_ask_size_fp),
              n(m.volume_24h_fp),
              n(m.volume_fp),
              n(m.open_interest_fp),
            ]),
          ),
          "Sizes and volumes in contracts · zero size means the quote is not executable",
        ) +
        `<div class="grid">${panel("Quote trend", `<label>Threshold <select id="kalshi-strike">${markets.map((m) => `<option value="${e(m.ticker)}">Above ${n(m.floor_strike)} MW</option>`).join("")}</select></label>${plot("kalshi-trend")}`, "Captured bid and ask · gaps between observations are unknown")}${panel("Trade scenario", `<form id="kalshi-scenario"><div class="form-grid"><label>Side<select name="side"><option value="yes">Yes</option><option value="no">No</option></select></label><label>Contracts<input name="count" type="number" min="1" step="1" value="100" required></label><label>Your event probability · %<input name="probability" type="number" min="0" max="100" step=".1" placeholder="Optional estimate"></label><label>Hypothetical exit bid · ¢<input name="exit" type="number" min="1" max="99" step=".1" placeholder="Optional sale scenario"></label></div><div class="form-action"><button>Calculate</button><span class="subtle">${e(k.fee_type)} fees · multiplier ${n(k.fee_multiplier, 2)}</span></div></form><div id="kalshi-result"></div>`, "Paper calculations · available best-ask quantity only")}</div>` +
        panel(
          "ERCOT forecast and contract rules",
          `<p>Pre-midnight source forecast peak: <strong>${forecast ? n(forecast.day_ahead_peak) + " MW" : "Unavailable for this day"}</strong>.</p><details><summary>Settlement definition and source</summary><p>${e(markets[0]?.rules)}</p><p>${e(markets[0]?.resolution)}</p>${(k.resolution_sources || []).map((s) => `<a class="download" href="${e(s.url)}" target="_blank" rel="noopener">${e(s.name)} ↗</a>`).join("")}</details>`,
        );
      const pick = document.querySelector("#kalshi-strike");
      const relevant = markets.filter(
        (m) =>
          valid(m.yes_bid_dollars) &&
          valid(m.yes_ask_dollars) &&
          m.yes_ask_size_fp > 0,
      );
      if (relevant.length)
        pick.value = relevant.reduce((best, m) =>
          Math.abs((m.yes_ask_dollars + m.yes_bid_dollars) / 2 - 0.5) <
          Math.abs((best.yes_ask_dollars + best.yes_bid_dollars) / 2 - 0.5)
            ? m
            : best,
        ).ticker;
      const trend = () => {
        chart(
          "kalshi-trend",
          (k.history[pick.value] || []).map((r) => ({
            ...r,
            timestamp: Extensions.stamp(r.timestamp),
          })),
          [
            { key: "yes_bid_dollars", label: "Yes bid" },
            { key: "yes_ask_dollars", label: "Yes ask" },
          ],
          "%",
        );
        document.querySelector("#kalshi-result").textContent = "";
      };
      pick.onchange = trend;
      trend();
      document.querySelector("#kalshi-scenario").onsubmit = (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target)),
          m = markets.find((m) => m.ticker === pick.value),
          result = document.querySelector("#kalshi-result");
        const price = f.side === "yes" ? m?.yes_ask_dollars : m?.no_ask_dollars,
          size = f.side === "yes" ? m?.yes_ask_size_fp : m?.yes_bid_size_fp,
          count = +f.count;
        if (
          !m ||
          !valid(price) ||
          price <= 0 ||
          price >= 1 ||
          !size ||
          count > size
        ) {
          result.textContent = `Only ${n(size)} contracts are quoted at the best ask. Choose a smaller size; larger orders need full order-book depth to estimate slippage.`;
          return;
        }
        if (
          k.fee_type !== "quadratic" &&
          k.fee_type !== "quadratic_with_maker_fees"
        ) {
          result.textContent =
            "Fee type unavailable for this calculation. Check the Kalshi order preview.";
          return;
        }
        const entryFee = fee(count, price, k.fee_multiplier),
          cost = count * price + entryFee;
        let html = `<p>Entry at ${cents(price)} · estimated taker fee $${n(entryFee, 2)} · total $${n(cost, 2)}.</p><p>If this side wins: $${n(count - cost, 2)} net profit. If it loses: −$${n(cost, 2)}. Break-even probability for this side: ${n((cost / count) * 100, 2)}%.</p>`;
        if (f.probability !== "") {
          const p =
            f.side === "yes" ? +f.probability / 100 : 1 - +f.probability / 100;
          html += `<p>Expected settlement profit using your probability: $${n(p * count - cost, 2)}.</p>`;
        }
        if (f.exit !== "") {
          const exit = +f.exit / 100,
            exitFee = fee(count, exit, k.fee_multiplier);
          html += `<p>At hypothetical ${cents(exit)} sale: net $${n(count * exit - exitFee - cost, 2)} after both taker fees. This is a scenario, not an available exit quote.</p>`;
        }
        result.innerHTML =
          html +
          "<small>Fee estimate assumes whole-contract fills at one price; actual rounding and split fills can differ. Check the order preview.</small>";
      };
    };
    document.querySelector("#kalshi-day").onchange = redraw;
    if (days.includes(data.operatingDay))
      document.querySelector("#kalshi-day").value = data.operatingDay;
    redraw();
    return true;
  }
  return { render };
})();
