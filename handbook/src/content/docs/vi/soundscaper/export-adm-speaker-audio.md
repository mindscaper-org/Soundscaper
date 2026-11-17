---
title: "Kết xuất chương trình ADM cho loa"
description: "Xuất các bed và object ADM đã biên soạn thành âm thanh loa thông thường bằng EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"vi"} -->

Xuất các bed và object ADM đã biên soạn thành âm thanh loa thông thường bằng EBU EAR.

## Trước khi bắt đầu

Biên soạn một chương trình ADM trong thẻ ADM của Metadata editor, có gán bed và định vị các object. Xác định bố cục loa bàn giao, rồi chọn container và codec có thể chứa số kênh cần thiết.

## Các bước

1. Mở **Tệp > Xuất audio**.
2. Trong **Kết xuất > EBU EAR speaker rendering**, chọn bố cục: stereo, 5.1, 5.1.2, 5.1.4, 7.1 hoặc 7.1.4.
3. Kiểm tra định dạng đầu ra, số kênh và mức âm thanh, rồi xuất.
4. Đọc báo cáo bàn giao và nghe tệp đã xuất qua bố cục loa tương ứng.

## Kiểm tra kết quả

Đầu ra chứa PCM loa đã render theo thứ tự kênh được khai báo. Lựa chọn xuất này không đổi việc giám sát dự án hay bản dựng ADM gốc. Xem báo cáo để biết bộ render và bố cục đã dùng.

## Giới hạn và khôi phục

Không thể kết hợp render loa EAR với render tai nghe. Đầu ra tách rời và passthrough BW64/ADM không dùng được tùy chọn này. Các kênh đã render không mang siêu dữ liệu ADM bed/object ban đầu; hãy dùng BW64 chưa render để trao đổi nội dung đó. Object di chuyển hoặc khuếch tán, HOA, quản lý âm trầm và render Dolby được chứng nhận nằm ngoài tính năng này. Đồng hồ đo độ lớn thông thường hỗ trợ tối đa tám kênh bàn giao.
