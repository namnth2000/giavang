import test from "node:test";
import assert from "node:assert/strict";
import worker, { normalizeSnapshot, updateSnapshot } from "../src/index.js";
import { parseFuel } from "../src/sources.js";

const label = "Xăng E10 RON 95-V";
const table = `<table>
  <tr><th>Mặt hàng</th><th>Vùng 1</th><th>+/- Vùng 1</th><th>Vùng 2</th></tr>
  <tr><td>Xăng E10 RON 95-III</td><td>21.150</td><td>2.080</td><td>21.570</td></tr>
  <tr><td>Xăng E10 RON 95-V</td><td>22.650</td><td>1.580</td><td>23.100</td></tr>
</table><p>Hiệu lực từ 05/11/2026 15:00</p>`;

test("fuel reads the exact V product and Vùng 1 even when III appears first", () => {
  assert.deepEqual(parseFuel(table), { price: 22650, quotedAt: "2026-11-05T08:00:00.000Z" });
  for (const product of ["Xăng E10 RON 95-III", "Xăng E10 RON 95-VI", "Xăng E5 RON 95-V", "Xăng E10 RON 95-V extra"]) {
    assert.throws(() => parseFuel(table.replace("Xăng E10 RON 95-V</td>", product + "</td>")), /Missing E10 RON 95-V/);
  }
  // Missing Vùng 1 must never fall through to a change value or Vùng 2.
  assert.throws(() => parseFuel(table.replace("22.650", "--")), /Vùng 1/);
});

test("the API discards III and unidentified cached prices before relabeling", async () => {
  for (const oldLabel of ["Xăng E10 RON95-III", "Xăng E10 RON 95-III", undefined]) {
    const saved = { version: 1, prices: { fuel: { label: oldLabel, price: 21150, checkedAt: "2026-11-11T00:00:00Z" }, xau: { price: 4000 } } };
    const env = { PRICES: { async get() { return saved; } } };
    const response = await worker.fetch(new Request("https://example.test/api/prices"), env);
    const snapshot = await response.json();
    assert.equal(snapshot.prices.fuel.label, label);
    assert.equal(snapshot.prices.fuel.price, null);
    assert.equal(snapshot.prices.fuel.checkedAt, null);
    assert.equal(snapshot.prices.xau.price, 4000);
  }
});

test("V cache survives a source failure and is refreshed on recovery", async (t) => {
  t.mock.method(console, "warn", () => {});
  const previous = { version: 1, prices: { fuel: { label, price: 22650, checkedAt: "2026-11-11T00:00:00Z" } } };
  assert.equal(normalizeSnapshot(previous).prices.fuel.price, 22650);
  const collectors = { sjc: async () => ({}), xau: async () => ({}), fuel: async () => { throw new Error("Unavailable"); } };
  const failed = await updateSnapshot(previous, "2026-11-11T00:15:00Z", collectors);
  assert.equal(failed.prices.fuel.price, 22650);
  assert.equal(failed.prices.fuel.checkedAt, previous.prices.fuel.checkedAt);
  assert.ok(failed.prices.fuel.error);
  const recovered = await updateSnapshot(failed, "2026-11-11T00:30:00Z", { ...collectors, fuel: async () => parseFuel(table) });
  assert.equal(recovered.prices.fuel.label, label);
  assert.equal(recovered.prices.fuel.price, 22650);
  assert.equal(recovered.prices.fuel.error, null);
  assert.equal(recovered.prices.fuel.checkedAt, "2026-11-11T00:30:00.000Z");
});
