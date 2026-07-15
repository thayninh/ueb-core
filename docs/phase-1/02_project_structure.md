# Cấu trúc dự án

## Cấu trúc `src`

```text
src/
├── app/
│   ├── api/
│   │   ├── health/
│   │   │   ├── route.ts
│   │   │   └── route.test.ts
│   │   └── ready/
│   │       └── route.ts
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.test.tsx
│   └── page.tsx
└── lib/
    └── server/
        ├── env.ts
        └── postgres.ts
```

## Thành phần nền tảng

### Next.js App Router

Thư mục `src/app` sử dụng App Router. `layout.tsx` cung cấp layout gốc và metadata, `page.tsx` là trang foundation, còn các thư mục `api/*` cung cấp Route Handlers. Trang hiện tại chỉ xác nhận nền tảng dự án, chưa chứa nghiệp vụ.

### Health endpoint

`GET /api/health` chạy bằng Node.js runtime, luôn dynamic và trả header `Cache-Control: no-store`. Endpoint trả HTTP 200 cùng trạng thái dịch vụ và timestamp ISO-8601. Health check không truy cập PostgreSQL, vì vậy vẫn hoạt động khi database dừng.

### Ready endpoint

`GET /api/ready` chạy bằng Node.js runtime, luôn dynamic và không cache. Endpoint gọi PostgreSQL bằng `SELECT 1`:

- Trả HTTP 200, `status: "ready"` và `database: "reachable"` khi kết nối thành công.
- Trả HTTP 503, `status: "not_ready"` và `database: "unreachable"` khi kết nối thất bại.

Response lỗi không chứa stack trace, chuỗi kết nối, mật khẩu hoặc chi tiết lỗi nội bộ.

### Kiểm tra biến môi trường server

`src/lib/server/env.ts` dùng Zod để kiểm tra duy nhất `DATABASE_URL`. Việc kiểm tra là lazy: module không đọc hoặc validate môi trường khi import; chỉ hàm `getServerEnv()` mới thực hiện kiểm tra. Thông báo lỗi nêu tên biến và nguyên nhân hợp lệ nhưng không in giá trị của biến.

### PostgreSQL pool

`src/lib/server/postgres.ts` dùng `pg` và chỉ tạo pool khi `getPostgresPool()` được gọi. Trong development, pool được giữ trên `globalThis` để hot reload dùng lại kết nối. Cấu hình nền tảng gồm tối đa 10 kết nối, timeout kết nối 5 giây, idle timeout 30 giây và `application_name` là `ueb-core`.

## Ngoài phạm vi hiện tại

Giai đoạn 1 chưa có:

- Schema hoặc bảng dữ liệu nghiệp vụ.
- ORM hay migration nghiệp vụ.
- Authentication hoặc authorization.
- Luồng import Excel hoặc mock dữ liệu nghiệp vụ.
