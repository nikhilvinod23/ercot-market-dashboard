const test = require("node:test");
const assert = require("node:assert/strict");
const { batteryOptimize, paperPnl } = require("./analytics");
const { numberOrNull, reportRows } = require("./market-data");
test("missing readings remain missing", () => {
  for (const v of [null, undefined, "", "unavailable"])
    assert.equal(numberOrNull(v), null);
  assert.equal(numberOrNull(0), 0);
});
test("report column mapping", () =>
  assert.deepEqual(reportRows({ fields: [{ name: "price" }], data: [[42]] }), [
    { price: 42 },
  ]));
test("battery power, SOC, cash and terminal constraints", () => {
  const r = batteryOptimize(
    [10, 10, 100, 100].map((price) => ({ price, hours: 0.25 })),
    { power: 100, energy: 100, efficiency: 0.81, initial: 50, degradation: 5 },
  );
  assert.ok(r.profit > 0);
  let energy = 50;
  for (const row of r.schedule) {
    assert.ok(Math.abs(row.mw) <= 100 + 1e-7);
    energy += row.energy > 0 ? row.energy * 0.9 : row.energy / 0.9;
    assert.ok(energy >= -1e-7 && energy <= 100 + 1e-7);
    assert.ok(Math.abs(energy - row.soc) < 1e-7);
  }
  assert.ok(Math.abs(energy - 50) < 1e-7);
  assert.ok(
    Math.abs(r.schedule.reduce((s, r) => s + r.cash, 0) - r.profit) < 1e-7,
  );
});
test("flat prices cannot create profit", () =>
  assert.equal(
    batteryOptimize(Array(8).fill({ price: 50, hours: 0.25 }), {
      power: 100,
      energy: 200,
      efficiency: 0.9,
    }).profit,
    0,
  ));
test("invalid inputs rejected", () =>
  assert.throws(() =>
    batteryOptimize([], { power: 0, energy: 100, efficiency: 0.9 }),
  ));
test("paper P&L sides and interval units", () => {
  assert.equal(paperPnl({ side: "buy", mw: 10, rt: 50, dam: 30, fee: 2 }), 45);
  assert.equal(
    paperPnl({ side: "sell", mw: 10, rt: 50, dam: 30, fee: 2 }),
    -55,
  );
});
