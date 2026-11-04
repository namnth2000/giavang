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
  const quoteAge = item?.quotedAt ? Date.now() - Date.parse(item.quotedAt) : null;
  const oldPublication = quoteAge !== null && Number.isFinite(quoteAge) && quoteAge > 24 * 3600000;
  node.classList.toggle("status-warning", Boolean(item?.error || late || missing || oldPublication));

  if (missing) node.textContent = item?.error ? "Chưa lấy được giá từ nguồn" : "Chờ lần thu thập đầu tiên";
  else if (item?.error) node.textContent = "Lần kiểm tra mới lỗi - giữ giá đã xác thực";
  else if (late) node.textContent = "Đã lâu chưa kiểm tra thành công";
  else if (oldPublication) node.textContent = "Nguồn chưa công bố giá mới";
  else node.textContent = "Đã đối chiếu với nguồn";

  const checked = when(item?.checkedAt);
  const quoted = when(item?.quotedAt);
  const attempted = item?.error && when(item?.lastAttemptAt);
  time.textContent = [
    checked ? "Đối chiếu: " + checked : "Chưa kiểm tra thành công",
    quoted ? "Niêm yết: " + quoted : null,
    attempted ? "Lỗi lúc: " + attempted : null,
  ].filter(Boolean).join(" | ");

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
        : "Đã tải 3 mức giá đã kiểm tra. Giá chỉ thay đổi khi nguồn công bố mức mới.";
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
