<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Quy tắc dự án UEB Core

- Không kết nối môi trường production khi chưa được yêu cầu rõ ràng.
- Không commit secret, file `.env`, file Excel hoặc audit output.
- Không tự ý thay đổi mô hình của bất kỳ bảng dữ liệu nghiệp vụ nào.
- Mọi thay đổi phải chạy lint, typecheck, test và build trước khi bàn giao.
