---
title: "Giảm âm lọt giữa các mic thoại"
description: "Tạo các đường bao gain có thể chỉnh sửa để giảm âm lọt tương quan ở mic không hoạt động."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"vi"} -->

Tạo các đường bao gain có thể chỉnh sửa để giảm âm lọt tương quan ở mic không hoạt động.

## Trước khi bắt đầu

Dùng từ hai đến tám rãnh lời thoại đã căn thời gian, lý tưởng là mỗi người một mic với gain thu âm tương đương. Chọn một khoảng thời gian dương có âm thanh trên mỗi rãnh đã chọn. Mở khóa và bỏ đóng băng các rãnh đó.

## Các bước

1. Chọn các rãnh micrô và đoạn cần xử lý.
2. Mở **Hiệu ứng > Khử nhiễu và sửa lỗi > Automatic microphone-bleed reduction**.
3. Bắt đầu bằng cài đặt mặc định rồi chọn **Create gain envelopes**.
4. Phát đoạn đó, đặc biệt ở chỗ ngắt lời và lời nói chồng lấn. Dùng **Độ khuếch đại clip** để chỉnh các điểm được tạo khiến lời nói cần thiết bị giảm âm lượng.

## Kiểm tra kết quả

Các điểm gain giảm âm lọt trong khi nguồn gốc và vị trí clip vẫn được giữ nguyên. Kiểm tra lúc mỗi người bắt đầu nói và ranh giới vùng chọn. **Huỷ bỏ** xóa thao tác; **Làm lại** áp dụng lại.

## Giới hạn và khôi phục

Tính năng không căn chỉnh bản thu hoặc tách giọng nói bên trong mic đang hoạt động. Chênh lệch gain lớn, tiếng vang và lời nói nhỏ dưới âm lọt lớn có thể gây nhầm lẫn. Muốn thử cài đặt khác, hãy hoàn tác lần áp dụng đầu tiên vì áp dụng lần nữa sẽ cộng dồn mức suy giảm. Không thể xử lý vùng chọn phổ, rãnh bị khóa hoặc rãnh bị đóng băng.
