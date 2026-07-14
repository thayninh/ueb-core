# UEB Core

## Mục tiêu dự án

UEB Core là nền tảng quản lý dữ liệu giảng viên của Trường Đại học Kinh tế, Đại học Quốc gia Hà Nội (UEB). Giai đoạn hiện tại thiết lập nền tảng kỹ thuật cho các chức năng sẽ được phát triển sau.

## Yêu cầu môi trường

- Node.js 24
- pnpm 11 (qua Corepack)

## Cài đặt dependency

```bash
corepack enable pnpm
pnpm install
```

## Chạy môi trường phát triển

```bash
pnpm dev
```

Ứng dụng chạy tại [http://localhost:3000](http://localhost:3000).

## An toàn dữ liệu

Không commit file `.env`, file Excel hoặc output kiểm kê/audit vào repository. Dữ liệu đầu vào cá nhân và kết quả trong `infra/audit` phải luôn được giữ ngoài lịch sử Git, ngoại trừ các file giữ chỗ đã được phê duyệt.
