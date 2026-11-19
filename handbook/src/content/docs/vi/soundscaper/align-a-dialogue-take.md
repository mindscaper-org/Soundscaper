---
title: "Căn chỉnh lần thu lời thoại thay thế"
description: "Khớp phần trình bày thứ hai của cùng câu thoại với clip tham chiếu."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"vi"} -->

Khớp phần trình bày thứ hai của cùng câu thoại với clip tham chiếu.

## Trước khi bắt đầu

Chuẩn bị hai clip âm thanh mono hoặc stereo đã mở khóa, mỗi clip dài 0,25–30 giây. Chúng cần có cùng lời và cách nói tương đối giống nhau. Trước tiên, hãy render hoặc bỏ liên kết vật liệu gắn với video hay nhịp phách.

## Các bước

1. Mở **Chỉnh sửa > Clip audio > Align dialogue**.
2. Chọn rõ clip tham chiếu và clip thay thế, sau đó đặt cường độ căn chỉnh.
3. Chọn **Analyze and align**. So sánh **Play reference**, **Play replacement** và **Play aligned**. Chú ý nghe phụ âm và nhịp thở.
4. Chỉ chọn **Create aligned copy** khi kết quả đã nghe ổn.

## Kiểm tra kết quả

Một rãnh mới chứa bản sao đã căn chỉnh theo điểm bắt đầu và thời lượng của mẫu tham chiếu. Bản gốc vẫn còn. **Huỷ bỏ** xóa bản sao đã tạo trong một bước. Lưu rồi mở lại để tiếp tục dùng kết quả đã render mà không cần phân tích lại.

## Giới hạn và khôi phục

Clip thay thế phải có thời lượng từ một nửa đến gấp đôi clip tham chiếu. Căn chỉnh dựa trên âm học, không kiểm tra khẩu hình hoặc xác minh bản chép lời. Lời khác nhau, tiếng ồn nền hoặc nhiều người nói chồng lấn có thể làm tính năng thất bại. Nếu phân tích từ chối khớp, hãy dùng các cụm ngắn hơn có cùng lời hoặc chỉnh sửa thủ công. Thay đổi đầu vào hay cường độ sẽ cần phân tích lại.
