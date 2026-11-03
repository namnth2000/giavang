// Price collectors and parsers. No dependencies, no assumed prices.
export const SOURCES = Object.freeze({
  sjc: {
    name: "Giavang.org - SJC Miền Bắc",
    url: "https://giavang.org/trong-nuoc/sjc/",
    officialUrl: "https://sjc.com.vn/gia-vang-online",
    region: "Miền Bắc (tham khảo Hà Nội)",
    unit: "VND/lượng",
    intervalHours: 1,
  },
  xau: {
    name: "Gold API",
    url: "https://gold-api.com/docs",
    endpoint: "https://api.gold-api.com/price/XAU",
    region: "Thế giới",
    unit: "USD/oz",
    intervalHours: 1,
  },
  fuel: {
    name: "WebGia.TV (theo Petrolimex)",
    url: "https://webgia.tv/xang-dau/petrolimex",
    officialUrl: "https://petrolimex.com.vn/ndi/gia-ban-le.html",
    region: "Petrolimex - Vùng 1 (Hà Nội)",
    unit: "VND/lít",
    intervalHours: 6,
  },
});

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function decode(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[lr]aquo;|&[lr]dquo;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function plain(html) {
  return normalize(decode(html.replace(/<[^>]*>/g, " ")));
}

export function extractRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) =>
      [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => plain(cell[1])),
    )
    .filter((cells) => cells.length > 0);
}

function valueFromCell(text, lower, upper) {
  // Values shown as "137.600" (thousand VND) or "137.600.000" (VND).
  // Take the first number so change indicators never become part of the price.
  const raw = text.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,12}/)?.[0];
  if (!raw) return null;
  const value = Number(raw.replace(/[.,]/g, ""));
  if (!Number.isFinite(value)) return null;
  if (value >= lower && value <= upper) return value;
  if (value * 1000 >= lower && value * 1000 <= upper) return value * 1000;
  return null;
}

function vietnamDate(date, time = "00:00") {
  const match = date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const clock = time?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match || !clock) return null;
  const [, dd, mm, yyyy] = match.map(Number);
  const hh = Number(clock[1]);
  const min = Number(clock[2]);
  const ss = clock[3] === undefined ? 0 : Number(clock[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || min > 59 || ss > 59) return null;
  const utc = Date.UTC(yyyy, mm - 1, dd, hh - 7, min, ss);
  const check = new Date(utc + 7 * 3600000);
  if (check.getUTCFullYear() !== yyyy || check.getUTCMonth() !== mm - 1 || check.getUTCDate() !== dd) return null;
  return new Date(utc).toISOString();
}

export function parseSjc(html) {
  const rows = extractRows(html);
  let region = "";
  let prices = null;
  for (const cells of rows) {
    const first = cells[0]?.toLocaleLowerCase("vi") ?? "";
    if (/^(miền bắc|hồ chí minh|hạ long|hải phòng|miền trung|huế|quảng ngãi|nha trang|biên hòa|miền tây|bạc liêu|cà mau)$/.test(first)) {
      region = first;
    }
    if (region !== "miền bắc") continue;
    const index = cells.findIndex((cell) => /vàng sjc\s*1l\s*,\s*10l\s*,\s*1kg/i.test(cell));
    if (index < 0) continue;
    const nums = cells.slice(index + 1).map((cell) => valueFromCell(cell, 50_000_000, 400_000_000)).filter((v) => v !== null);
    if (nums.length >= 2 && nums[0] <= nums[1]) {
      prices = { buy: nums[0], sell: nums[1] };
      break;
    }
  }
  if (!prices) throw new Error("Missing verified SJC Miền Bắc 1L row");
  const text = plain(html);
  const stamp = text.match(/Cập nhật lúc\s*:?\s*(\d{2}:\d{2}(?::\d{2})?)\s+(\d{2}\/\d{2}\/\d{4})/i);
  return { ...prices, quotedAt: stamp ? vietnamDate(stamp[2], stamp[1]) : null };
}

export function parseFuel(html) {
  const rows = extractRows(html);
  const row = rows.find((cells) => cells.some((cell) => /xăng\s*e10\s*ron\s*95\s*[-–]?\s*iii\b/i.test(cell)));
  if (!row) throw new Error("Missing E10 RON95-III row");
  const index = row.findIndex((cell) => /xăng\s*e10\s*ron\s*95\s*[-–]?\s*iii\b/i.test(cell));
  const price = row.slice(index + 1).map((cell) => valueFromCell(cell, 5_000, 100_000)).find((v) => v !== null);
  if (!price) throw new Error("Missing Petrolimex Vùng 1 price");
  const text = plain(html);
  // Use only an explicitly published effective date; an article check time is not a price date.
  const stamp = text.match(/Hiệu lực từ\s*(\d{2}\/\d{2}\/\d{4})(?:\s*(\d{2}:\d{2}))?/i);
  return { price, quotedAt: stamp ? vietnamDate(stamp[1], stamp[2] || "00:00") : null };
}

export function parseXau(json) {
  const price = Number(json?.price);
  if (json?.symbol && json.symbol !== "XAU") throw new Error("Gold API returned a different asset");
  if (!Number.isFinite(price) || price < 100 || price > 100_000) throw new Error("Invalid XAU/USD price");
  const raw = json.updatedAt || json.updated_at || null;
  const milliseconds = raw && Date.parse(raw);
  return {
    price,
    quotedAt: Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null,
  };
}

async function request(url, json = false) {
  const response = await fetch(url, {
    headers: { Accept: json ? "application/json" : "text/html,application/xhtml+xml", "User-Agent": "GiaVangTracker/1.0 (public price lookup)" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Upstream HTTP " + response.status);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("Upstream response too large");
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("Upstream response too large");
  return json ? JSON.parse(body) : body;
}

export async function fetchSjc() {
  return parseSjc(await request(SOURCES.sjc.url));
}

export async function fetchXau() {
  return parseXau(await request(SOURCES.xau.endpoint, true));
}

export async function fetchFuel() {
  return parseFuel(await request(SOURCES.fuel.url));
}
