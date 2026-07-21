# Phase 8 responsive strategy

## 1. Mục tiêu

Responsive upgrade bảo đảm toàn bộ chức năng hiện hữu dùng được từ 320 px đến
desktop lớn mà không ẩn dữ liệu, bỏ action hoặc đổi workflow. Chiến lược dùng
mobile-first CSS và ba dải viewport được operator yêu cầu.

## 2. Breakpoint contract

| Dải | Viewport | Tailwind strategy | Thiết bị mục tiêu |
| --- | --- | --- | --- |
| Mobile | 320–639 px | Base styles | Điện thoại dọc/ngang nhỏ |
| Tablet | 640–1023 px | `sm:`; chỉ dùng sub-breakpoint nếu có bằng chứng | Tablet và cửa sổ hẹp |
| Desktop | >=1024 px | `lg:`; `xl:` chỉ giới hạn density/max-width | Laptop/desktop |

Tailwind mặc định `sm=640` và `lg=1024` khớp matrix. Phase 8 nên tránh trộn
`md=768` tùy tiện; nếu dùng phải ghi rõ behavior vẫn thuộc dải tablet. Test tối
thiểu tại 320, 375, 639, 640, 768, 1023, 1024 và 1440 px.

## 3. Responsive matrix tổng quát

| Thành phần | Mobile 320–639 | Tablet 640–1023 | Desktop >=1024 |
| --- | --- | --- | --- |
| Page gutter | 16 px | 24 px | 32 px |
| Section spacing | 24 px | 28–32 px | 32–40 px |
| Page title | 24–30 px | 30 px | 30–36 px |
| Card padding | 16 px | 20–24 px | 24–32 px |
| Navigation | Compact topbar + disclosure | Topbar + compact navigation | Topbar + optional role-aware side rail |
| Form grid | 1 cột | 2 cột | 2–3 cột theo field |
| Actions | Stack/full width khi cần | Wrap, primary rõ | Inline theo nhóm |
| Dense table | Horizontal scroll có cue | Scroll + sticky key columns | Full table + sticky header/key columns |
| Queue/audit table | Card/list presentation hoặc controlled scroll | Table compact | Full table |
| Pagination | Summary trên, controls wrap dưới | Cùng hàng nếu đủ chỗ | Cùng hàng |
| Metadata grid | 1 cột | 2 cột | 3 cột |

## 4. App shell và navigation

### Mobile

- topbar cao tối thiểu 56 px, logo/brand không vượt quá vùng dành riêng;
- chỉ giữ brand, page/context label ngắn và menu disclosure;
- menu chứa đúng route hiện hữu được permission contract trả về;
- logout vẫn là form/action hiện hữu, không đổi thành client-only call;
- menu mở phải có `aria-expanded`, focus order, Escape/close và không khóa người
  dùng bàn phím;
- có skip link đến `main`;
- không hiển thị sidebar cố định làm giảm content width.

### Tablet

- topbar giữ brand và nhóm action chính;
- navigation có thể là horizontal wrap hoặc compact rail tùy kiểm thử 640/768;
- page header actions xuống hàng riêng nếu tổng width không đủ;
- không cho text/link thu nhỏ dưới target dễ chạm.

### Desktop

- giữ topbar nhất quán;
- side rail chỉ dùng link đã tồn tại và đã được phép, không thêm dashboard hoặc
  information architecture mới;
- content container có hai mức: standard khoảng 72–80rem và wide cho table;
- current route có `aria-current="page"` và visual state không chỉ dựa vào màu.

## 5. Forms

### Grid

- mobile: một field mỗi hàng, label trên control, helper/error ngay sau control;
- tablet: hai cột; textarea, long text và alert span toàn bộ;
- desktop: tối đa ba cột cho metadata/read-only; editable fields chủ yếu hai
  cột để duy trì line length;
- field order trong DOM phải giữ đúng order hiện hữu; chỉ CSS grid thay vị trí
  khi không làm sai screen-reader order;
- hidden inputs, `name`, required/min/max, autocomplete và action không đổi.

### Buttons/action areas

- mobile: primary và destructive action stack, full-width khi label dài;
- approve/reject vẫn là hai section riêng như hiện tại, không đổi thành modal;
- confirmation checkbox nằm cùng action của nó, target >=44 px;
- pending state giữ nguyên disable behavior và label hiện hữu;
- tablet/desktop: actions inline hoặc hai cột khi source hiện có hai workflow
  branches.

### Validation

- error text wrap, không làm control/page rộng hơn viewport;
- error summary/live region xuất hiện trước action theo contract hiện hữu;
- focus tới error summary chỉ khi action đã trả lỗi;
- không thay validation message hoặc điều kiện hợp lệ.

## 6. Table strategy

### 6.1 Dense core/lecturer/history tables

Áp dụng cho `CoreDataTable` và `LecturerRowsTable`, có 20–23 trường/cột.

- giữ tất cả dữ liệu và thứ tự cột;
- dùng horizontal scroll thay vì ẩn cột;
- scroll container có accessible label, `tabIndex=0`, focus ring và hướng dẫn
  “Cuộn ngang để xem toàn bộ dữ liệu” chỉ hiển thị khi overflow;
- dùng edge shadow/gradient để báo còn nội dung;
- sticky STT/key column; sticky action column chỉ dùng khi không che content ở
  320 px;
- cell wrap có giới hạn hợp lý; identifier dùng mono và break;
- mobile giảm padding/density nhưng không giảm font dưới 14 px cho body;
- không thêm row-detail route mới.

Nếu usability test chứng minh table scroll vẫn không dùng được, có thể render
`dl` card chứa cùng toàn bộ field ở mobile. Cách này chỉ được làm khi bảo đảm một
interactive DOM tree, field order giống table và không duplicate form/action.

### 6.2 Workflow queue, submission list, diff và audit

- mobile ưu tiên stacked row/card với label-value rõ vì có 4–8 cột;
- action link/button đặt cuối card, cùng href/action hiện hữu;
- tablet có thể giữ table compact và horizontal overflow;
- desktop giữ table đầy đủ;
- diff table giữ ba giá trị/trạng thái gắn cùng field; nếu stack, từng field là
  một group có “hiện tại/đã gửi/thay đổi” rõ;
- empty row trở thành shared EmptyState, không giả dữ liệu.

### 6.3 Pagination/filter

- result summary và navigation được wrap độc lập;
- mobile controls có full-width hoặc two-button grid;
- query keys/page size/order giữ nguyên;
- filter panel một cột mobile, hai cột tablet, ba/bốn cột desktop;
- “Lọc/Xóa lọc” không vượt viewport và vẫn giữ native GET form.

## 7. Screen-specific behavior

### Home

- mobile card gần full width, logo có kích thước giới hạn và không crop;
- desktop brand composition có whitespace học thuật, không thêm CTA/function
  chưa tồn tại.

### Sign-in và change-password

- một auth shell dùng chung, logo + heading + form;
- 320 px dùng gutter 16, card padding 20, input 48 px;
- desktop card tối đa khoảng 28rem;
- keyboard/screen reader order giữ nguyên;
- không thêm remember-me, forgot-password hoặc signup.

### Dashboard

- mobile feature cards một cột; tablet hai; desktop ba như chức năng hiện hữu;
- role badges wrap; managed units một/two columns;
- không thêm metrics/chart/dashboard widget.

### Lecturer profile và data entry

- profile action nav stack mobile;
- dense table theo strategy 6.1;
- editable/read-only fields một cột mobile, hai tablet/desktop;
- submit area không che field error khi keyboard mở;
- không thay 14 editable/6 read-only fields hoặc submit variants.

### Lecturer submissions

- filter one/two/four columns theo breakpoint;
- mobile list card giữ type/state/record/time/result/detail;
- detail metadata 1/2/3 columns;
- resubmit warning/rejection reason wrap và có hierarchy rõ;
- không đổi parent linkage hoặc state action.

### Leader queue/review

- queue mobile card giữ lecturer/type/unit/base/time/warning/detail;
- detail diff có mobile grouped presentation;
- approve và reject stack mobile, side-by-side desktop;
- destructive/positive colors luôn có text và focus state;
- không đổi stale gate, confirmation, reject reason hay decision action.

### Admin data/users/audit

- admin/leader data dùng wide table strategy;
- admin users: create form một cột mobile, user card sections stack theo
  role/unit/mapping, mỗi mutation action giữ form riêng;
- audit filters stack, audit row card mobile, table desktop;
- không gom nhiều mutation vào một submit hoặc thay permission affordance.

## 8. Empty, loading và error states

- EmptyState có title/message/action slot nhưng chỉ render action nếu source đã
  có action tương ứng;
- route loading skeleton mô phỏng page/table/card, không hiển thị dữ liệu giả;
- error boundary có message an toàn và retry presentation, không lộ error detail;
- 403 giữ nguyên ý nghĩa và route quay về dashboard;
- not-found presentation đồng bộ brand nhưng không đổi việc access-denied được
  fail-safe thành 404 ở các route hiện hữu;
- skeleton và transition tôn trọng reduced motion.

## 9. Overflow và zoom rules

- không có horizontal overflow ở `html/body` từ 320 px;
- overflow ngang chỉ được phép trong TableShell/code/identifier container có chủ
  ý;
- long Vietnamese text, email/UID hiển thị phải wrap hoặc truncate kèm access
  đầy đủ, không đẩy viewport;
- zoom 200% vẫn dùng được navigation, form và action;
- browser text zoom không che label/error/action;
- sticky element không che focused control.

## 10. Responsive test matrix

| Viewport | Kiểm tra bắt buộc |
| --- | --- |
| 320 × 568 | Shell/menu, auth form, filter/actions, no body overflow |
| 375 × 812 | Touch targets, long Vietnamese text, workflow forms |
| 639 × 900 | Mobile upper boundary không jump/overflow |
| 640 × 900 | Tablet grid/navigation transition |
| 768 × 1024 | Tablet portrait tables/forms |
| 1023 × 768 | Tablet upper boundary |
| 1024 × 768 | Desktop shell transition |
| 1440 × 900 | Standard desktop layout |
| 1920 × 1080 | Wide tables không stretch text quá mức |

Mỗi màn hình phải được kiểm tra keyboard-only ở ít nhất mobile và desktop.
Playwright visual checks bổ sung không thay thế unit/integration/E2E nghiệp vụ.

## 11. Rollout strategy

1. khóa responsive baseline và overflow assertions;
2. token + container primitives;
3. auth/shell (ít business interaction);
4. lecturer screens;
5. leader decision screens;
6. admin screens;
7. loading/error/a11y polish;
8. cross-route regression ở toàn bộ matrix.

Mỗi đợt là PR nhỏ, có before/after evidence và khẳng định route/action/schema
diff bằng 0.
