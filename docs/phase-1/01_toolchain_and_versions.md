# Toolchain và phiên bản

Các phiên bản dưới đây được xác nhận ngày 2026-07-14 từ command output, package đã cài hoặc cấu hình đã commit. Trước khi kiểm tra Node.js, phải chạy `nvm use` để terminal sử dụng phiên bản trong `.nvmrc`.

| Thành phần | Phiên bản thực tế | Lệnh kiểm tra |
| --- | --- | --- |
| Node.js | `v24.18.0` | `nvm use && node --version` |
| npm | `11.16.0` | `npm --version` |
| pnpm | `11.13.0` | `pnpm --version` |
| Next.js | `16.2.10` | `node -p "require('./node_modules/next/package.json').version"` |
| React | `19.2.4` | `node -p "require('./node_modules/react/package.json').version"` |
| TypeScript | `5.9.3` | `pnpm exec tsc --version` |
| PostgreSQL image | `postgres:18.4-bookworm` | `docker compose config --images` |
| Docker Compose | `v5.1.4` | `docker compose version` |

Phiên bản Node.js của dự án còn được khóa bằng `.nvmrc` với major version `24` và `engines.node` trong `package.json` là `>=24 <25`. Trường `packageManager` trong `package.json` khóa pnpm `11.13.0` cùng integrity hash do Corepack tạo.

Không suy ra phiên bản từ tài liệu này khi nâng cấp dependency. Sau mỗi lần nâng cấp, phải chạy lại các lệnh kiểm tra và cập nhật command output thực tế.
