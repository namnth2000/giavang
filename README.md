# Giá Hôm Nay

Bảng giá tối giản theo dõi đúng 3 sản phẩm:

- **Vàng miếng SJC 1L, 10L, 1KG**: giá **SJC Miền Bắc** để tham khảo tại Hà Nội, đơn vị VND/lượng; mua và bán.
- **Vàng thế giới XAU/USD**: giá giao ngay USD/oz.
- **Xăng E10 RON95-III**: giá bán lẻ **Petrolimex Vùng 1** tại Hà Nội, đơn vị VND/lít.

Không có đăng nhập, biểu đồ, lịch sử, quảng cáo, React hay database SQL. Giao diện viết bằng HTML/CSS/JavaScript thuần; một Cloudflare Worker phục vụ API và assets; một KV namespace lưu snapshot.

## Nguồn và độ tin cậy

| Mặt hàng | Nguồn được máy đọc | Link đối chiếu |
| --- | --- | --- |
| SJC | [Giavang.org - trang SJC](https://giavang.org/trong-nuoc/sjc/), lấy **đúng dòng Miền Bắc / Vàng SJC 1L, 10L, 1KG** | [SJC chính thức](https://sjc.com.vn/gia-vang-online) |
| XAU/USD | [Gold API](https://gold-api.com/docs), endpoint `/price/XAU` | Gold API |
| Xăng | [WebGia.TV - Petrolimex](https://webgia.tv/xang-dau/petrolimex), lấy **đúng E10 RON 95-III / Vùng 1** | [Petrolimex chính thức](https://petrolimex.com.vn/ndi/gia-ban-le.html) |

**Quan trọng:** Website SJC công khai có thể không tách giá thành phố. Dòng `Miền Bắc` của bên tổng hợp là **giá tham khảo cho Hà Nội**, không phải một bảng giá riêng của từng cửa hàng Hà Nội. Tương tự, giá xăng Vùng 1 là mức Petrolimex công bố, không đảm bảo áp dụng tại mọi cửa hàng độc lập.

Hai nguồn Việt Nam là các website bên thứ ba, **không phải API chính thức**. HTML có thể thay đổi, chặn bot hoặc có điều khoản hạn chế tái sử dụng. Cần kiểm tra điều khoản và chất lượng nguồn trước khi vận hành công khai. Không cung cấp giá giả hoặc tự suy luận từ loại sản phẩm khác. Khi parser lỗi, giữ lần ghi hợp lệ trước và gắn cảnh báo.

## Lịch cập nhật

Một Cron Trigger `0 * * * *` chạy mỗi giờ (theo UTC):

- SJC và XAU/USD: mỗi 1 giờ.
- Xăng: tại 00, 06, 12, 18 UTC, tức **07:00, 13:00, 19:00, 01:00** giờ Việt Nam.
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
6. Khởi tạo dữ liệu ở môi trường local bằng `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+*+*+*+*"`. Lúc này chỉ có giá khi nguồn cho phép truy cập từ Worker.
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
- Nếu SJC không hiện: xác nhận trang vẫn chứa dòng `Miền Bắc` và `Vàng SJC 1L, 10L, 1KG`.
- Nếu xăng không hiện: xác nhận bảng HTML có dòng `Xăng E10 RON 95-III` và Vùng 1 ở cột đầu.
- Nếu cả ba không hiện: kiểm tra KV binding, Cron Triggers và Worker logs.
- Nếu giá không đổi: kiểm tra **niêm yết** so với **lần kiểm tra thành công**; nguồn có thể giữ nguyên giá ngoài giờ/kỳ điều hành.

Dữ liệu tham khảo, không phải tư vấn đầu tư hay báo giá để đặt lệnh.
