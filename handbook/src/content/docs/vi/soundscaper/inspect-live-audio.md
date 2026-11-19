---
title: "Kiểm tra âm thanh trong khi phát"
description: "Dùng bảng Analysis để xem phổ trực tiếp, độ lớn, kiểm tra âm thanh nổi và báo cáo âm thanh ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"vi"} -->

Dùng bảng Analysis để xem phổ trực tiếp, độ lớn, kiểm tra âm thanh nổi và báo cáo âm thanh ACX.

## Trước khi bắt đầu

Mở dự án có âm thanh. Quyết định xem bạn muốn kiểm tra lúc phát hay một vùng đã chọn: vùng chọn thời gian có thể chuyển phổ sang phân tích vùng chọn.

## Các bước

1. Mở **Phân tích > Phân tích**. Mở rộng các mục cần dùng như **Spectrum**, biểu đồ phổ, độ lớn hoặc tương quan.
2. Xóa vùng chọn thời gian và bắt đầu phát để xem trực tiếp. So sánh các lớp rãnh trong phổ để tìm các dải tần cạnh tranh.
3. Dừng và chọn một đoạn để kiểm tra phổ mà không phát.
4. Để kiểm tra sách nói, mở rộng **ACX compliance** rồi chọn **Check audio**. Đọc bảng kết quả; dùng **Xuất** để tạo báo cáo JSON.

## Kiểm tra kết quả

Các màn hình trực tiếp phản hồi theo lúc phát. Báo cáo ACX liệt kê đạt hoặc không đạt cho từng phép kiểm tra âm thanh thay vì chỉ hiển thị đồng hồ đo. Sửa mức hoặc cài đặt định dạng không đạt rồi kiểm tra lại.

## Giới hạn và khôi phục

Phổ cho thấy năng lượng âm thanh, không cho biết bản phối có nghe hay không. Tương quan và độ lớn cần được đặt trong ngữ cảnh và lắng nghe. Các phép kiểm tra âm thanh ACX không đảm bảo dịch vụ xuất bản sẽ chấp nhận hoặc bao quát mọi yêu cầu biên tập. Thu gọn mục ACX sẽ xóa kết quả đang hiển thị; hãy chạy lại khi cần. Đóng các mục phân tích không cần thiết để giảm công việc hiển thị.
