---
title: "Giảm nhiễu khi phát"
description: "Thêm hiệu ứng khử nhiễu AI thời gian thực vào rãnh lời thoại."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"vi"} -->

Thêm hiệu ứng khử nhiễu AI thời gian thực vào rãnh lời thoại.

## Trước khi bắt đầu

Dùng Soundscaper trên máy tính. Mở **Công cụ > Quản lý mô hình** và cài mô hình khử nhiễu thời gian thực cùng runtime tương ứng do bản dựng của bạn cung cấp. Cài mô hình là thao tác tải xuống rõ ràng; chỉ có trình duyệt thì không chạy được hiệu ứng gốc này.

## Các bước

1. Chọn rãnh lời thoại bị nhiễu và mở giá hiệu ứng thời gian thực.
2. Chọn **Thêm hiệu ứng**, rồi chọn **AI denoising (DPDFNet2)**.
3. Bắt đầu phát và so sánh với hiệu ứng đã bỏ qua bằng nút nguồn.
4. Điều chỉnh bản phối quanh rãnh đã làm sạch và nghe thử bản xuất trước khi bàn giao. Lưu dự án để giữ lại giá hiệu ứng.

## Kiểm tra kết quả

Tiếng ồn phải giảm trong khi lời nói vẫn rõ. Kiểm tra các phụ âm nhỏ, hơi thở và phần đầu phát. Nếu nghe thấy âm lượng bơm lên xuống hoặc mất lời, hãy bỏ qua hiệu ứng và so sánh với bản gốc.

## Giới hạn và khôi phục

Đây là khử nhiễu lời nói, không phải hiệu ứng phục hồi nhạc nói chung. Phát trên máy tính khác cần mô hình và runtime gốc tương thích. Nếu hiệu ứng không có, hãy kiểm tra cài đặt và hỗ trợ trên máy tính; dùng [khôi phục lời nói ngoại tuyến](/soundscaper/restore-damaged-speech/) khi cần kết quả đã render để duyệt. Tải mô hình không đảm bảo mọi bản ghi đều tốt hơn.
