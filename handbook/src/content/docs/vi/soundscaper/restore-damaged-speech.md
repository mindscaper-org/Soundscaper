---
title: "Khôi phục lời nói hỏng bằng mô hình cục bộ"
description: "Xem lại kết quả phục hồi lời nói tùy chọn trước khi áp dụng vào bản thu."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"vi"} -->

Xem lại kết quả phục hồi lời nói tùy chọn trước khi áp dụng vào bản thu.

## Trước khi bắt đầu

Dùng ứng dụng máy tính và chọn lời nói cần sửa. Giữ lại bản gốc hoặc ảnh chụp. Các mô hình được liệt kê cho tác vụ phụ thuộc vào danh mục đã phát hành và runtime đã cài; bản dựng của bạn có thể không cung cấp VoiceFixer.

## Các bước

1. Mở **Hiệu ứng > Khử nhiễu và sửa lỗi > Nâng cao đối thoại**.
2. Chọn **Mô hình** tương thích. Khi được cung cấp, **VoiceFixer** xử lý hiện tượng xén và phục hồi lời nói; nếu cần, hãy chủ động cài qua phần điều khiển mô hình.
3. Chạy tác vụ, rồi chọn **Xem xét kết quả** và nghe âm thanh đề xuất cùng bản gốc.
4. Chỉ chấp nhận đề xuất nếu lời nói được cải thiện. Kiểm tra vị trí sẽ áp dụng rồi lưu dự án.

## Kiểm tra kết quả

Nghe các đỉnh đã sửa và lời nói rõ hơn, đồng thời chú ý nguyên âm, hơi thở và âm thanh nền bị thay đổi. Kết quả được chấp nhận là một chỉnh sửa âm thanh có thể nghe thử và hoàn tác; từ chối hoặc đóng màn hình xem lại sẽ không áp dụng kết quả.

## Giới hạn và khôi phục

VoiceFixer tổng hợp lại lời nói nên có thể làm thay đổi âm sắc và nội dung nền. Đây không phải công cụ sửa xén đỉnh nhạc nói chung. Nếu không có trong danh sách mô hình, hãy dùng công cụ tăng cường được cung cấp hoặc [hướng dẫn sửa đỉnh bị xén](/guides/cleaning-up/restore-clipped-peaks/); chỉ làm theo các bước này không thể bật một mô hình không được cung cấp.
