---
title: "Tìm hiệu ứng tiêu tốn CPU khi phát"
description: "So sánh chi phí của hiệu ứng thời gian thực trước khi quyết định đơn giản hóa phần xử lý nào."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"vi"} -->

So sánh chi phí của hiệu ứng thời gian thực trước khi quyết định đơn giản hóa phần xử lý nào.

## Trước khi bắt đầu

Dùng dự án có hiệu ứng thời gian thực và một đoạn bận rộn tiêu biểu. Số đo mô tả thiết bị và khối lượng công việc này, không phải bảng xếp hạng plug-in phổ quát.

## Các bước

1. Mở **Trợ giúp > CPU profiling**.
2. Bắt đầu hoặc khởi động lại phát sau khi mở bảng để đo từng hiệu ứng thời gian thực.
3. Theo dõi một số lần cập nhật. So sánh các hàng hiệu ứng với hàng trình chỉnh sửa cơ bản; bỏ qua một hiệu ứng tốn kém rồi phát lại cùng đoạn.
4. Đóng bảng sau khi hoàn tất và khôi phục phần xử lý bạn muốn giữ.

## Kiểm tra kết quả

Mức dùng CPU có thể vượt khả năng của một lõi: 100% nghĩa là một lõi CPU đang bận hoàn toàn. So sánh tỷ lệ CPU và phần trăm thời gian xử lý đã trôi qua. Dấu gạch ngang nghĩa là không có số đo, không phải không tốn chi phí.

## Giới hạn và khôi phục

Thời gian xử lý đã trôi qua bao gồm độ trễ lập lịch. Mức dùng GPU và các tiến trình trợ giúp bên ngoài không được tính; bản thân việc đo cũng tạo thêm chi phí. Hiệu ứng bị bỏ qua được đánh dấu riêng. Mở **Tuỳ chọn khác > Auto-idle** trong phần đầu hiệu ứng để bộ xử lý phù hợp có thể ngủ khi im lặng. Tắt tùy chọn này với hiệu ứng cần giữ nhịp liên tục. Xem [xử lý cục bộ](/help/local-processing/) để biết các cài đặt liên quan. Luôn phát lại cùng một đoạn khi so sánh thay đổi.
