# Phát triển cục bộ

## Chuẩn bị repository

```bash
git clone <repository-url>
cd ueb-core

nvm install 24
nvm use

corepack enable
pnpm install --frozen-lockfile
```

Kiểm tra terminal đang dùng đúng toolchain:

```bash
node --version
pnpm --version
```

Node.js phải thuộc major version 24 và pnpm phải thuộc major version 11.

## Tạo cấu hình local

```bash
cp .env.example .env
```

`.env` chỉ dùng cục bộ và đã được Git ignore. Không commit `.env`, secret, file Excel hoặc audit output. Không sao chép thông tin xác thực hay cấu hình production vào file local.

## Chạy PostgreSQL và ứng dụng

Khởi động PostgreSQL local:

```bash
docker compose up -d db
docker compose ps
```

Chờ service `db` chuyển sang `healthy`, sau đó chạy Next.js trực tiếp trên host:

```bash
pnpm dev
```

Ứng dụng mặc định phục vụ tại `http://127.0.0.1:3000`. Có thể kiểm tra:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/ready
```

Khi database healthy, cả hai endpoint phải trả HTTP 200.

## Dừng service

Dừng Next.js bằng `Ctrl+C` trong terminal đang chạy `pnpm dev`. Dừng database nhưng giữ container và volume:

```bash
docker compose stop db
```

Khởi động lại database:

```bash
docker compose start db
```

Nếu muốn gỡ các container và network nhưng vẫn giữ named volume:

```bash
docker compose down
```

> Cảnh báo: không chạy `docker compose down -v` sau khi đã nhập dữ liệu cần giữ. Tùy chọn `-v` xóa named volume PostgreSQL và làm mất dữ liệu local trong volume đó.
