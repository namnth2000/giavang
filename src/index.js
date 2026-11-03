import { SOURCES, fetchSjc, fetchXau, fetchFuel } from "./sources.js";

const STORE_KEY = "latest-prices-v1";
const COLLECTORS = { sjc: fetchSjc, xau: fetchXau, fuel: fetchFuel };
const LABELS = { sjc: "Vàng miếng SJC 1 lượng", xau: "Vàng thế giới XAU/USD", fuel: "Xăng E10 RON95-III" };

function emptyPrice(id) {
  return {
    id,
    label: LABELS[id],
    unit: SOURCES[id].unit,
    region: SOURCES[id].region,
    intervalHours: SOURCES[id].intervalHours,
    source: {
      name: SOURCES[id].name,
      url: SOURCES[id].url,
      officialUrl: SOURCES[id].officialUrl || null,
    },
    price: null,
    buy: null,
    sell: null,
    quotedAt: null,
    checkedAt: null,
    lastAttemptAt: null,
    error: null,
  };
}

function defaultSnapshot() {
  return {
    version: 1,
    generatedAt: null,
    prices: Object.fromEntries(Object.keys(COLLECTORS).map((id) => [id, emptyPrice(id)])),
  };
}

export function shouldCollectFuel(time) {
  return new Date(time).getUTCHours() % 6 === 0;
}

export async function updateSnapshot(previous, at, collectors = COLLECTORS) {
  const current = previous && previous.version === 1 && previous.prices ? previous : defaultSnapshot();
  const time = new Date(at).toISOString();
  const ids = ["sjc", "xau", ...(shouldCollectFuel(at) ? ["fuel"] : [])];
  const results = await Promise.allSettled(ids.map((id) => collectors[id]()));
  const prices = { ...current.prices };

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const original = { ...emptyPrice(id), ...(current.prices[id] || {}) };
    const outcome = results[i];
    if (outcome.status === "fulfilled") {
      prices[id] = {
        ...original,
        ...outcome.value,
        // Only update checkedAt after successfully parsing a valid quote.
        checkedAt: time,
        lastAttemptAt: time,
        error: null,
      };
    } else {
      prices[id] = {
        ...original,
        lastAttemptAt: time,
        error: "Không lấy được dữ liệu hợp lệ từ nguồn. Đang giữ giá trước đó nếu có.",
      };
      console.warn("Price collector failed:", id, String(outcome.reason));
    }
  }
  return { version: 1, generatedAt: time, prices };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/prices") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
      if (!env.PRICES) return json({ error: "Chưa cấu hình Cloudflare KV." }, 503);
      try {
        const saved = await env.PRICES.get(STORE_KEY, { type: "json" });
        const snapshot = saved && saved.version === 1 ? saved : defaultSnapshot();
        return request.method === "HEAD" ? new Response(null, { headers: { "cache-control": "public, max-age=60" } }) : json(snapshot);
      } catch (error) {
        console.error("KV read failed", error);
        return json({ error: "Không thể đọc dữ liệu giá." }, 503);
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    if (!env.PRICES) throw new Error("Missing PRICES KV binding");
    const saved = await env.PRICES.get(STORE_KEY, { type: "json" });
    const latest = await updateSnapshot(saved, controller.scheduledTime || Date.now());
    await env.PRICES.put(STORE_KEY, JSON.stringify(latest));
  },
};
