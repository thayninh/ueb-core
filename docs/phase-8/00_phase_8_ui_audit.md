# Phase 8 UI audit

## 1. Mục đích và phạm vi

Tài liệu này ghi nhận hiện trạng presentation layer của UEB Core trước khi bắt
đầu Phase 8. Audit chỉ đọc source tại commit nền
`a691827c03f846300a06c0a70a76e52de76881f6`; không kiểm tra hoặc thay đổi
production, database, API, quyền hay workflow.

Các bất biến của Phase 8:

- không thêm hoặc bỏ chức năng;
- không đổi route, server action, API contract, schema hoặc migration;
- không đổi permission, RLS, validation hay chuỗi submit/reject/resubmit/approve;
- không đổi nội dung nghiệp vụ khi chưa có phê duyệt riêng;
- chỉ chuẩn hóa layout, component hiển thị, responsive behavior và khả năng
  tiếp cận.

## 2. Phương pháp và số liệu inventory

Audit dựa trên `package.json`, `src/app`, `src/components`, `src/app/globals.css`
và asset hiện có trong `data/input`.

| Hạng mục | Hiện trạng |
| --- | --- |
| UI page routes | 17 page routes |
| Presentation surfaces | 18, gồm 17 route pages và trang 403 framework |
| Shared visual TSX components | 9 component trong `src/components`, không tính test/helper label |
| Files chứa table | 6 |
| Files chứa form hoặc action form | 15 |
| Table wrappers có `overflow-x-auto` | 6 |
| App Router loading boundaries | 0 |
| App Router error boundaries | 0 |
| App Router not-found boundaries tùy biến | 0 |

## 3. Frontend stack

| Lớp | Công nghệ/contract hiện hữu | Nhận xét UI |
| --- | --- | --- |
| Framework | Next.js 16.2.10 App Router | Server Components mặc định; Server Actions cho auth/admin/workflow |
| Rendering | React 19.2.4 | Client components chỉ dùng ở form tương tác cần `useActionState`/state |
| Language | TypeScript 5 | Type contracts nghiệp vụ đã tách khỏi presentation ở mức hợp lý |
| CSS | Tailwind CSS 4 qua `@import "tailwindcss"` | Utility classes nằm trực tiếp trong page/component; chưa có semantic UI tokens |
| Base theme | Hai CSS variables `--background`, `--foreground` | Dark mode theo `prefers-color-scheme`; phần lớn màu vẫn hard-code bằng utility |
| Auth | Better Auth + Server Actions | Không thuộc phạm vi thay đổi Phase 8 |
| Data | Prisma/PostgreSQL | Không thuộc phạm vi thay đổi Phase 8 |
| Test | Vitest, Testing Library, Playwright | Có nền tảng tốt để khóa behavior trong lúc thay presentation |
| UI library | Không có | Không có Button/Input/Card/Dialog primitive dùng chung hoặc icon library |

Trước mọi thay đổi code Next.js ở Phase 8, người triển khai phải đọc guide liên
quan trong `node_modules/next/dist/docs/` theo quy tắc repository; không dựa vào
convention Next.js cũ.

## 4. Brand asset

Asset chuẩn được operator chỉ định là `data/input/logo.png`:

- PNG RGBA, 2375 × 2425 px, có alpha;
- checksum audit:
  `5ef1e5ea6d2bfe2a51f9faa1bf52457380e2a692639e0eb4da9ec1de88ade257`;
- biểu trưng đỏ-trắng VNU UEB, gồm khiên/sách, ký hiệu VNU, chữ UEB và năm 1974;
- không chỉnh sửa nội dung logo và không tạo thêm bản sao trong lượt audit này.

Ràng buộc triển khai: `data/input/*` đang bị `.gitignore` loại trừ và toàn bộ
`data` bị `.dockerignore` loại khỏi image. Vì vậy source hiện có nhưng chưa phải
runtime asset có thể deploy. Phase 8 phải chốt asset-delivery contract riêng:
allowlist chính xác `data/input/logo.png` vào source/build hoặc một cơ chế
build-time tương đương, tuyệt đối không allowlist file Excel và không tạo bản
logo trùng lặp. Việc này chỉ được làm sau khi backlog P8-01 được duyệt.

## 5. Route và màn hình hiện hữu

| Nhóm | Route/màn hình | Thành phần chính |
| --- | --- | --- |
| Public | `/` | Trang giới thiệu tối giản |
| Auth | `/sign-in` | Email/password form, generic error, pending submit |
| Auth | `/change-password` | Ba password fields, forced-change message, logout |
| Protected shell | `/dashboard` | Chào người dùng, role badges, allowed-feature cards, managed units |
| Admin | `/admin/data` | Search, pagination, bảng 20 trường read-only |
| Admin | `/admin/users` | Create-user form, user cards, status/role/unit/mapping/session actions |
| Admin | `/admin/audit` | Filters, pagination, audit table |
| Leader | `/leader/data` | Unit filter, search, pagination, bảng dữ liệu đơn vị |
| Leader | `/leader/submissions` | Queue filters, queue table, pagination |
| Leader | `/leader/submissions/[submissionId]` | Metadata, diff 19 trường, approve/reject forms |
| Lecturer | `/lecturer/profile` | Bảng dữ liệu hiện hành và các action workflow |
| Lecturer | `/lecturer/rows/new` | Form tạo dòng mới với 14 trường editable |
| Lecturer | `/lecturer/rows/[recordUid]/edit` | Read-only metadata + form chỉnh sửa/gửi |
| Lecturer | `/lecturer/rows/[recordUid]/history` | Bảng version history |
| Lecturer | `/lecturer/submissions` | Filters, table, pagination |
| Lecturer | `/lecturer/submissions/[submissionId]` | Metadata, status, 19 payload fields, resubmit action |
| Lecturer | `/lecturer/submissions/[submissionId]/resubmit` | Rejection/base-change alerts và form gửi lại |
| Framework state | 403 forbidden | Message và link về dashboard; không phải page route riêng |

Các route API health/readiness/auth không phải UI screen và không được tính vào
17 route trên.

## 6. App shell, layout và navigation

### Hiện trạng

- Root layout chỉ đặt `lang="vi"`, antialiasing và flex body.
- Protected layout là topbar đơn hàng: brand text, link dashboard và logout.
- Điều hướng theo role nằm chủ yếu trong các feature card của dashboard.
- Nội dung page tự đặt `max-w-*`, `px-6`, `py-10`; chưa có PageContainer,
  PageHeader, Breadcrumb hoặc Section component dùng chung.
- Không có sidebar, mobile navigation, current-route state hoặc skip link.

### Vấn đề

- topbar `flex` không có responsive collapse/wrap contract; tại 320 px, brand,
  dashboard link và logout dễ bị ép hoặc tràn;
- độ rộng shell (`max-w-6xl`) không đồng bộ với page rộng đến 1800 px;
- page header/back-link/action layout được lặp lại ở nhiều route;
- người dùng phải quay lại dashboard để tìm phần lớn chức năng; nếu bổ sung
  navigation thì chỉ được hiển thị route đã tồn tại và phải dùng permission hiện
  hữu, không tự mở route mới.

## 7. Shared components và pattern có thể chuẩn hóa

Chín shared visual TSX components hiện hữu:

1. `CoreDataTable`;
2. `WorkflowActionFeedback`;
3. `ConfirmUnchangedForm`;
4. `EditableRowForm`;
5. `LeaderApproveForm`;
6. `LeaderRejectForm`;
7. `LecturerResubmissionAction`;
8. `LecturerRowsTable`;
9. `SubmissionStatusBadge`.

Các pattern đang lặp nhưng chưa thành primitive:

- Button variants và link-as-button;
- text input, password input, select, textarea, checkbox group và field error;
- card/section, metadata list, page header và back link;
- success/error/warning/info alert;
- role/status badges;
- empty state;
- filter panel;
- table shell, scroll affordance và responsive row presentation;
- pagination/PageLink (đang lặp ở admin data, admin audit, leader data,
  lecturer submissions và leader queue);
- Metadata renderer đang lặp trong lecturer/leader detail;
- auth card shell lặp giữa sign-in và change-password.

Không có modal hoặc tabs trong luồng hiện tại. Phase 8 có thể định nghĩa visual
contract cho các primitive này nhưng không được tự đưa modal/tabs vào flow hoặc
thay đổi confirmation behavior.

## 8. Typography, màu, spacing và surface hiện tại

### Typography

- global stack: Arial, Helvetica, sans-serif;
- heading thường dùng 30 px/36 px và weight 600; homepage dùng 36–48 px;
- body chủ yếu 14 px, metadata 12 px;
- type scale và line-height chưa được đặt bằng semantic tokens;
- nhiều metadata dùng uppercase/tracking rộng, có nguy cơ dày đặc ở mobile.

### Màu

- màu tương tác chính đang là Tailwind blue; chưa dùng màu đỏ nhận diện logo;
- neutral dùng zinc; trạng thái dùng emerald/amber/red;
- static audit thấy utility màu phân tán rộng: zinc 522, blue 101, red 77,
  emerald 44 và amber 34 occurrences;
- light/dark variants được viết lặp tại từng element nên khó đảm bảo contrast
  đồng nhất;
- status thường có text label nên không hoàn toàn phụ thuộc màu, đây là điểm tốt.

### Spacing/surface

- card chủ yếu `rounded-2xl`, `p-6`/`p-8`, border zinc và `shadow-sm`;
- controls trộn `rounded-lg`, `rounded-xl`, `py-2`, `py-2.5`, `py-3`;
- page thường cố định `px-6 py-10`, chưa co xuống mobile;
- không có elevation/radius/spacing contract nên cùng vai trò có nhiều biến thể.

## 9. Forms, tables, badges và states

### Forms

Điểm tốt:

- phần lớn field có label thật và native input type;
- password có autocomplete/min/max length đúng contract hiện hữu;
- pending button được disable;
- workflow feedback dùng `aria-live` và role phù hợp.

Điểm cần cải tiến presentation:

- input/select/textarea styles bị lặp và focus style không đồng nhất;
- một số select/button/link không có focus-visible ring rõ;
- admin user page có nhiều form/action nhỏ trong card, mật độ cao trên mobile;
- editable form 14 trường cần grouping, progressive spacing và sticky action
  presentation nhưng không được đổi payload/validation/submit action;
- reject textarea luôn tham chiếu cả help/error id dù error element có thể chưa
  tồn tại; cần kiểm tra lại accessibility wiring mà không đổi validation.

### Tables

- sáu table đều được bọc horizontal overflow; đây là fail-safe cơ bản;
- `CoreDataTable` có sticky STT; `LecturerRowsTable` có focusable scroll region
  và aria-label;
- bảng 20–23 cột dùng `min-w-max`; thao tác lecturer có cột `w-96`;
- các table còn lại thiếu scroll-region label/tab focus và visual overflow cue;
- queue/audit pagination không wrap nhất quán tại 320 px;
- không có density contract, caption hoặc mobile rendering strategy theo loại
  bảng.

### Status, empty, loading, error

- workflow có badge PENDING/REJECTED/APPROVED và alert success/error/warning;
- empty state tồn tại ở core table, lecturer table và queue, nhưng styles/text
  container khác nhau;
- pending action text có ở form;
- không có route-level loading skeleton;
- không có route-level error/not-found UI tùy biến; invalid query/access thường
  đi qua framework boundary;
- không có shared confirmation-state presentation ngoài từng workflow form.

## 10. Responsive audit

Static class audit có 12 `sm:`, 8 `md:`, 7 `lg:`, 1 `xl:` và không có `2xl:`.
Responsive behavior hiện tập trung vào grid; shell, actions và pagination chưa có
contract đầy đủ.

| Rủi ro | Mức | Bằng chứng | Tác động |
| --- | --- | --- | --- |
| Topbar không collapse/wrap | Cao | Protected layout dùng một hàng flex | Overflow hoặc tap targets bị ép ở 320 px |
| Bảng 20–23 cột | Cao | `min-w-max`, cột action `w-96` | Scroll dài, khó giữ context và tìm action trên mobile |
| Page padding cố định | Trung bình | Hầu hết page dùng `px-6 py-10` | Nội dung hẹp còn 272 px tại viewport 320 |
| Pagination/action rows | Trung bình | Nhiều `flex justify-between`/`flex gap` không wrap | Label/action có thể tràn khi text dài |
| Admin user cards | Cao | Nhiều form nhỏ, 3-column desktop, list có scroll riêng | Mật độ thao tác cao, nhầm action trên touch |
| Filter panels không thống nhất | Trung bình | breakpoint `sm`, `md`, `xl` khác nhau | Layout chuyển trạng thái không dự đoán được |
| Long identifier/text | Trung bình | Có chỗ `break-all`, có chỗ chưa có | Có thể kéo rộng card/table |
| No loading/error boundary | Trung bình | 0 boundary | Chuyển route chậm thiếu feedback; lỗi framework thiếu nhận diện |

## 11. Accessibility audit

Điểm tốt hiện hữu:

- document language là tiếng Việt;
- native headings, labels, form controls và table scopes được dùng rộng rãi;
- alert/status sử dụng live regions ở các form quan trọng;
- disabled states được thể hiện bằng attribute, không chỉ bằng style;
- workflow status có text, không chỉ màu.

Rủi ro cần xử lý:

| Rủi ro | Mức | Hướng khắc phục presentation-only |
| --- | --- | --- |
| Focus-visible thiếu/không nhất quán trên link, button, select | Cao | Một focus ring token dùng chung cho mọi interactive element |
| Tap target nhỏ ở action button `px-2.5 py-1`, checkbox và pagination | Cao | Tối thiểu 44 × 44 px trên touch layout, giữ nguyên action |
| Chưa có skip link/current navigation | Trung bình | Bổ sung skip-to-content và `aria-current` dựa trên route hiện hữu |
| Scroll table không phải tất cả đều keyboard-focusable/có hướng dẫn | Cao | Shared TableShell có label, `tabIndex=0`, scroll cue và focus ring |
| Heading/page landmarks chưa đồng nhất | Trung bình | Một `main`/một `h1`, PageHeader contract, landmark labels |
| Field error association có thể trỏ tới id chưa render | Trung bình | Chỉ nối id tồn tại; giữ nguyên error text/validation |
| Contrast chưa được khóa bằng token test | Cao | Kiểm tra WCAG AA cho text, focus, states ở light/dark |
| Motion hover translate không xét reduced motion | Thấp | Dùng motion token và `prefers-reduced-motion` |

## 12. Rủi ro khi chỉnh UI nhưng giữ nguyên tính năng

1. Refactor form có thể làm đổi `name`, hidden input, action binding hoặc native
   validation; mọi primitive phải forward nguyên props và form semantics.
2. Responsive duplicate markup có thể tạo hai form/control cùng `name` hoặc
   duplicate id; table/card responsive phải bảo đảm chỉ một interactive tree.
3. Di chuyển component giữa Server/Client boundary có thể kéo business query vào
   client; không thêm `"use client"` vào page/shell nếu không bắt buộc.
4. Navigation mới có thể vô tình lộ route không thuộc role; link phải lấy từ
   allowed-feature/authorization contract hiện hữu.
5. Đổi status color/text có thể phá test và ý nghĩa quyết định; giữ nguyên label
   nghiệp vụ và semantic state.
6. Sticky action/header có thể che content ở 320 px hoặc khi zoom 200%; cần test
   keyboard, zoom và safe-area.
7. Logo đang ngoài build context; allowlist sai có thể đưa Excel/PII vào image.
8. Dark-mode token đổi không đồng bộ có thể làm mất contrast.
9. Snapshot/visual refactor không được thay thế integration/E2E nghiệp vụ hiện
   có; cả hai lớp test phải cùng PASS.

## 13. Kết luận audit

UI hiện tại rõ ràng, semantic HTML tương đối tốt và đã có responsive grid/table
overflow cơ bản, nhưng chưa có design system, brand UEB chưa xuất hiện, app shell
quá tối giản và responsive/accessibility behavior còn phân tán. Cách an toàn
nhất là khóa behavior hiện hữu, đưa semantic tokens và primitive vào trước, sau
đó nâng từng nhóm màn hình bằng PR nhỏ. Không nên refactor đồng thời shell,
table và workflow form trong cùng một đợt.
