---
title: "Khôi phục âm thanh từ dự án Audacity bị hỏng"
description: "Đánh giá dự án bị hỏng và lưu phần đã khôi phục thành một bản sao riêng."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"vi"} -->

Đánh giá dự án bị hỏng và lưu phần đã khôi phục thành một bản sao riêng.

## Trước khi bắt đầu

Trước hết, hãy sao chép dự án Audacity bị hỏng. Giữ các tệp phụ trợ có sẵn cùng nhau. Tính năng khôi phục xử lý được `.aup3` và tệp dự án chưa lưu của Audacity thuộc định dạng được hỗ trợ, nhưng không thể tạo lại mẫu âm thanh đã mất.

## Các bước

1. Mở **Tệp > Quản lý dự án > Khôi phục dự án Audacity**.
2. Chọn dự án bị hỏng. Đọc **Recovery assessment** trước khi nhập hoặc lưu bất cứ thứ gì.
3. Kiểm tra **Missing audio ranges**, bao gồm các trang bổ sung liệt kê vị trí bị ảnh hưởng.
4. Khi có, chọn **Save repaired Audacity copy**. Nếu không, mở kết quả khôi phục, xem báo cáo tương thích rồi lưu công việc dưới tên mới.

## Kiểm tra kết quả

Phát các đoạn đã khôi phục và kiểm tra khoảng trống hoặc im lặng theo báo cáo. Xác nhận bản sao mới mở được trước khi dựa vào nó. Giữ tệp gốc bị hỏng để thử khôi phục lần nữa.

## Giới hạn và khôi phục

Quá trình khôi phục có thể cứu phần đầu âm thanh còn hợp lệ và thay các mẫu bị thiếu bằng im lặng. Cơ sở dữ liệu đã sửa không có nghĩa là toàn bộ âm thanh còn nguyên hoặc mọi tính năng chỉnh sửa gốc đều được chuyển. Đọc các mục bị bỏ qua trong báo cáo và đừng ghi đè bản gốc duy nhất trong lúc chẩn đoán. Với dự án nguyên vẹn thông thường, dùng [hướng dẫn nhập Audacity](/guides/projects/open-an-audacity-project/).
