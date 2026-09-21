# Khuôn chụp thời trang — cách dùng

Workflow trong Node Studio: **Idol Kpop - mau + trang phuc → cac canh quan ca phe**
Mã phiên: `s_01M30YY0XJEEVYEPGKD0GCN34E`

Khuôn có hai nhánh trang phục chạy song song, dùng chung một người mẫu:

| Nhánh | Hậu tố lệnh | Gồm |
|---|---|---|
| A | `thu` | 1 node trang phục + 1 node mặc đồ + 9 cảnh |
| B | `hong` | 1 node trang phục + 1 node mặc đồ + 3 cảnh |

---

## Làm một bộ đồ mới

### Bước 1 — trên giao diện: đưa ảnh chụp thật vào

Mở node **TRANG PHUC A** (hoặc **B**) → bấm **Attach** → chọn 1–3 ảnh chụp thật
của bộ đồ (ảnh người mẫu shop chụp cũng được) → bấm **GEN**.

Node sẽ trả về ảnh *flat lay* nền trắng, từng món tách riêng.

Prompt ở node này **không gọi tên món đồ nào**, nên đính ảnh nào thì ra bộ đó —
không cần sửa chữ.

### Bước 2 — trên giao diện: bấm **Read outfit**

Trên chính node trang phục vừa GEN xong, bấm nút **Read outfit**. Nó làm hai việc
cho **mọi node dùng node này làm ảnh tham chiếu** — node mặc đồ và tất cả node
cảnh của nhánh:

1. đọc ảnh, hỏi mô hình liệt kê từng món, điền vào ô `{{TRANG_PHUC}}`
2. **đính chính ảnh flat lay** vào ô Attach của node đó

Nút chỉ hiện trên node có ai đó dùng làm tham chiếu, nên không lẫn với node khác.

Không cần tải lại trang sau bước này.

#### Cách cũ: chạy lệnh (vẫn dùng được)

```bash
node scripts/wf-doi-do.mjs s_01M30YY0XJEEVYEPGKD0GCN34E hong
```

Đổi `hong` thành `thu` nếu làm nhánh A.

Lệnh tự đọc ảnh ở node trang phục, hỏi mô hình liệt kê từng món, rồi điền vào
ô `{{TRANG_PHUC}}` ở **tất cả** node mặc đồ và node cảnh của nhánh đó.

Muốn tự viết mô tả thay vì để máy đọc thì thêm chuỗi vào cuối:

```bash
node scripts/wf-doi-do.mjs s_01M30YY0XJEEVYEPGKD0GCN34E hong "<liệt kê món đồ bằng tiếng Anh>"
```

### Bước 3 — trên giao diện: sinh ảnh

Nếu bước 2 làm bằng **lệnh** thì phải tải lại trang (Ctrl+Shift+R) trước, vì bản
graph trong trình duyệt không tự biết lệnh vừa sửa gì. Bấm nút **Read outfit**
thì không cần.

Bấm **GEN** theo thứ tự:

1. Node **MAC BO ... LEN MAU** — ra ảnh mẫu mặc bộ đó, nền studio
2. Các node cảnh — ra ảnh trong quán cà phê

---

## Vì sao vừa tả bằng chữ vừa đính ảnh

Đã đo bốn cách trên cùng một bộ đồ, cùng một người mẫu:

| Cách | Hoạ tiết in | Mặt mẫu |
|---|---|---|
| Ảnh nền = mẫu, bộ đồ chỉ vào qua cạnh `ref` | Sai (sáu con gấu thành sáu con giống hệt xếp hàng) | Đúng |
| Ảnh nền = flat lay | Đúng | Trôi hẳn sang người khác |
| Hai bước: bám đồ rồi trả mặt | Đúng | Vẫn trôi |
| **Ảnh nền = mẫu + đính flat lay vào Attach** | **Đúng** | **Đúng** |

Kết luận: ảnh vào qua **cạnh `ref` thì yếu**, vào qua **đường đính kèm thì mạnh**.
Nên nút Read outfit làm cả hai — tả bằng chữ và đính ảnh.

## Vì sao phải có bước 2

Ảnh tham chiếu **giữ chi tiết** (hoa văn, túi, nếp vải, sắc độ) nhưng **không
quyết định mặc cái gì**. Đã thử hai kiểu prompt chỉ trỏ vào ảnh mà không gọi tên
món đồ — cả hai đều hỏng: một lần mô hình nhuộm màu bộ đồ cũ trên ảnh nền, một
lần giữ nguyên đồ cũ. Cái quyết định là chữ.

Ngược lại, **bước trích ở node trang phục thì prompt chung chạy tốt**, vì ở đó
ảnh là nguồn duy nhất nên mô hình buộc phải nhìn.

## Các loại node

Mỗi node mang một **huy hiệu vai trò** ở góc trên, cạnh mã node:

| Huy hiệu | Việc | Prompt |
|---|---|---|
| **MẪU** | Sinh người mẫu gốc | Sửa được — đổi người mẫu ở đây |
| **BÓC TRANG PHỤC** | Tách đồ từ ảnh chụp thật ra flat lay nền trắng | **Cố định, khoá** — không gọi tên món nào nên đính ảnh nào ăn ảnh đó |
| **MẶC ĐỒ** | Cho mẫu mặc bộ đồ, nền studio | Điền bằng nút **Read outfit** |
| **CẢNH** | Mẫu trong quán cà phê, mỗi node một góc máy | Điền bằng nút **Read outfit**; sửa động tác thì sửa `DONG_TAC` |
| **VIDEO** | Node đã sinh video từ ảnh của nó | Giữ ảnh nguồn nên sinh lại video được |

Node mới thêm chưa có vai trò. Chọn ở **ô thả xuống ngay trên node**, cạnh mã
node. Chọn vai trò có prompt cố định (BÓC TRANG PHỤC) thì prompt **tự điền vào
và ô nhập bị khoá** — không phải gõ gì.

Node **BÓC TRANG PHỤC** có prompt khoá cứng: nó đã đúng và không phụ thuộc bộ đồ
nào, nên không có gì để chỉnh. Cả hai node A và B dùng chung một chuỗi, lấy từ
`ui/src/lib/vaiTroNode.ts` — không thể lệch nhau.

## Những chỗ dễ vấp

**Bấm GEN khi ô `{{TRANG_PHUC}}` chưa điền** → giao diện chặn lại và báo. Trước
khi có chốt chặn này, chuỗi `{{TRANG_PHUC}}` đi thẳng vào prompt và sinh ra bộ đồ
bịa hoàn toàn.

**Thứ tự cạnh quyết định vai trò.** Cạnh vào đầu tiên là **ảnh nền** đem đi sửa,
các cạnh sau là **ảnh tham chiếu** — canvas dán nhãn `base` / `ref` và vẽ cạnh ref
nét đứt. Nếu xoá rồi nối lại, phải nối **base trước, ref sau**; đảo ngược thì bộ
đồ thành ảnh nền và người mẫu thành tham chiếu, ra kết quả khác hẳn.

**Mã node hiện ở góc trên mỗi node**, bấm vào là chép. Dùng nó để chỉ đúng node
khi cần sửa.

**Kính lúp ở góc ảnh** mở ảnh (hoặc video) cỡ lớn trong lightbox.

**Nút hình cuộn phim** gọi Grok sinh video từ ảnh của node — tốn thời gian và
tiền, không phải nút phát. Node nào đã giữ video thì tự có trình phát riêng.

## Đổi thứ khác trong khuôn

| Muốn đổi | Sửa ở đâu |
|---|---|
| Người mẫu | Prompt node **MAU**, rồi GEN lại cả nhánh |
| Địa điểm | Hằng `DIADIEM` trong `scripts/wf-doi-do.mjs`, chạy lại lệnh bước 2 |
| Góc máy / động tác từng cảnh | Bảng `DONG_TAC` trong `scripts/wf-doi-do.mjs` |

## Làm ngoài giao diện

Nhanh hơn khi cần nhiều ảnh, và ghép được hai ảnh tham chiếu trong một lệnh:

```bash
node bin/ima2.js gen "<lời tả cảnh>" --ref <anh-mau>.png --ref <anh-flat-lay>.png --size 1024x1792 -o canh/x.png
```

Ảnh sinh ra nằm ở `C:\Users\s2pha\.ima2\generated\`, xem lại bằng
`node bin/ima2.js ls`.
