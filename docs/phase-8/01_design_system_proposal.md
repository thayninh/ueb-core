# Phase 8 design system proposal

## 1. Mục tiêu

Design system Phase 8 tạo một lớp presentation thống nhất cho UEB Core theo
phong cách học thuật, chuyên nghiệp, gọn, rõ và hiện đại. Hệ thống này chỉ thay
cách hiển thị; không sở hữu hoặc thay đổi business rules, route, permission,
validation, server action, API hay database contract.

## 2. Nguyên tắc thiết kế bất biến

1. **Brand có kiểm soát:** dùng đúng `data/input/logo.png`, không vẽ lại, crop
   làm đổi nội dung hoặc tạo bản sao không cần thiết.
2. **Semantic trước utility:** component dùng token `brand`, `surface`,
   `danger`, `success`, `warning`, không phụ thuộc trực tiếp vào tên màu.
3. **Content và behavior giữ nguyên:** label nghiệp vụ, hidden fields, submit
   target, confirmation, status và thứ tự workflow không đổi.
4. **Accessible by default:** keyboard focus rõ, contrast WCAG AA, touch target
   đủ lớn, status không chỉ truyền đạt bằng màu.
5. **Mobile-first:** base style cho 320 px, sau đó mở rộng ở 640 và 1024 px.
6. **Server-first:** giữ Server Component boundary hiện có; primitive thuần hiển
   thị không tự thêm state hoặc client runtime.
7. **Fail-safe refactor:** khi chưa có responsive pattern an toàn, giữ horizontal
   scroll thay vì ẩn cột hoặc rút gọn dữ liệu nghiệp vụ.

## 3. Định hướng thương hiệu UEB

### 3.1 Logo

- Canonical source: `data/input/logo.png`.
- Logo phải giữ tỷ lệ gốc, không đổi màu, không thêm hiệu ứng, không đặt trên
  nền làm mất tương phản phần trắng/đỏ.
- Dùng logo ở auth shell và brand area của app shell; không dùng trang trí lặp
  ở mọi card.
- Có text alternative ngắn gọn `UEB` hoặc `Trường Đại học Kinh tế – ĐHQGHN`
  tùy ngữ cảnh; logo cạnh brand text có thể dùng alt rỗng để tránh đọc lặp.
- Phase 8 không commit logo thứ hai. P8-01 phải allowlist đúng file canonical
  vào source/build mà không đưa `data/input/*.xlsx` vào Git/image.

### 3.2 Brand palette đề xuất

Logo hiện hữu có sắc đỏ crimson chủ đạo. Các giá trị dưới đây là token proposal
cho UI, không phải tuyên bố thay thế bộ nhận diện chính thức; trước implementation
cần kiểm tra contrast và đối chiếu brand approval.

| Token | Giá trị đề xuất | Mục đích |
| --- | --- | --- |
| `--color-brand-50` | `#FFF1F3` | Brand tint/background |
| `--color-brand-100` | `#FFE4E8` | Hover subtle/selected surface |
| `--color-brand-200` | `#FECDD5` | Border subtle |
| `--color-brand-500` | `#C71836` | Accent/icon trên nền sáng khi contrast đạt |
| `--color-brand-600` | `#B0102B` | Primary default candidate |
| `--color-brand-700` | `#960D25` | Primary hover/brand text |
| `--color-brand-800` | `#7F1024` | Pressed state |
| `--color-brand-900` | `#65101F` | Strong heading/accent |
| `--color-brand-950` | `#3D0710` | Darkest brand ink |

Không dùng brand red thay thế tự động cho semantic danger. Danger luôn có icon,
label và token riêng để tránh hiểu nhầm action chính là action phá hủy.

### 3.3 Neutral, surface và status tokens

| Nhóm | Token chính | Giá trị light đề xuất | Vai trò |
| --- | --- | --- | --- |
| Canvas | `--color-canvas` | `#F6F7F9` | Nền app |
| Surface | `--color-surface` | `#FFFFFF` | Card/form/table |
| Surface subtle | `--color-surface-subtle` | `#F1F3F5` | Header/selected row |
| Text strong | `--color-text` | `#18181B` | Body/heading |
| Text muted | `--color-text-muted` | `#52525B` | Metadata/helper |
| Border | `--color-border` | `#D4D4D8` | Default border |
| Border strong | `--color-border-strong` | `#A1A1AA` | Dividers/emphasis |
| Success | `--color-success-*` | emerald family | Approved/success only |
| Warning | `--color-warning-*` | amber family | Pending/stale/warning |
| Danger | `--color-danger-*` | red family, visually distinct from brand surface | Rejected/error/destructive |
| Info | `--color-info-*` | blue family | Neutral guidance/link focus |

Dark-mode values phải dùng cùng semantic token, không để component tự ghép
`dark:*`. Dark canvas/surface đề xuất lần lượt `#09090B`/`#18181B`; text chính
`#FAFAFA`, muted `#D4D4D8`, border `#3F3F46`. Mọi cặp foreground/background
phải được contrast-test trước khi chốt.

## 4. Typography

Không phụ thuộc font CDN. Stack đề xuất:

```css
ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif
```

| Token | Size/line-height | Weight | Dùng cho |
| --- | --- | --- | --- |
| `text-xs` | 12/16 | 400–600 | Metadata, badge |
| `text-sm` | 14/20 | 400–600 | Form, table, helper |
| `text-base` | 16/24 | 400–600 | Body |
| `text-lg` | 18/28 | 600 | Card title |
| `text-xl` | 20/28 | 600 | Section heading |
| `text-2xl` | 24/32 | 650 | Compact page heading |
| `text-3xl` | 30/38 | 650 | Desktop page heading |
| `text-display` | 36/44 mobile, 44/52 desktop | 700 | Home/auth brand statement |

Quy tắc:

- một `h1` rõ trên mỗi page;
- uppercase chỉ dùng cho eyebrow/metadata ngắn;
- line length body tối đa khoảng 70–75 ký tự;
- identifier kỹ thuật dùng mono nhưng phải wrap;
- mobile page heading giảm một cấp, không thay nội dung.

## 5. Spacing, radius, border, shadow và motion

### Spacing scale

Base unit 4 px: `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- control internal padding: 12–16 px;
- card padding: 16 px mobile, 24 px tablet/desktop;
- page gutter: 16 px mobile, 24 px tablet, 32 px desktop;
- section gap: 24 px mobile, 32 px desktop;
- form field gap: 16–20 px.

### Radius

| Token | Giá trị | Dùng cho |
| --- | --- | --- |
| `radius-sm` | 6 px | Badge/small control |
| `radius-md` | 8 px | Button/input |
| `radius-lg` | 12 px | Alert/table shell |
| `radius-xl` | 16 px | Card/page panel |
| `radius-full` | 9999 px | Status/role badge |

### Border/shadow

- default border 1 px semantic border;
- focus không dùng border shift để tránh layout jump;
- `shadow-sm` cho surface phân tách nhẹ;
- `shadow-md` chỉ cho elevated overlay/header; không phủ shadow lên mọi card;
- selected/hover row dùng surface token, không thay đổi kích thước.

### Focus và motion

- mọi control/link/action: `outline: 2px solid` focus token và offset 2 px;
- focus phải nhìn thấy ở light/dark và high-contrast mode;
- hover không thay thế focus;
- transition 120–180 ms cho color/shadow;
- tắt translate/animated decoration khi `prefers-reduced-motion: reduce`.

## 6. Component contracts

### 6.1 Button và link action

Variants: `primary`, `secondary`, `destructive`, `ghost`, `link`.

- dùng native `button` hoặc Next `Link` đúng semantic;
- size `sm`, `md`, `lg`; touch layout tối thiểu 44 px;
- states: default, hover, focus-visible, active, disabled, pending;
- pending giữ nguyên label nghiệp vụ hiện có và không tự submit lần hai;
- primitive chỉ forward `type`, `name`, `value`, `formAction`, `disabled`;
- không tự thêm confirmation hoặc đổi server action.

### 6.2 Input, select, textarea và checkbox

- shared `Field` gồm label, control, hint, error slot;
- minimum control height 44 px; font 16 px trên mobile để tránh browser zoom;
- error liên kết bằng `aria-describedby` chỉ khi element tồn tại;
- `aria-invalid` dựa trên state presentation có sẵn;
- giữ nguyên `name`, `type`, autocomplete, min/max/required và native behavior;
- checkbox/radio có visual hit area 44 px nhưng native control vẫn hoạt động.

### 6.3 Card và section

- `Card`, `Section`, `PageHeader`, `MetadataGrid` dùng semantic surface tokens;
- title/action layout stack ở mobile, inline từ tablet;
- không biến card thành navigation nếu source chưa phải link;
- không giấu content nghiệp vụ sau accordion mặc định.

### 6.4 Table

Shared `TableShell` cung cấp:

- border/radius/background nhất quán;
- focusable horizontal scroll region có label/instruction;
- scroll shadow/edge cue;
- sticky header và sticky key/action column khi không làm sai alignment;
- empty state và optional result summary;
- density mặc định bảo đảm target/action đủ lớn;
- giữ đầy đủ cột và data; không reorder business fields nếu chưa phê duyệt.

Dense 20–23-column table ưu tiên scroll an toàn. Queue/audit table có thể có
mobile card presentation dùng cùng data và action, với một interactive DOM tree
tại mỗi breakpoint.

### 6.5 Modal

Hiện codebase không có modal. Design contract (nếu một flow hiện hữu sau này
thực sự cần overlay) phải có focus trap, labelled title, Escape/close và restore
focus. Phase 8 không tự chuyển approve/reject/submit thành modal vì đó có thể
đổi hành vi confirmation.

### 6.6 Alert và feedback

Variants: `info`, `success`, `warning`, `danger`.

- icon/decorative marker + title + body; không chỉ màu;
- `role=status` cho success/info, `role=alert` cho blocking error;
- focus error summary sau failed submit giữ behavior hiện có;
- giữ nguyên error text/code mapping từ action.

### 6.7 Badge

- status badges giữ nguyên PENDING/REJECTED/APPROVED labels;
- role/status/account badges dùng semantic variant riêng;
- tối thiểu text contrast AA, không encode state chỉ bằng hue.

### 6.8 Tabs

Không có tabs hiện hữu. Chỉ định nghĩa pattern accessibility cho nhu cầu được
duyệt sau này; không chuyển filter/navigation hiện tại thành tabs trong Phase 8
nếu làm đổi URL, keyboard behavior hoặc information hierarchy.

### 6.9 Pagination

- một shared pagination dùng URL/query hiện hữu;
- disabled state không focusable nhưng vẫn có label rõ;
- mobile stack/wrap, current result summary tách khỏi controls;
- không đổi page size, query parameter hoặc ordering.

### 6.10 Sidebar/topbar

- topbar luôn chứa canonical UEB brand, current context và logout;
- desktop có thể dùng compact side navigation cho route hiện hữu;
- mobile dùng disclosure navigation có accessible name/focus management;
- items phải lấy từ allowed feature/permission contract hiện hữu;
- không render link người dùng không được phép và không tạo route mới.

## 7. Form grid contract

| Viewport | Grid | Actions |
| --- | --- | --- |
| 320–639 px | 1 cột, gutter 16 px | Full-width hoặc stack, primary cuối theo DOM hiện hữu |
| 640–1023 px | 2 cột cho field ngắn; field dài span 2 | Wrap/inline khi đủ chỗ |
| >=1024 px | 2–3 cột tùy form; max content width | Inline, căn theo section |

Việc xác định field span là presentation metadata, không đổi field list, thứ tự
submit hoặc validation.

## 8. Cấu trúc kỹ thuật đề xuất

Sau khi được duyệt, ưu tiên:

1. semantic CSS custom properties trong `src/app/globals.css`;
2. primitive thuần presentation dưới `src/components/ui/`;
3. layout primitives dưới `src/components/layout/`;
4. feature components hiện hữu chuyển dần sang primitive, không big-bang;
5. variants bằng typed props nhỏ, không thêm dependency UI lớn nếu chưa cần;
6. visual/responsive tests bổ sung song song với unit/integration/E2E hiện hữu.

Không đưa business enum/query/action vào design-system package. UI component chỉ
nhận label/state đã được feature layer xác định.

## 9. Tiêu chí chốt design system

- logo canonical được đóng gói mà không duplicate hoặc lộ Excel/data input;
- token light/dark contrast đạt WCAG AA;
- primitive giữ nguyên native element/form props;
- không còn màu primary/spacing/control style tùy ý ở màn hình đã migrate;
- keyboard focus và disabled/pending state có test;
- viewport 320, 640, 1024 và 1440 không có page-level overflow ngoài vùng table
  được chủ ý;
- business tests hiện hữu không thay expectation nghiệp vụ.
