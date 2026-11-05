# Giá Hôm Nay

Bảng giá tối giản theo dõi đúng 3 sản phẩm:

- **Vàng miếng SJC 1L, 10L, 1KG**: bảng giá công bố chính thức của SJC, đơn vị VND/lượng; mua và bán.
- **Vàng thế giới XAU/USD**: giá giao ngay USD/oz.
- **Xăng E10 RON95-III**: giá bán lẻ **Petrolimex Vùng 1** tại Hà Nội, đơn vị VND/lít.

Không có đăng nhập, biểu đồ, lịch sử, quảng cáo, React hay database SQL. Giao diện viết bằng HTML/CSS/JavaScript thuần; một Cloudflare Worker phục vụ API và assets; một KV namespace lưu snapshot.

## Nguồn và độ tin cậy

| Mặt hàng | Nguồn được máy đọc | Link đối chiếu |
| --- | --- | --- |
| SJC | [SJC - Giá Vàng Online](https://sjc.com.vn/gia-vang-online), lấy đúng dòng **Vàng SJC 1L, 10L, 1KG** | [Trang chính thức SJC](https://sjc.com.vn/) (dự phòng) |
| XAU/USD | [Gold API](https://gold-api.com/docs), endpoint `/price/XAU` | Gold API |
| Xăng | [WebGia.TV - Petrolimex](https://webgia.tv/xang-dau/petrolimex), lấy **đúng E10 RON 95-III / Vùng 1** | [Petrolimex chính thức](https://petrolimex.com.vn/ndi/gia-ban-le.html) |

**Quan trọng:** Không chọn giá SJC theo tỉnh/thành. Bộ thu thập lần lượt thử `sjc.com.vn/gia-vang-online`, `www.sjc.com.vn/gia-vang-online` và hai trang chủ SJC chính thức. Parser hỗ trợ cả bảng `tr/td` và dòng giá dạng `div/span`; khi không có giá sẽ báo lỗi thay vì lấy số ở sản phẩm kế tiếp. Chỉ sử dụng các dòng vàng miếng 1L khớp nhau khi trang chủ có nhiều khu vực; nếu khác nhau sẽ báo lỗi thay vì tự nhận là giá chung. Giá xăng Vùng 1 là mức Petrolimex công bố, không đảm bảo áp dụng tại mọi cửa hàng độc lập.

SJC được lấy trực tiếp từ website chính thức (HTML, không phải API công khai được bảo đảm); giá xăng vẫn dùng website tổng hợp bên thứ ba. HTML có thể thay đổi, chặn bot, tải bằng JavaScript hoặc có điều khoản hạn chế tái sử dụng. Cần kiểm tra điều khoản và chất lượng nguồn trước khi vận hành công khai. Không cung cấp giá giả hoặc tự suy luận từ loại sản phẩm khác. Khi parser lỗi, giữ lần ghi hợp lệ trước và gắn cảnh báo. Khi đổi từ nguồn SJC cũ sang nguồn chính thức, hệ thống **xóa giá SJC đã cache từ nguồn bên thứ ba** để không gắn nhãn sai nguồn.

## Lịch cập nhật

Một Cron Trigger `*/15 * * * *` chạy mỗi 15 phút, tại phút 00, 15, 30, 45 của mỗi giờ (theo UTC):

- Mỗi lần Cron chạy đều lấy cả 3 giá: SJC, XAU/USD và xăng E10 RON95-III, không có lịch riêng cho xăng.
- Mỗi chu kỳ chỉ ghi **một** snapshot JSON vào KV.
- `quotedAt` là thời điểm nguồn niêm yết (nếu công khai); `checkedAt` là thời điểm hệ thống lấy **thành công**. Không đồng nhất hai mốc này.
- Nếu thất bại một nguồn, không ghi đè giá đã xác thực. Website thông báo giá cũ.
- Nút **Tải lại** và làm mới 5 phút/lần chỉ tải snapshot KV, **không** ép request đến website nguồn.

## Chạy và triển khai

Yêu cầu Node.js >= 20 và tài khoản Cloudflare.

1. `npm install`
2. Tạo namespace: `npx wrangler kv namespace create PRICES`.
3. Lấy ID từ kết quả và thay `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` trong `wrangler.jsonc`.
4. Chạy `npm test` để thử parser và lịch thu thập.
5. Chạy `npm run dev` rồi mở `http://localhost:8787`.
6. Khởi tạo dữ liệu ở môi trường local bằng `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=%2A%2F15%20%2A%20%2A%20%2A%20%2A"`. Lúc này chỉ có giá khi nguồn cho phép truy cập từ Worker.
7. Đăng nhập Cloudflare nếu cần với `npx wrangler login` và chạy `npm run deploy`.

Sau khi deploy, lần Cron đầu tiên mới thu thập snapshot production, nên trang có thể báo "Chờ lần thu thập đầu tiên". Kiểm tra trang và endpoint `/api/prices` sau một kỳ chạy. Cron có thể không chạy đúng phút tuyệt đối.

**Không commit API token hay file `.dev.vars`.** ID namespace KV là cấu hình, không phải bí mật, nhưng phải trỏ đúng namespace trên Cloudflare. Hệ thống chưa tự triển khai chỉ từ việc push mã nguồn lên GitHub.

## Cấu trúc

```text
public/              # Giao diện tĩnh, favicon, manifest
src/index.js          # API /api/prices, cron và KV snapshot
src/sources.js        # Lấy và kiểm tra đúng sản phẩm, vùng giá
test/sources.test.js  # Parser và kiểm thử nguồn lỗi
wrangler.jsonc        # Worker, KV binding và cron
```

## Kiểm tra vận hành

- Nếu XAU không hiện: kiểm tra endpoint Gold API hoặc response shape.
- Nếu SJC hiển thị giá cũ: xem mốc **Đối chiếu** (lần lấy thành công) và **Niêm yết** (mốc SJC công bố). Nếu có **Lần kiểm tra mới lỗi**, Worker chưa lấy được giá mới và vẫn giữ giá đã xác thực. Bấm Tải lại chỉ đọc KV, không gọi trực tiếp SJC.
- Nếu SJC không hiện: kiểm tra `wrangler tail` và HTML thực tế trả về từ [giá vàng SJC](https://sjc.com.vn/gia-vang-online) hay trang chủ. Nếu cả các trang chính thức đều trả HTML trống hoặc chặn Worker, không thể bảo đảm cập nhật tự động bằng scraping và cần dùng API được SJC cấp phép hoặc một nguồn dữ liệu được chấp thuận khác.
- Nếu xăng không hiện: xác nhận bảng HTML có dòng `Xăng E10 RON 95-III` và Vùng 1 ở cột đầu.
- Nếu cả ba không hiện: kiểm tra KV binding, Cron Triggers và Worker logs.
- Nếu giá không đổi: kiểm tra **niêm yết** so với **lần kiểm tra thành công**; nguồn có thể giữ nguyên giá ngoài giờ/kỳ điều hành.

Dữ liệu tham khảo, không phải tư vấn đầu tư hay báo giá để đặt lệnh.

## Biểu tượng iPhone và Android

- Favicon trình duyệt dùng SVG `public/favicon.svg`.
- iOS Add to Home Screen dùng PNG `public/apple-touch-icon.png` kích thước **180x180**, nền kín, không bo góc trong ảnh vì iOS tự xử lý.
- Manifest PWA dùng PNG `icon-192.png` và `icon-512.png` để tránh phụ thuộc hỗ trợ SVG của launcher.
- Sau khi deploy bản mới, **xóa shortcut cũ trên màn hình chính rồi thêm lại từ Safari**. iOS có thể giữ icon cũ trong cache dù nội dung web đã cập nhật.
