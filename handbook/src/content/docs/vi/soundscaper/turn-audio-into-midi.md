---
title: "Chuyển nốt nhạc đã thu thành MIDI có thể chỉnh sửa"
description: "Phân tích bản thu nhạc bằng Basic Pitch và giữ các nốt có thể chỉnh sửa bên cạnh âm thanh."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"vi"} -->

Phân tích bản thu nhạc bằng Basic Pitch và giữ các nốt có thể chỉnh sửa bên cạnh âm thanh.

## Trước khi bắt đầu

Dùng Soundscaper trên máy tính với mô hình Basic Pitch đã phát hành và runtime tương ứng được cài đặt. Bắt đầu bằng đoạn nhạc ngắn có cao độ rõ. Giữ âm thanh làm tài liệu tham chiếu để nghe.

## Các bước

1. Chọn âm thanh nhạc và mở **Công cụ > Xử lý cục bộ nâng cao**.
2. Đặt **Thao tác** thành **Audio to MIDI (Basic Pitch)**. Xác nhận mọi yêu cầu đồng ý xử lý cục bộ rồi chọn **Phân tích**.
3. Chọn **Xem xét kết quả**, kiểm tra các nốt được phát hiện rồi chọn **Chấp nhận đề xuất** khi sẵn sàng.
4. Mở **Cửa sổ > Piano roll (beta)**, chọn phần MIDI mới rồi sửa cao độ, thời gian và độ dài nốt.

## Kiểm tra kết quả

Một rãnh MIDI mới xuất hiện bên cạnh âm thanh gốc. Chọn nhạc cụ và nghe cùng bản thu. **Huỷ bỏ** xóa đề xuất đã chấp nhận mà không xóa âm thanh nguồn.

## Giới hạn và khôi phục

Các nốt phát hiện được chỉ là ước lượng, nhất là trong bản phối dày hoặc bản thu nhiều nhiễu. MIDI ghi lại nốt chứ không phải âm sắc gốc. Dùng [nhạc cụ MIDI](/soundscaper/play-midi-instruments/) để phát và **Tệp > Xuất khác > Export MIDI (beta)** để chia sẻ nốt. Người nhận vẫn cần nhạc cụ có thể tái tạo âm thanh mong muốn.
