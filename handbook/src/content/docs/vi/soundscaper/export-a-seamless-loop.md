---
title: "Xuất vòng lặp kèm đuôi hiệu ứng"
description: "Gập đuôi reverb hoặc delay vào đầu tệp âm thanh lặp lại."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"vi"} -->

Gập đuôi reverb hoặc delay vào đầu tệp âm thanh lặp lại.

## Trước khi bắt đầu

Chuẩn bị đúng vùng lặp với phần xử lý mong muốn. Dùng định dạng không mất dữ liệu như WAV để kiểm tra điểm nối. Giữ mức phát và mức xuất thông thường dưới ngưỡng clipping.

## Các bước

1. Chọn khoảng thời gian cần lặp và mở **Tệp > Xuất audio**.
2. Chọn vùng đã chọn cùng định dạng, tần số lấy mẫu và bố cục kênh phù hợp.
3. Bật **Render as loop** trong phần cài đặt xuất. Xuất tệp.
4. Nhập kết quả vào dự án thử nghiệm và nghe một số vòng lặp, đặc biệt ở ranh giới.

## Kiểm tra kết quả

Tệp xuất giữ nguyên thời lượng vòng lặp đã chọn trong khi đuôi được render cuộn vào đầu. Lắng nghe tiếng tách, mức âm lượng tăng đột ngột và chuyển tiếp reverb mượt.

## Giới hạn và khôi phục

Việc cuộn đuôi không thể sửa một điểm cắt nhạc không phù hợp hoặc dạng sóng khô bị gián đoạn. Tính năng này khác với **Bao gồm đuôi hiệu ứng tới 10 giây**, vốn kéo dài bản xuất thông thường. Các đuôi được cộng lại có thể làm tăng đỉnh; hãy giảm mức hoặc dùng tính năng giới hạn đỉnh thực tùy chọn của Limiter rồi kiểm tra tệp bàn giao. Định dạng mất dữ liệu có thể thêm phần đệm hoặc đổi đỉnh, vì vậy cũng cần kiểm tra đúng định dạng đích.
