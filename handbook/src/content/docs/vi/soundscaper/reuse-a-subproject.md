---
title: "Dùng lại dự án đã lưu dưới dạng âm thanh liên kết"
description: "Chèn dự án đã lưu vào bố cục khác và nhận các chỉnh sửa về sau của dự án đó."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"vi"} -->

Chèn dự án đã lưu vào bố cục khác và nhận các chỉnh sửa về sau của dự án đó.

## Trước khi bắt đầu

Lưu dự án Soundscaper con trong cùng thư viện dự án cục bộ. Hoàn tất phần phối trước. Render và kết xuất quá trình xử lý plug-in gốc đang bật thành âm thanh trước khi dùng trình render dự án con chạy nền.

## Các bước

1. Mở dự án cha và chọn **Tệp > Subprojects**.
2. Chọn dự án con trong **Project to insert or relink**, rồi chọn **Insert subproject**. Bản phối đã xuất bản xuất hiện trên rãnh mới.
3. Chọn liên kết trong **Linked subprojects**, rồi chọn **Open subproject** để chỉnh sửa dự án con. Lưu lại, sau đó trở về dự án cha để nghe âm thanh đã cập nhật.
4. Chọn **Pin current audio** để giữ nguyên phiên bản này, hoặc **Make independent audio** để ngừng theo dõi dự án con.

## Kiểm tra kết quả

Vị trí trong dự án cha vẫn giữ nguyên khi dự án con được cập nhật. Phát lại sau khi làm mới và kiểm tra phần đầu lẫn phần cuối. Bản phối con ngắn hơn được đệm bằng khoảng lặng trong phạm vi đã xuất bản ban đầu.

## Giới hạn và khôi phục

Thời lượng và bố cục kênh đã xuất bản được cố định; hãy chèn một vị trí khác nếu cần phạm vi khác. Tệp cha di động bao gồm âm thanh đã cài đặt nhưng không có dự án con có thể chỉnh sửa. Chuyển dự án con riêng và dùng **Relink to selected project**. Liên kết vòng bị từ chối.
