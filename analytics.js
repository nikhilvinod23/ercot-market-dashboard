(function (root) {
  function batteryOptimize(
    prices,
    { power, energy, efficiency, initial = 50, degradation = 0 },
  ) {
    if (
      !(
        power > 0 &&
        energy > 0 &&
        efficiency > 0 &&
        efficiency <= 1 &&
        initial >= 0 &&
        initial <= 100 &&
        degradation >= 0
      )
    )
      throw new Error(
        "Enter valid power, energy, efficiency, state of charge and cost.",
      );
    const steps = 40,
      unit = energy / steps,
      eta = Math.sqrt(efficiency),
      start = Math.round((initial / 100) * steps),
      dp = Array(steps + 1).fill(-Infinity);
    dp[start] = 0;
    const history = [];
    let lastDp = dp;
    for (const item of prices) {
      const dt = item.hours || 0.25;
      const next = Array(steps + 1).fill(-Infinity),
        back = Array(steps + 1).fill(null);
      for (let s = 0; s <= steps; s++) {
        if (!Number.isFinite(lastDp[s])) continue;
        for (let t = 0; t <= steps; t++) {
          const delta = (t - s) * unit,
            grid = delta > 0 ? delta / eta : delta * eta;
          if (Math.abs(grid) > power * dt + 1e-7) continue;
          const gain =
            -grid * item.price - degradation * (delta < 0 ? -grid : 0);
          if (lastDp[s] + gain > next[t]) {
            next[t] = lastDp[s] + gain;
            back[t] = { from: s, grid, cash: gain };
          }
        }
      }
      history.push(back);
      lastDp = next;
    }
    let s = start,
      schedule = [];
    for (let i = prices.length - 1; i >= 0; i--) {
      const p = history[i][s];
      if (!p) throw new Error("No feasible dispatch.");
      schedule.push({
        ...prices[i],
        mw: -p.grid / (prices[i].hours || 0.25),
        soc: (s / steps) * 100,
        cash: p.cash,
        energy: p.grid,
      });
      s = p.from;
    }
    schedule.reverse();
    return {
      profit: lastDp[start],
      schedule,
      discharged: schedule.reduce((v, r) => v + Math.max(0, -r.energy), 0),
      charged: schedule.reduce((v, r) => v + Math.max(0, r.energy), 0),
      cycles: schedule.reduce((v, r) => v + Math.max(0, -r.energy), 0) / energy,
      initialSoc: (start / steps) * 100,
    };
  }
  const paperPnl = ({ side, mw, rt, dam, hours = 0.25, fee = 0 }) =>
    (side === "buy" ? 1 : -1) * (rt - dam) * mw * hours - fee * mw * hours;
  const api = { batteryOptimize, paperPnl };
  if (typeof module !== "undefined") module.exports = api;
  else root.Analytics = api;
})(typeof window !== "undefined" ? window : globalThis);
