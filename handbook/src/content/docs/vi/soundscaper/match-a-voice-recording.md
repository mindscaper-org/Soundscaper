---
title: "Khớp âm sắc của bản thu giọng nói"
description: "Học một mẫu tham chiếu âm sắc và dùng Match EQ để đưa bản thu khác đến gần mẫu đó."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"vi"} -->

Học một mẫu tham chiếu âm sắc và dùng Match EQ để đưa bản thu khác đến gần mẫu đó.

## Trước khi bắt đầu

Chọn mẫu tham chiếu nghe rõ, có đủ dải tần và dài ít nhất một phần tư giây; tốt nhất là cùng người nói được thu âm tốt. Chuẩn bị bản thu đích. Tính năng này xử lý cục bộ trên cả trình duyệt và máy tính.

## Các bước

1. Chọn mẫu tham chiếu và mở **Hiệu ứng > EQ và bộ lọc > Match EQ**. Chọn **Learn reference from selection**.
2. Lưu mẫu tham chiếu đã học thành preset nếu muốn tái sử dụng hồ sơ giọng nói này. Đóng hộp thoại.
3. Chọn âm thanh đích, mở lại Match EQ, gọi mẫu tham chiếu nếu cần, rồi chọn **Analyze target**.
4. Dùng **Xem trước** để so sánh **Nguyên bản** với **Matched (level compensated)**. Điều chỉnh mức hiệu chỉnh, sau đó chọn **Áp dụng cho vùng chọn** hoặc **Edit as Filter Curve EQ** để sửa đường cong.

## Kiểm tra kết quả

Nghe ở mức âm lượng tương tự để đánh giá cân bằng âm sắc có gần hơn không. Âm thanh sau khi áp dụng giữ nguyên thời lượng và số kênh. **Huỷ bỏ** đảo ngược thao tác.

## Giới hạn và khôi phục

Match EQ không thể khôi phục dải tần đã mất hoặc khớp cách trình diễn, động học, tiếng vang phòng hay danh tính giọng nói. Việc thu mẫu tham chiếu bao gồm hiệu ứng rãnh trước bus và master; âm thanh đích được phân tích trước giá hiệu ứng rãnh. Hãy render mẫu tham chiếu trước nếu âm thanh mong muốn phụ thuộc vào xử lý ở công đoạn sau.
