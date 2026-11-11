import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseSjc, parseFuel, parseXau } from "../src/sources.js";
import { normalizeSnapshot, updateSnapshot } from "../src/index.js";

test("official SJC online quote: exact bar row, full VND values", () => {
  const html = `<h1>Bảng giá vàng SJC</h1><p>Cập nhật lúc: 11:16 03/11/2026</p>
  <p>Đơn vị tính: VNĐ / lượng</p>
  <table><tr><th>Loại vàng</th><th>Mua</th><th>Bán</th></tr>
    <tr><td>Vàng SJC 1L, 10L, 1KG</td><td>137,600,000</td><td>140,600,000</td></tr>
    <tr><td>Vàng SJC 5 chỉ</td><td>137,600,000</td><td>140,620,000</td></tr>
    <tr><td>Vàng nhẫn SJC 99,99%</td><td>134,000,000</td><td>138,000,000</td></tr>
  </table>`;
  assert.deepEqual(parseSjc(html), {
    buy: 137600000, sell: 140600000, quotedAt: "2026-11-03T04:16:00.000Z",
  });
});

test("official SJC homepage fallback: grouped rows in thousand VND", () => {
  const html = `<p>08:36 03/11/2026 (ĐVT: ngàn đồng/ lượng)</p><table>
  <tr><td>Hồ Chí Minh</td></tr>
  <tr><td>Vàng SJC 1L, 10L, 1KG</td><td>138,200</td><td>141,200</td></tr>
  <tr><td>Vàng SJC 5 chỉ</td><td>138,200</td><td>141,220</td></tr>
  <tr><td>Miền Bắc</td></tr>
  <tr><td>Vàng SJC 1L, 10L, 1KG</td><td>138,200</td><td>141,200</td></tr>
  </table>`;
  assert.deepEqual(parseSjc(html), {
    buy: 138200000, sell: 141200000, quotedAt: "2026-11-03T01:36:00.000Z",
  });
});

test("official SJC parser rejects wrong products and ambiguous regional quotes", () => {
  assert.throws(() => parseSjc("<tr><td>Vàng nhẫn SJC 99,99%</td><td>130,000,000</td><td>140,000,000</td></tr>"));
  assert.throws(() => parseSjc(`<table>
  <tr><td>Vàng SJC 1L, 10L, 1KG</td><td>138,200</td><td>141,200</td></tr>
  <tr><td>Vàng SJC 1L, 10L, 1KG</td><td>139,200</td><td>142,200</td></tr>
  </table>`));
});

test("fuel selects V, Vùng 1, not III or change column", () => {
  const html = `<table>
    <tr><td>Xăng E10 RON 95-V</td><td>24.950</td><td>25.440</td></tr>
    <tr><td>Xăng E10 RON 95-III</td><td>24.150 ▼ 1.580</td><td>-1.580</td><td>24.630</td><td>31/10/2026</td></tr>
  </table><p>Hiệu lực từ 01/11/2026 00:00</p>`;
  assert.deepEqual(parseFuel(html), { price: 24950, quotedAt: "2026-10-31T17:00:00.000Z" });
});

test("reject invalid data, never invent prices", () => {
  assert.throws(() => parseFuel("<p>No fuel prices</p>"));
  assert.throws(() => parseXau({ price: -1 }));
  assert.throws(() => parseXau({ symbol: "XAG", price: 4000 }));
  assert.equal(parseXau({ symbol: "XAU", price: 4010.25, updatedAt: "2026-11-03T01:00:00Z" }).price, 4010.25);
});

test("partial source failures preserve last valid prices and flag error", async () => {
  const previous = {
    version: 1,
    prices: {
      sjc: { buy: 135000000, sell: 138000000, checkedAt: "2026-11-02T00:00:00Z", source: { url: SOURCES.sjc.url } },
      fuel: { price: 24000, label: "Xăng E10 RON 95-V", checkedAt: "2026-11-02T00:00:00Z" },
    },
  };
  const updated = await updateSnapshot(previous, "2026-11-03T01:00:00Z", {
    sjc: async () => { throw new Error("upstream down"); },
    xau: async () => ({ price: 4100, quotedAt: null }),
    fuel: async () => { throw new Error("fuel upstream down"); },
  });
  assert.equal(updated.prices.sjc.buy, 135000000);
  assert.ok(updated.prices.sjc.error);
  assert.equal(updated.prices.xau.price, 4100);
  assert.equal(updated.prices.fuel.price, 24000);
  assert.equal(updated.prices.fuel.checkedAt, previous.prices.fuel.checkedAt);
  assert.equal(updated.prices.fuel.lastAttemptAt, "2026-11-03T01:00:00.000Z");
  assert.ok(updated.prices.fuel.error);
});

test("legacy third-party SJC cache is discarded, not mislabeled official", () => {
  const snapshot = normalizeSnapshot({ version: 1, generatedAt: "2026-11-03T00:00:00Z", prices: {
    sjc: { buy: 135000000, sell: 138000000, source: { url: "https://giavang.org/trong-nuoc/sjc/" } },
  } });
  assert.equal(snapshot.prices.sjc.buy, null);
  assert.equal(snapshot.prices.sjc.sell, null);
  assert.equal(snapshot.prices.sjc.source.url, SOURCES.sjc.url);
  assert.equal(snapshot.prices.sjc.region, "Việt Nam");
});

test("SJC official homepage with div/span text instead of table rows", () => {
  const html = `<div>16:45 03/11/2026 (ĐVT: ngàn đồng/ lượng)</div>
  <section><strong>Hồ Chí Minh</strong>
  <div class="item"><span>Vàng SJC 1L, 10L, 1KG</span><span>137,600</span><span>140,600</span></div>
  <div class="item"><span>Vàng SJC 5 chỉ</span><span>137,600</span><span>140,620</span></div>
  <strong>Miền Bắc</strong>
  <div class="item"><span>Vàng SJC 1L, 10L, 1KG</span><span>137,600</span><span>140,600</span></div>
  </section>`;
  assert.deepEqual(parseSjc(html), {
    buy: 137600000, sell: 140600000, quotedAt: "2026-11-03T09:45:00.000Z",
  });
});

test("SJC flat parser rejects missing quote, mismatched regions or script sample", () => {
  assert.throws(() => parseSjc(`<div>Vàng SJC 1L, 10L, 1KG</div>
    <div>Vàng SJC 5 chỉ 137,600 140,620</div>`));
  assert.throws(() => parseSjc(`<div>Vàng SJC 1L, 10L, 1KG 137,600 140,600</div>
    <div>Vàng SJC 1L, 10L, 1KG 139,600 142,600</div>`));
  assert.throws(() => parseSjc(`<script>var demo = "Vàng SJC 1L, 10L, 1KG 137,600 140,600";</script>`));
});
