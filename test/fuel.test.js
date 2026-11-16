import test from "node:test";
import assert from "node:assert/strict";
import worker, { normalizeSnapshot, updateSnapshot } from "../src/index.js";
import { parseFuel, parseFuelIII, fetchFuelIII, SOURCES } from "../src/sources.js";

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
  const collectors = { sjc: async () => ({}), xau: async () => ({}), fuelIII: async () => ({}), fuel: async () => { throw new Error("Unavailable"); } };
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

test("III reads its own Vung 1 price and rejects V, wrong blends and missing prices", () => {
  assert.deepEqual(parseFuelIII(table), { price: 21150, quotedAt: "2026-11-05T08:00:00.000Z" });
  for (const product of ["Xăng E10 RON 95-V", "Xăng E10 RON 95-IIIA", "Xăng E5 RON 95-III"]) {
    assert.throws(() => parseFuelIII(table.replace("Xăng E10 RON 95-III</td>", product + "</td>")), /Missing E10 RON 95-III/);
  }
  assert.throws(() => parseFuelIII(table.replace("21.150", "--")), /Vùng 1/);
});

test("III collector reads the configured Petrolimex source", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, SOURCES.fuelIII.url);
    return new Response(table);
  });
  assert.equal((await fetchFuelIII()).price, 21150);
  assert.equal(mock.mock.callCount(), 1);
});

test("adding III preserves V cache and never relabels another product as III", () => {
  const previous = { version: 1, prices: { fuel: { label, price: 22650 } } };
  const snapshot = normalizeSnapshot(previous);
  assert.equal(snapshot.prices.fuel.price, 22650);
  assert.equal(snapshot.prices.fuelIII.price, null);
  assert.equal(snapshot.prices.fuelIII.label, "Xăng E10 RON 95-III");
  for (const wrongLabel of [label, undefined]) {
    assert.equal(normalizeSnapshot({ version: 1, prices: { fuelIII: { label: wrongLabel, price: 22650 } } }).prices.fuelIII.price, null);
  }
});

test("III and V retain their own last quote when either source fails", async (t) => {
  t.mock.method(console, "warn", () => {});
  const collectors = { sjc: async () => ({}), xau: async () => ({}), fuelIII: async () => parseFuelIII(table), fuel: async () => parseFuel(table) };
  const previous = await updateSnapshot(null, "2026-11-16T00:00:00Z", collectors);
  for (const id of ["fuelIII", "fuel"]) {
    const other = id === "fuelIII" ? "fuel" : "fuelIII";
    const failed = await updateSnapshot(previous, "2026-11-16T00:15:00Z", { ...collectors, [id]: async () => { throw new Error("Unavailable"); } });
    assert.equal(failed.prices[id].price, previous.prices[id].price);
    assert.equal(failed.prices[id].checkedAt, previous.prices[id].checkedAt);
    assert.ok(failed.prices[id].error);
    assert.equal(failed.prices[other].error, null);
    assert.equal(failed.prices[other].checkedAt, "2026-11-16T00:15:00.000Z");
    const recovered = await updateSnapshot(failed, "2026-11-16T00:30:00Z", collectors);
    assert.equal(recovered.prices[id].error, null);
  }
});
