---
title: "Nhập phiên âm thanh từ trình chỉnh sửa khác"
description: "Nhập các chỉnh sửa âm thanh được hỗ trợ, kết nối lại tư liệu và xem xét giới hạn chuyển đổi."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"vi"} -->

Nhập các chỉnh sửa âm thanh được hỗ trợ, kết nối lại tư liệu và xem xét giới hạn chuyển đổi.

## Trước khi bắt đầu

Sao chép phiên làm việc cùng âm thanh vào thư mục có thể truy cập. Các định dạng phiên âm thanh gốc được hỗ trợ gồm REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, phiên SoundCraft, và Audition `.sesx` hoặc `.ses` đời cũ. Giữ lại dự án ban đầu.

## Các bước

1. Chọn **Tệp > Đã mở** hoặc **Tệp > Nhập**, hoặc thả phiên làm việc vào vùng làm việc.
2. Trên trình duyệt, chọn âm thanh đi kèm phiên làm việc. Trên máy tính, cấp quyền truy cập thư mục tư liệu khi được yêu cầu.
3. Mở **Tệp > Báo cáo xuất bản**. Đọc các mục bị bỏ qua và chuyển đổi, rồi liên kết lại tư liệu ngoại tuyến nếu cần.
4. Nghe những phần chỉnh sửa và fade tiêu biểu, kiểm tra thứ tự rãnh và thời gian, rồi lưu thành dự án Scape mới.

## Kiểm tra kết quả

Các đoạn cắt đã nhập phải khớp với âm thanh nguồn có thể truy cập. So sánh kết quả với bản phối tham chiếu từ trình chỉnh sửa ban đầu, nhất là khi xử lý, định tuyến hoặc tự động hóa có ý nghĩa.

## Giới hạn và khôi phục

Nhập phiên gốc là chuyển đổi chỉnh sửa âm thanh, không đảm bảo bản phối giống hệt. Chi tiết được hỗ trợ khác nhau theo định dạng; plug-in trong phiên nguồn không được chạy. REAPER dùng các take âm thanh đang hoạt động và bỏ qua việc tạo take thay thế, MIDI, định tuyến và plug-in. Để trao đổi ngược với DAW khác, hãy dùng định dạng trao đổi được hỗ trợ như AES31 ADL hoặc DAWproject thay vì trông đợi trình ghi phiên gốc.
