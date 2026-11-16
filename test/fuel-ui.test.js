import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("III appears before V and both cards render independent API prices", async () => {
  assert.ok(html.indexOf('id="fuelIII-title"') < html.indexOf('id="fuel-title"'));
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const nodes = Object.fromEntries(ids.map((id) => [id, {
    textContent: "", classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
  }]));
  const snapshot = { version: 1, prices: {
    fuelIII: { price: 21150 }, fuel: { price: 22650 },
  } };
  const context = vm.createContext({
    document: {
      getElementById(id) { assert.ok(nodes[id], "Missing DOM element: " + id); return nodes[id]; },
      addEventListener() {}, visibilityState: "visible",
    },
    Intl, Date, Number, Boolean, Object, Array, AbortSignal, console, setInterval() {},
    fetch: async () => ({ ok: true, json: async () => snapshot }),
  });
  vm.runInContext(app, context);
  await new Promise(setImmediate);
  assert.equal(nodes["fuelIII-price"].textContent, "21.150");
  assert.equal(nodes["fuel-price"].textContent, "22.650");
  snapshot.prices.fuelIII = {};
  context.snapshot = snapshot;
  vm.runInContext("render(snapshot)", context);
  assert.equal(nodes["fuelIII-price"].textContent, "--");
  assert.equal(nodes["fuel-price"].textContent, "22.650");
});
