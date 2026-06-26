---
description: Lưu toàn bộ trạng thái project vào memory + MEMORY.md, commit, push lên GitHub
allowed-tools: Read, Write, Edit, Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git status:*), Bash(git ls-files:*)
---

Làm đủ các bước sau, đúng thứ tự, không bỏ bước:

1. Đọc file memory/project_sabi_phase1.md hiện tại.
2. Cập nhật file đó với trạng thái MỚI NHẤT của session này — phase đang làm, việc gì vừa xong, việc gì còn pending, mọi TODO/quyết định kỹ thuật chưa chốt. KHÔNG dùng từ "hoàn thành" cho 1 phase trừ khi đủ tiêu chí "chạy được" đã ghi trong README.
3. Cập nhật MEMORY.md ở gốc repo — nội dung đầy đủ trực tiếp, KHÔNG trỏ link ra file nằm ngoài git.
4. git status xem có gì chưa add.
5. git add -A, rồi git ls-files — rà xem có file quan trọng nào bị thiếu không.
6. git commit với message mô tả đúng việc đã làm trong session này.
7. git push.
8. In tóm tắt cuối: đã lưu gì, còn gì chưa, bước tiếp theo là gì.
