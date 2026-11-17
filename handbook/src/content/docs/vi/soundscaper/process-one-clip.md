---
title: "Áp dụng hiệu ứng thời gian thực cho một clip"
description: "Tạo một giá hiệu ứng riêng cho một clip âm thanh mà không xử lý mọi clip trên rãnh."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"vi"} -->

Tạo một giá hiệu ứng riêng cho một clip âm thanh mà không xử lý mọi clip trên rãnh.

## Trước khi bắt đầu

Chọn một clip âm thanh trong Soundscaper. Hiệu ứng clip thuộc quá trình xử lý của clip đó và đưa tín hiệu vào hiệu ứng của rãnh; xử lý rãnh và master vẫn có thể làm thay đổi âm thanh bạn nghe.

## Các bước

1. Mở **Cửa sổ > Thuộc tính clip** và mở rộng **Hiệu ứng**. Đây là giá hiệu ứng của clip.
2. Chọn **Thêm hiệu ứng**, chọn một hiệu ứng rồi điều chỉnh thông số. Phát clip để nghe thử.
3. Dùng nút nguồn của hiệu ứng để so sánh âm thanh khi bỏ qua và khi đã xử lý. Sắp xếp lại hoặc xóa hiệu ứng trong giá khi cần.
4. Lưu dự án, sau đó nghe clip cùng các clip lân cận. Dùng **Huỷ bỏ** nếu thay đổi không hữu ích.

## Kiểm tra kết quả

Clip đã chọn có quá trình xử lý riêng trong khi các clip khác giữ cài đặt riêng. Nghe qua phần cuối clip để kiểm tra đuôi reverb hoặc delay; kiểm tra giá hiệu ứng rãnh nếu kết quả tổng hợp quá mạnh.

## Giới hạn và khôi phục

Đuôi hiệu ứng có thể dài hơn âm thanh nguồn của clip; hãy kiểm tra tùy chọn đuôi khi xuất trước khi bàn giao. Với bộ dò Auto Duck, hãy chọn một rãnh phù hợp khác; vòng phản hồi sẽ bị từ chối. Mở **Tuỳ chọn khác > Auto-idle** trong phần đầu hiệu ứng để cho bộ xử lý ngủ khi im lặng. Tắt tùy chọn này với plug-in nhạy về thời gian. Xem [xử lý cục bộ](/help/local-processing/) để biết các cài đặt liên quan.
