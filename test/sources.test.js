import test from "node:test";
import assert from "node:assert/strict";
import { parseSjc, parseFuel, parseXau } from "../src/sources.js";
import { shouldCollectFuel, updateSnapshot } from "../src/index.js";

test("SJC selects Miền Bắc, not Hồ Chí Minh or jewelry", () => {
  const html = `<div>Cập nhật lúc 12:45:03 03/11/2026</div><table>
  <tr><td>Hồ Chí Minh</td><td>Vàng SJC 1L, 10L, 1KG</td><td>138.600</td><td>141.600</td></tr>
  <tr><td>Miền Bắc</td><td>Vàng SJC 1L, 10L, 1KG</td><td>137.600</td><td>140.600</td></tr>
  <tr><td>Miền Trung</td><td>Vàng SJC 1L, 10L, 1KG</td><td>136.600</td><td>139.600</td></tr>
  </table>`;
  const price = parseSjc(html);
  assert.equal(price.buy, 137600000);
  assert.equal(price.sell, 140600000);
  assert.equal(price.quotedAt, "2026-11-03T05:45:03.000Z");
});

test("SJC refuses page missing the correct region", () => {
  assert.throws(() => parseSjc("<tr><td>Hồ Chí Minh</td><td>Vàng SJC 1L, 10L, 1KG</td><td>138.600</td><td>141.600</td></tr>"));
});

test("fuel selects III, Vùng 1, not V or change column", () => {
  const html = `<table>
    <tr><td>Xăng E10 RON 95-V</td><td>24.950</td><td>25.440</td></tr>
    <tr><td>Xăng E10 RON 95-III</td><td>24.150 ▼ 1.580</td><td>-1.580</td><td>24.630</td><td>31/10/2026</td></tr>
  </table><p>Hiệu lực từ 01/11/2026 00:00</p>`;
  assert.deepEqual(parseFuel(html), { price: 24150, quotedAt: "2026-10-31T17:00:00.000Z" });
});

test("reject invalid data, never invent prices", () => {
  assert.throws(() => parseFuel("<p>No fuel prices</p>"));
  assert.throws(() => parseXau({ price: -1 }));
  assert.throws(() => parseXau({ symbol: "XAG", price: 4000 }));
  assert.equal(parseXau({ symbol: "XAU", price: 4010.25, updatedAt: "2026-11-03T01:00:00Z" }).price, 4010.25);
});

test("fuel schedule uses UTC at 00, 06, 12, 18", () => {
  assert.equal(shouldCollectFuel("2026-11-03T00:00:00Z"), true);
  assert.equal(shouldCollectFuel("2026-11-03T01:00:00Z"), false);
  assert.equal(shouldCollectFuel("2026-11-03T18:00:00Z"), true);
});

test("partial source failures preserve last valid prices and flag error", async () => {
  const previous = {
    version: 1,
    prices: {
      sjc: { buy: 135000000, sell: 138000000, checkedAt: "2026-11-02T00:00:00Z" },
      fuel: { price: 24000, checkedAt: "2026-11-02T00:00:00Z" },
    },
  };
  const updated = await updateSnapshot(previous, "2026-11-03T01:00:00Z", {
    sjc: async () => { throw new Error("upstream down"); },
    xau: async () => ({ price: 4100, quotedAt: null }),
    fuel: async () => { throw new Error("should not fetch fuel"); },
  });
  assert.equal(updated.prices.sjc.buy, 135000000);
  assert.ok(updated.prices.sjc.error);
  assert.equal(updated.prices.xau.price, 4100);
  assert.equal(updated.prices.fuel.price, 24000);
  assert.equal(updated.prices.fuel.lastAttemptAt, undefined);
});
