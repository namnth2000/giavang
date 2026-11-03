const byId = (id) => document.getElementById(id);
const nfVnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const nfUsd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFull = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
});
const dateShort = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
});

function money(number, type = "vnd") {
  return Number.isFinite(number) && number > 0 ? (type === "usd" ? nfUsd.format(number) : nfVnd.format(number)) : "--";
}

function when(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return dateShort.format(new Date(value));
}

function setStatus(id, item) {
  const node = byId(id + "-status");
  const time = byId(id + "-time");
  const age = item?.checkedAt ? Date.now() - Date.parse(item.checkedAt) : Infinity;
  const late = Number.isFinite(age) && age > (item?.intervalHours || (id === "fuel" ? 6 : 1)) * 3 * 3600000;
  const missing = !item?.checkedAt;
  node.classList.toggle("status-warning", Boolean(item?.error || late || missing));

  if (missing) node.textContent = item?.error ? "Nguồn chưa có dữ liệu" : "Chờ lần thu thập đầu tiên";
  else if (item?.error) node.textContent = "Nguồn lỗi - đang hiển thị giá cũ";
  else if (late) node.textContent = "Dữ liệu chậm cập nhật";
  else node.textContent = "Đã kiểm tra nguồn";

  const checked = when(item?.checkedAt);
  const quoted = when(item?.quotedAt);
  time.textContent = [checked ? "Kiểm tra: " + checked : "Chưa kiểm tra thành công", quoted ? "Niêm yết: " + quoted : null].filter(Boolean).join(" | ");

  const link = byId(id + "-source");
  if (item?.source?.url && /^https:\/\//.test(item.source.url)) {
    link.href = item.source.url;
  }
}

function render(data) {
  const items = data?.prices || {};
  const sjc = items.sjc || {};
  const xau = items.xau || {};
  const fuel = items.fuel || {};
  byId("sjc-buy").textContent = money(sjc.buy);
  byId("sjc-sell").textContent = money(sjc.sell);
  byId("sjc-spread").textContent = Number.isFinite(sjc.buy) && Number.isFinite(sjc.sell) && sjc.sell >= sjc.buy
    ? nfVnd.format(sjc.sell - sjc.buy) + " đ" : "--";
  byId("xau-price").textContent = money(xau.price, "usd");
  byId("fuel-price").textContent = money(fuel.price);

  for (const [id, item] of Object.entries({ sjc, xau, fuel })) setStatus(id, item);

  const available = [
    Number.isFinite(sjc.buy) && Number.isFinite(sjc.sell),
    Number.isFinite(xau.price),
    Number.isFinite(fuel.price),
  ].filter(Boolean).length;
  const failed = [sjc, xau, fuel].filter((item) => item.error).length;
  const notice = byId("page-status");
  notice.classList.toggle("error", available === 0);
  notice.classList.toggle("warning", available > 0 && failed > 0);
  byId("page-status-text").textContent = available === 0
    ? "Chưa có dữ liệu. Hệ thống sẽ ghi nhận giá sau lần chạy thu thập đầu tiên."
    : failed
      ? available + "/3 mức giá có dữ liệu. Một số nguồn đang lỗi; giá cũ được giữ lại và ghi rõ thời gian."
      : available < 3
        ? available + "/3 mức giá đã có dữ liệu. Các mức còn lại đang chờ cập nhật."
        : "Đang hiển thị 3 mức giá đã thu thập. Nhấn Tải lại để kiểm tra dữ liệu mới trên website.";
}

let loading = false;
async function loadPrices() {
  if (loading) return;
  loading = true;
  const button = byId("refresh");
  button.disabled = true;
  button.classList.add("loading");
  try {
    const response = await fetch("/api/prices", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if (!result || result.version !== 1 || !result.prices) throw new Error("Invalid payload");
    render(result);
  } catch (error) {
    const notice = byId("page-status");
    notice.classList.remove("warning");
    notice.classList.add("error");
    byId("page-status-text").textContent = "Không thể tải bảng giá. Kiểm tra kết nối mạng hoặc thử lại sau.";
    console.warn("Price request failed", error);
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
    loading = false;
  }
}

byId("today-date").textContent = dateFull.format(new Date());
byId("refresh").addEventListener("click", loadPrices);
loadPrices();
// This refreshes the cached snapshot, not upstream sources or the scheduled collector.
setInterval(() => { if (document.visibilityState === "visible") loadPrices(); }, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadPrices();
});
