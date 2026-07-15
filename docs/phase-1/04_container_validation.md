# Kiểm tra container

Các kiểm tra dưới đây đã được thực hiện cục bộ ngày 2026-07-14. Đây là xác nhận kỹ thuật cho image và Docker Compose của Giai đoạn 1, không phải xác nhận production readiness.

## Build image

```bash
docker build --pull -t ueb-core:phase-1 .
docker image inspect ueb-core:phase-1 \
  --format '{{.Config.User}} {{.Config.ExposedPorts}}'
```

Kết quả kiểm tra image:

```text
node map[3000/tcp:{}]
```

Runner dùng user `node`, không chạy bằng root, và expose cổng 3000.

## Chạy full stack

```bash
docker compose --profile container-app up -d --build
docker compose --profile container-app ps
```

Profile `container-app` chạy đúng hai service của môi trường local:

- `db`: PostgreSQL local, chờ health check thành công.
- `app`: Next.js standalone, chỉ khởi động sau khi `db` healthy.

## Xác nhận endpoint

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/ready
```

Kết quả đã xác nhận:

| Endpoint | HTTP | Trạng thái |
| --- | --- | --- |
| `/api/health` | `200` | `status: "ok"` |
| `/api/ready` | `200` | `status: "ready"`, `database: "reachable"` |

## Xác nhận non-root

```bash
docker compose exec app id
```

Kết quả đã xác nhận là user `node` với UID khác 0 (`uid=1000(node)`), không phải `uid=0(root)`.

Sau khi kiểm tra, có thể dừng riêng app và giữ database:

```bash
docker compose --profile container-app stop app
docker compose rm -f app
```

Giai đoạn 1 chưa deploy UEB Core lên production và chưa kiểm tra kết nối production.
