# Phase 8 UI acceptance criteria

## 1. Gate bất biến

Phase 8 chỉ được nghiệm thu khi mọi điều sau đúng:

- route inventory UI vẫn là 17 page routes, trừ khi có authorization riêng ngoài
  Phase 8;
- không thêm/bỏ chức năng;
- API contract, Server Actions, Prisma schema/migrations và database không đổi;
- permission, RLS, role/unit scope và access-denied behavior không đổi;
- submit/reject/resubmit/approve, forced password change và admin mutations giữ
  nguyên hành vi;
- validation, field names, field counts, hidden inputs, query parameters, page
  size và ordering không đổi;
- dữ liệu mẫu nghiệp vụ và text nghiệp vụ không đổi nếu chưa được phê duyệt;
- không có production mutation chỉ để nghiệm thu UI.

## 2. Brand và design system

- [ ] Dùng đúng canonical `data/input/logo.png`, checksum được đối chiếu.
- [ ] Không sửa nội dung/tỷ lệ/màu logo.
- [ ] Không có logo duplicate trong repository/image.
- [ ] Build chỉ allowlist logo, không chứa Excel/data input/PII khác.
- [ ] Primary UI dùng semantic UEB brand token đã được duyệt.
- [ ] Neutral/surface/status light và dark tokens được định nghĩa tập trung.
- [ ] Typography, spacing, radius, border, shadow và focus dùng scale thống nhất.
- [ ] Không còn hard-code primary visual style mới trong màn hình đã migrate.
- [ ] Brand red và destructive red không truyền đạt ý nghĩa chỉ bằng màu.

## 3. Shared component acceptance

- [ ] Button/link variants có default, hover, focus, active, disabled và pending.
- [ ] Input/select/textarea giữ nguyên native props và FormData.
- [ ] Field label/hint/error association hợp lệ; không tham chiếu id không tồn tại.
- [ ] Alert/status dùng live region đúng mức, không đọc lặp không cần thiết.
- [ ] Badge có text label và contrast AA.
- [ ] TableShell có label, keyboard focus, scroll cue và no data-loss behavior.
- [ ] Pagination giữ nguyên query keys/page logic và wrap ở mobile.
- [ ] EmptyState không tạo CTA mới.
- [ ] Primitive không import business service, database client hoặc Server Action.

## 4. Responsive acceptance

### Global

- [ ] Test tại 320, 375, 639, 640, 768, 1023, 1024, 1440 và 1920 px.
- [ ] Không có body-level horizontal overflow ở bất kỳ viewport nào.
- [ ] Horizontal overflow chỉ nằm trong table/data region được gắn label.
- [ ] Không mất, ẩn hoặc reorder dữ liệu/action nghiệp vụ ngoài contract được
  duyệt.
- [ ] 200% browser zoom vẫn truy cập được navigation, field, error và action.
- [ ] Long Vietnamese text/UID/email không phá layout.

### Navigation

- [ ] Mobile navigation dùng được bằng touch và keyboard ở 320 px.
- [ ] Menu có accessible name, expanded state và focus handling.
- [ ] Skip link tới main hoạt động.
- [ ] Current route có visual state và `aria-current`.
- [ ] Lecturer/leader/admin chỉ thấy navigation được permission hiện hữu cho phép.
- [ ] Logout vẫn gọi action và session behavior hiện hữu.

### Forms/actions

- [ ] Mobile một cột; tablet hai cột phù hợp; desktop không quá ba cột.
- [ ] Touch target quan trọng tối thiểu 44 × 44 px.
- [ ] Mobile form controls dùng font tối thiểu 16 px khi cần tránh zoom tự động.
- [ ] Pending/disabled state không cho double submit.
- [ ] Keyboard mở trên mobile không che action/error cuối form.
- [ ] Tab order theo DOM/business field order hiện hữu.

### Tables

- [ ] Dense core tables giữ đủ 20 trường và version metadata tương ứng.
- [ ] Lecturer rows giữ đủ field, pending state và ba action hiện hữu.
- [ ] Queue/audit mobile representation giữ đủ thông tin và action.
- [ ] Table header/row header/scope semantics hợp lệ.
- [ ] Sticky element không che focus/content.
- [ ] Empty and zero-result states rõ, không render fake row.

## 5. Accessibility acceptance

- [ ] `html lang="vi"` giữ nguyên.
- [ ] Mỗi page có đúng một main landmark và một page-level `h1`.
- [ ] Heading hierarchy không bỏ cấp gây khó hiểu.
- [ ] Mọi interactive element có focus-visible rõ ở light/dark.
- [ ] Toàn bộ chức năng dùng được keyboard-only.
- [ ] Text/controls/status/focus đạt WCAG 2.2 AA contrast.
- [ ] Status không chỉ dùng màu; có label/description.
- [ ] Form error có `aria-invalid`/`aria-describedby` hợp lệ và live feedback phù
  hợp.
- [ ] Table scroll region keyboard-focusable và có hướng dẫn.
- [ ] Reduced-motion preference được tôn trọng.
- [ ] Logo alt behavior không đọc lặp brand text.
- [ ] 403/not-found/error UI không lộ PII, token, stack hoặc internal detail.

## 6. Screen acceptance

### Trang chủ

- [ ] UEB brand rõ ở mobile/desktop, không thêm CTA hoặc chức năng mới.
- [ ] Existing title/description semantics giữ nguyên.

### Sign-in

- [ ] Email/password fields, names, autocomplete và action không đổi.
- [ ] Success redirect, forced-change redirect và generic failure giữ nguyên.
- [ ] Không có signup/forgot-password/remember-me mới.

### Change-password

- [ ] Ba password fields và policy 12–128 giữ nguyên.
- [ ] Success logout/session revocation và redirects giữ nguyên.
- [ ] Error state không hiển thị credential/hash/internal error.

### Dashboard

- [ ] Role badges, allowed features và managed units khớp DTO/permission hiện
  hữu.
- [ ] Không thêm metric, chart hoặc dashboard module.

### Lecturer portal/forms

- [ ] Profile chỉ hiển thị rows thuộc lecturer hiện tại.
- [ ] 14 editable và 6 read-only fields giữ nguyên contract.
- [ ] CREATE_NEW/UPDATE_EXISTING/CONFIRM_UNCHANGED/resubmit đều giữ payload và
  action.
- [ ] Pending gate, base version/STT và parent submission semantics không đổi.
- [ ] Lecturer isolation tests PASS.

### Leader queue/review

- [ ] Queue chỉ chứa submission trong unit scope hiện hữu.
- [ ] Diff đủ 19 content fields và stale warning giữ nguyên.
- [ ] Approve/reject confirmation, reason limits và terminal events giữ nguyên.
- [ ] Leader unit isolation/concurrency tests PASS.

### Admin data/users/audit

- [ ] Admin data vẫn read-only và latest-version semantics giữ nguyên.
- [ ] User create/status/role/unit/mapping/session action FormData giữ nguyên.
- [ ] Không thêm hard delete, impersonation hoặc broad permission action.
- [ ] Audit filter/query/redaction và read-only behavior giữ nguyên.

## 7. State acceptance

- [ ] Loading skeleton không chứa dữ liệu thật/giả có thể hiểu nhầm.
- [ ] Empty state phân biệt “không có dữ liệu” và “không có kết quả bộ lọc”.
- [ ] Error state có safe message, retry chỉ khi contract hiện hữu cho phép.
- [ ] Success/error/warning/disabled/pending presentation nhất quán.
- [ ] Access denied tiếp tục fail-safe theo 403/404 behavior hiện hữu.

## 8. Functional parity tests

Tối thiểu phải PASS sau mỗi nhóm thay đổi liên quan:

- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm test:phase4` cho lecturer/leader workflow UI;
- `pnpm build`;
- Prisma validation/migration diff khi repository gate yêu cầu, dù Phase 8 không
  được đổi schema;
- auth sign-in/password-change E2E cho auth UI;
- existing admin action tests cho admin UI;
- `git diff --check`.

Ngoài existing tests, bổ sung:

- semantic component tests bằng role/name/state thay vì class snapshot;
- FormData/action/href parity tests;
- viewport overflow assertions;
- keyboard/focus tests;
- contrast/accessibility automated checks;
- Playwright screenshots ở các breakpoint đại diện, không chứa secret/PII.

## 9. Non-functional acceptance

- [ ] Không thêm UI dependency lớn nếu không có ADR/phê duyệt.
- [ ] Không tải font/logo từ CDN ngoài.
- [ ] Không gây layout shift đáng kể từ logo/font.
- [ ] Không tăng client component boundary không cần thiết.
- [ ] Không log/screenshot credential, token, cookie, roster PII.
- [ ] Build image secret/PII scan PASS.
- [ ] Dark/light theme không gây flash khiến text không đọc được.

## 10. Definition of Done cho mỗi backlog item

Một item chỉ hoàn thành khi:

1. phạm vi file khớp backlog và không có diff ngoài presentation/test;
2. before/after evidence có đủ mobile/tablet/desktop;
3. accessibility và responsive criteria liên quan PASS;
4. business behavior tests hiện hữu PASS mà không sửa expectation để hợp thức
   hóa regression;
5. reviewer xác nhận “không thay đổi tính năng”;
6. documentation/component contract được cập nhật nếu phát sinh variant mới;
7. working tree sạch sau commit.

## 11. Phase 8 final acceptance statement template

```text
PHASE8_PRESENTATION=PASS
UI_ROUTE_COUNT=17_UNCHANGED
BUSINESS_LOGIC_CHANGES=0
API_SCHEMA_PERMISSION_WORKFLOW_CHANGES=0
RESPONSIVE_MATRIX=PASS_320_TO_1920
ACCESSIBILITY=WCAG_2_2_AA_TARGET_PASS
LOGO_ASSET=CANONICAL_NO_DUPLICATE
FULL_TESTS=PASS
PRODUCTION_DEPLOYMENT=<SEPARATE_AUTHORIZATION_REQUIRED>
```
