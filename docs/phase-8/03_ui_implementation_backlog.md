# Phase 8 UI implementation backlog

## 1. Quy tắc thực hiện backlog

- Thứ tự dưới đây là thứ tự triển khai an toàn từ nền tảng đến màn hình rủi ro
  cao, không phải mức độ quan trọng nghiệp vụ.
- Mỗi item phải là một PR nhỏ hoặc một nhóm commit độc lập có thể review/rollback.
- Trước sửa Next.js phải đọc guide tương ứng trong `node_modules/next/dist/docs/`.
- Mọi item phải chạy format, lint, typecheck, test và build; item liên quan flow
  phải chạy thêm E2E hiện hữu.
- Không item nào được đổi business logic, route, API, schema, permission,
  workflow, validation hoặc dữ liệu mẫu nghiệp vụ.

## P8-01 — Brand asset và design tokens

- **Mục tiêu:** thiết lập semantic color/type/spacing/radius/focus tokens và
  contract dùng đúng logo UEB canonical.
- **Màn hình/component:** toàn hệ thống ở mức nền; chưa migrate feature UI.
- **File dự kiến ảnh hưởng:** `src/app/globals.css`, `.gitignore`,
  `.dockerignore`, build asset allowlist liên quan, test asset/secret scan. Chỉ
  allowlist `data/input/logo.png`; không allowlist `data/input/*.xlsx`.
- **Rủi ro:** Trung bình — asset hiện bị ignore; cấu hình sai có thể đưa data
  input vào Git/image.
- **Tiêu chí hoàn thành:** logo checksum/canonical path giữ nguyên; không có bản
  sao logo; token light/dark có contrast PASS; Excel/PII không tracked/packaged.
- **Cách test:** Git/image file inventory, checksum, contrast test, build,
  secret/PII scan, visual token specimen ở 320/1440.
- **Không thay đổi tính năng:** Có; chỉ asset delivery và theme variables.

## P8-02 — Shared UI primitives

- **Mục tiêu:** tạo Button, LinkButton, Field, Input, Select, Textarea,
  CheckboxField, Card, Alert, Badge, EmptyState, TableShell và Pagination thuần
  presentation.
- **Màn hình/component:** primitive catalog; migrate một fixture/component ít
  rủi ro để chứng minh contract.
- **File dự kiến ảnh hưởng:** `src/components/ui/*`, test tương ứng,
  `src/app/globals.css`.
- **Rủi ro:** Trung bình — primitive form có thể làm mất prop/name/action.
- **Tiêu chí hoàn thành:** forward native props/ref/aria; focus-visible, pending,
  disabled, error, dark mode và touch target đạt contract.
- **Cách test:** Testing Library semantic role/name, keyboard/focus, form-data
  parity, contrast, build.
- **Không thay đổi tính năng:** Có; primitive không import business service,
  enum hay action.

## P8-03 — Page/layout primitives

- **Mục tiêu:** chuẩn hóa PageContainer, PageHeader, Section, MetadataGrid,
  BackLink và responsive action group.
- **Màn hình/component:** dùng thử ở `/` và 403 trước khi áp dụng protected page.
- **File dự kiến ảnh hưởng:** `src/components/layout/*`, `src/app/page.tsx`,
  `src/app/forbidden.tsx`, tests.
- **Rủi ro:** Thấp.
- **Tiêu chí hoàn thành:** spacing/gutter/heading/landmark đồng nhất; không body
  overflow ở 320 px; text hiện hữu không đổi.
- **Cách test:** DOM heading/landmark tests, responsive screenshots 320/640/1024,
  root page tests.
- **Không thay đổi tính năng:** Có; route và link destination giữ nguyên.

## P8-04 — Protected app shell và role-aware navigation

- **Mục tiêu:** brand topbar, skip link, current-route state và responsive
  navigation cho các route đã tồn tại/được phép.
- **Màn hình/component:** toàn bộ protected pages.
- **File dự kiến ảnh hưởng:** `src/app/(protected)/layout.tsx`,
  `src/components/layout/app-shell.tsx`, navigation presentation tests.
- **Rủi ro:** Cao — navigation không được lộ link ngoài permission.
- **Tiêu chí hoàn thành:** mobile menu dùng được ở 320 px; desktop shell ổn định;
  logout vẫn server action cũ; navigation items chỉ từ authorization/allowed
  feature contract hiện hữu.
- **Cách test:** role matrix lecturer/leader/admin, keyboard/focus/Escape,
  forbidden-route tests, Playwright auth/route tests.
- **Không thay đổi tính năng:** Có; chỉ tăng khả năng tìm route hiện hữu.

## P8-05 — Auth shell và trang sign-in

- **Mục tiêu:** đưa logo UEB, hierarchy và form primitives vào `/sign-in`.
- **Màn hình/component:** sign-in page/form.
- **File dự kiến ảnh hưởng:** `src/app/(auth)/sign-in/page.tsx`,
  `sign-in-form.tsx`, tests, auth shell component.
- **Rủi ro:** Trung bình — không được đổi credential fields/action/redirect.
- **Tiêu chí hoàn thành:** responsive 320–1440; error/pending/focus rõ; email và
  password field contract giữ nguyên; không thêm signup/forgot-password.
- **Cách test:** existing sign-in tests, failed/success action behavior, keyboard,
  autocomplete, screenshot matrix.
- **Không thay đổi tính năng:** Có; form action, field names và redirects giữ
  nguyên.

## P8-06 — Trang change-password

- **Mục tiêu:** đồng bộ auth presentation và hiển thị policy/error rõ hơn mà
  không đổi text/policy.
- **Màn hình/component:** `/change-password`, `ChangePasswordForm`.
- **File dự kiến ảnh hưởng:** `src/app/(auth)/change-password/page.tsx`,
  `change-password-form.tsx`, tests.
- **Rủi ro:** Cao — flow bắt buộc, session revocation và password attributes rất
  nhạy cảm.
- **Tiêu chí hoàn thành:** ba field/policy/submit/logout giữ nguyên; errors liên
  kết đúng; mobile keyboard không che action; forced-change E2E PASS.
- **Cách test:** unit + Phase 7 password E2E, autocomplete/min/max assertions,
  old/new password flow regression, accessibility scan.
- **Không thay đổi tính năng:** Có; không đổi policy/hash/session behavior.

## P8-07 — Dashboard presentation

- **Mục tiêu:** chuẩn hóa welcome card, role badges, feature cards và managed
  unit empty/list states.
- **Màn hình/component:** `/dashboard`.
- **File dự kiến ảnh hưởng:** `src/app/(protected)/dashboard/page.tsx`, shared
  Card/Badge/EmptyState, tests.
- **Rủi ro:** Trung bình — feature card list phải giữ permission output.
- **Tiêu chí hoàn thành:** 1/2/3-column responsive grid; role/unit labels giữ
  nguyên; không thêm metric/chart/function.
- **Cách test:** role fixture snapshots by semantic content, href parity,
  responsive screenshots.
- **Không thay đổi tính năng:** Có; allowedFeatures được render nguyên vẹn.

## P8-08 — Lecturer profile và dense rows table

- **Mục tiêu:** làm bảng 20+ cột và workflow action dùng được trên mobile/tablet
  với scroll/focus cues.
- **Màn hình/component:** `/lecturer/profile`, `LecturerRowsTable`,
  `ConfirmUnchangedForm`.
- **File dự kiến ảnh hưởng:** profile page, `src/components/workflow/lecturer-rows-table.tsx`,
  `confirm-unchanged-form.tsx`, TableShell/tests.
- **Rủi ro:** Cao — cùng row có nhiều action và pending gate.
- **Tiêu chí hoàn thành:** không ẩn/reorder field; scroll keyboard accessible;
  pending/non-pending actions giữ đúng; viewport không overflow ngoài table.
- **Cách test:** existing lecturer portal unit/integration/E2E, 320/640/1024
  overflow tests, keyboard action path.
- **Không thay đổi tính năng:** Có; confirm/edit/history behavior không đổi.

## P8-09 — Lecturer create/edit/resubmit forms

- **Mục tiêu:** responsive form grid, read-only grouping, field errors và action
  placement nhất quán.
- **Màn hình/component:** rows new/edit, submission resubmit,
  `EditableRowForm`.
- **File dự kiến ảnh hưởng:** ba page tương ứng,
  `src/components/workflow/editable-row-form.tsx`, feedback/field primitives,
  tests.
- **Rủi ro:** Cao — 14 editable fields, hidden JSON payload và stable submission
  id không được thay đổi.
- **Tiêu chí hoàn thành:** field list/order/name/value/required giữ nguyên;
  errors đúng field; 1/2-column responsive; no duplicate interactive DOM.
- **Cách test:** FormData parity, all workflow submit integration/E2E,
  resubmission E2E, 320 px keyboard test.
- **Không thay đổi tính năng:** Có; CREATE_NEW/UPDATE_EXISTING/resubmit contracts
  giữ nguyên.

## P8-10 — Lecturer submission list/detail

- **Mục tiêu:** chuẩn hóa filters, mobile list/table, status, metadata và result
  cards.
- **Màn hình/component:** lecturer submissions list/detail.
- **File dự kiến ảnh hưởng:** hai lecturer submission page, status badge,
  pagination/table/metadata primitives, tests.
- **Rủi ro:** Trung bình.
- **Tiêu chí hoàn thành:** query params, sort/page, status labels, detail href và
  payload 19 fields giữ nguyên; mobile không body overflow.
- **Cách test:** query parsing tests, list/detail authorization tests,
  responsive visual/keyboard tests.
- **Không thay đổi tính năng:** Có; chỉ đổi cách trình bày cùng DTO.

## P8-11 — Leader queue

- **Mục tiêu:** responsive filters, queue card/table và pagination dễ quét.
- **Màn hình/component:** `/leader/submissions`.
- **File dự kiến ảnh hưởng:** leader queue page, TableShell/Pagination/FilterPanel,
  tests.
- **Rủi ro:** Cao — unit scope và stale warning phải giữ nguyên.
- **Tiêu chí hoàn thành:** chỉ item trong scope; filter/query/sort unchanged;
  mobile card giữ đủ lecturer/type/unit/base/time/warning/detail.
- **Cách test:** leader queue integration, scope-denied tests, Playwright leader
  flow, viewport matrix.
- **Không thay đổi tính năng:** Có; queue resolver và authorization không đổi.

## P8-12 — Leader review/approve/reject

- **Mục tiêu:** metadata/diff responsive và hai decision panels rõ, an toàn.
- **Màn hình/component:** leader submission detail, approve/reject forms.
- **File dự kiến ảnh hưởng:** detail page, `leader-approve-form.tsx`,
  `leader-reject-form.tsx`, alert/field/table primitives, tests.
- **Rủi ro:** Rất cao — quyết định workflow và stale gate.
- **Tiêu chí hoàn thành:** diff đủ 19 fields; checkbox/reason/action/state giữ
  nguyên; approve/reject không đổi vị trí trong DOM gây submit nhầm; touch target
  và focus PASS.
- **Cách test:** reject/approve/concurrency integration, leader E2E, stale gate,
  keyboard-only and 200% zoom.
- **Không thay đổi tính năng:** Có; không đổi decision services hoặc validation.

## P8-13 — Core data tables cho admin/leader/history

- **Mục tiêu:** áp dụng shared dense-table shell, search/filter header và
  pagination nhất quán.
- **Màn hình/component:** admin data, leader data, lecturer history,
  `CoreDataTable`.
- **File dự kiến ảnh hưởng:** ba pages, core table, pagination primitives, tests.
- **Rủi ro:** Cao — không được lọt dữ liệu ngoài scope hoặc đổi latest-version
  semantics.
- **Tiêu chí hoàn thành:** đủ cột/order/data; sticky/scroll accessible; search,
  page query và read-only wording giữ nguyên.
- **Cách test:** DTO/table tests, admin/leader data authorization/query tests,
  wide/mobile screenshot and overflow assertions.
- **Không thay đổi tính năng:** Có; data queries và permissions không đổi.

## P8-14 — Admin user management

- **Mục tiêu:** giảm mật độ thị giác của create form/user cards và làm action
  groups an toàn trên touch.
- **Màn hình/component:** `/admin/users`, `CreateUserForm`, local Badge/Button
  patterns.
- **File dự kiến ảnh hưởng:** admin users page/form, shared primitives, tests.
- **Rủi ro:** Rất cao — nhiều mutation form độc lập, role/unit/status/session.
- **Tiêu chí hoàn thành:** mỗi action vẫn là form/action riêng; labels/hidden
  target/value giữ nguyên; no accidental double submit; mobile grouping rõ.
- **Cách test:** admin action unit/integration tests, FormData parity, role/scope
  matrix, keyboard/touch visual tests.
- **Không thay đổi tính năng:** Có; không đổi provisioning/admin policy.

## P8-15 — Admin audit

- **Mục tiêu:** chuẩn hóa filter, result summary, table/card và pagination.
- **Màn hình/component:** `/admin/audit`.
- **File dự kiến ảnh hưởng:** audit page, filter/table/pagination primitives,
  tests.
- **Rủi ro:** Trung bình.
- **Tiêu chí hoàn thành:** event/outcome/page query, row fields và read-only
  behavior giữ nguyên; long metadata wrap; mobile view accessible.
- **Cách test:** audit query/access tests, table semantics, viewport screenshots.
- **Không thay đổi tính năng:** Có; không đổi audit writer/query/redaction.

## P8-16 — Route loading/empty/error states

- **Mục tiêu:** đồng bộ loading skeleton, empty, safe error, 403/not-found
  presentation.
- **Màn hình/component:** route groups có query nặng, 403 và empty lists.
- **File dự kiến ảnh hưởng:** approved `loading.tsx`/`error.tsx`/`not-found.tsx`
  boundaries, EmptyState/Alert/Skeleton primitives, tests.
- **Rủi ro:** Trung bình — boundary không được làm lộ error hoặc đổi fail-safe
  404/403 behavior.
- **Tiêu chí hoàn thành:** loading không dữ liệu giả; safe error không stack/PII;
  access denial status/behavior giữ nguyên; reduced motion PASS.
- **Cách test:** thrown-error fixtures, access-denied/notFound tests,
  accessibility/live-region checks.
- **Không thay đổi tính năng:** Có; chỉ presentation của state hiện hữu.

## P8-17 — Cross-route responsive/accessibility hardening

- **Mục tiêu:** khóa chất lượng toàn hệ thống sau khi migrate từng màn hình.
- **Màn hình/component:** tất cả 18 presentation surfaces và shared primitives.
- **File dự kiến ảnh hưởng:** Playwright/Vitest UI tests, CSS polish; không chạm
  service/action/schema.
- **Rủi ro:** Cao do phạm vi rộng, nhưng không có business mutation.
- **Tiêu chí hoàn thành:** no body overflow 320–1920; WCAG AA contrast; keyboard,
  focus, 200% zoom, reduced motion, touch target và light/dark PASS; route/action
  inventory unchanged.
- **Cách test:** full viewport matrix, axe-equivalent automated checks nếu được
  duyệt dependency, manual keyboard/screen-reader spot checks, full repository
  gates và Phase 3/4/7 critical E2E.
- **Không thay đổi tính năng:** Có; item chỉ test/hardening presentation.

## 2. Nhóm triển khai đề xuất

| Đợt | Backlog | Điều kiện ra đợt |
| --- | --- | --- |
| 0 — Baseline | P8-01 | Asset allowlist an toàn, tokens/contrast được duyệt |
| 1 — Foundation | P8-02, P8-03 | Primitives và page layout semantic tests PASS |
| 2 — Shell/Auth | P8-04, P8-05, P8-06, P8-07 | Role navigation/auth E2E PASS |
| 3 — Lecturer | P8-08, P8-09, P8-10 | Lecturer submit/resubmit E2E PASS |
| 4 — Leader | P8-11, P8-12 | Reject/approve/stale/concurrency E2E PASS |
| 5 — Admin/Data | P8-13, P8-14, P8-15 | Scope/admin/audit tests PASS |
| 6 — Polish | P8-16, P8-17 | Toàn bộ acceptance criteria PASS |

Không gộp P8-09, P8-12 và P8-14 vào cùng PR vì cả ba đều chứa mutation form có
rủi ro cao.
