# Kế hoạch Giai đoạn 3 — Authentication, identity mapping and RBAC foundation

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | DRAFT — BLOCKED BY AUTHENTICATION AND IDENTITY HARD GATE |
| Nhánh thực hiện | `feat/phase-3-auth-rbac` |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-16 |
| Phạm vi môi trường | Local development và local acceptance; không kết nối production |

## Bối cảnh và nguyên tắc

Giai đoạn 3 xây dựng nền tảng xác thực, ánh xạ danh tính và phân quyền trên dữ liệu đã được import trong Giai đoạn 2. Mục tiêu là bảo đảm mỗi request được xác thực và được backend giới hạn theo đúng người dùng, vai trò và đơn vị phụ trách trước khi triển khai workflow nghiệp vụ ở Giai đoạn 4.

Các nguyên tắc bắt buộc:

- Không cài thư viện authentication và không tạo schema, migration hoặc mã xác thực trước khi hard gate tại Mục 2 đạt `PASS`.
- Không kết nối, tạo tài khoản, chạy migration hoặc triển khai trên production trong Giai đoạn 3.
- Không cho đăng ký công khai.
- Không dùng email, mã cán bộ hoặc tên giảng viên làm khóa định danh bất biến.
- `user_id` là định danh kỹ thuật của tài khoản; `lecturer_uid` là định danh nghiệp vụ của giảng viên.
- Không tự suy đoán email, tự gộp tài khoản hoặc tự liên kết tài khoản với giảng viên.
- Backend phải xác thực và phân quyền cho mọi request; ẩn nút hoặc route ở giao diện không phải biện pháp bảo vệ đầy đủ.
- Mọi quyền được cấp theo nguyên tắc tối thiểu và bị giới hạn theo phạm vi dữ liệu.
- Thay đổi tài khoản, liên kết danh tính, vai trò, đơn vị phụ trách và trạng thái phiên phải có dấu vết kiểm toán phù hợp.
- Không commit secret, `.env`, file Excel hoặc audit output.
- Không thay đổi mô hình của các bảng dữ liệu nghiệp vụ đã có nếu chưa có quyết định và review riêng.

Tài liệu này chỉ lập kế hoạch. Commit kế hoạch không cài dependency, không tạo bảng, không sửa bảng nghiệp vụ và không triển khai chức năng authentication.

## 1. Mục tiêu

1. Chốt cơ chế đăng nhập và định danh chính thức trước khi lựa chọn thư viện hoặc thiết kế schema.
2. Xây dựng bảng tài khoản người dùng và liên kết có kiểm soát giữa `user_id` với `lecturer_uid`.
3. Xây dựng nền tảng RBAC với ba vai trò nghiệp vụ: `LECTURER`, `FACULTY_LEADER` và vai trò quản trị có tên chính thức được chốt tại hard gate.
4. Ánh xạ tài khoản lãnh đạo với một hoặc nhiều đơn vị được giao phụ trách theo quyết định đã phê duyệt.
5. Quản lý session an toàn, hỗ trợ thu hồi session khi tài khoản bị đình chỉ, vô hiệu hóa hoặc thay đổi quyền quan trọng.
6. Bảo vệ route và thực thi authorization ở server cho mọi thao tác đọc hoặc quản trị.
7. Bảo đảm giảng viên chỉ xem dữ liệu gắn với `lecturer_uid` của mình, lãnh đạo chỉ xem dữ liệu thuộc đơn vị được giao và admin chỉ thực hiện các chức năng quản trị được cho phép.
8. Ghi audit cho đăng nhập và thay đổi quyền mà không lưu secret hoặc dữ liệu xác thực nhạy cảm trong log.

## 2. Hard gate — Authentication and identity decisions

### 2.1 Trạng thái hiện tại

Hard gate đang `BLOCKED`. Không được cài thư viện authentication hoặc bắt đầu triển khai cho đến khi cả bảy quyết định dưới đây có câu trả lời rõ ràng, có người có thẩm quyền xác nhận và được ghi nhận bằng tài liệu quyết định.

Tài liệu Giai đoạn 0 từng đề xuất tài khoản nội bộ cho phiên bản đầu và dùng tên vai trò `SYSTEM_ADMIN`, nhưng hồ sơ vẫn ở trạng thái Draft. Đề xuất đó là đầu vào để xem xét, không được tự động coi là phê duyệt. Phạm vi Giai đoạn 3 hiện gọi vai trò là `ADMIN`; tên canonical giữa `ADMIN` và `SYSTEM_ADMIN` phải được chốt trước khi tạo enum, dữ liệu seed hoặc logic phân quyền.

| Mã | Quyết định bắt buộc | Trạng thái | Bằng chứng cần có |
| --- | --- | --- | --- |
| HG3-01 | Đăng nhập bằng tài khoản nội bộ hay SSO? | OPEN | Phương án được phê duyệt, chủ sở hữu và ràng buộc vận hành |
| HG3-02 | Có sử dụng Google Workspace/VNU account không? | OPEN | Nhà cung cấp danh tính, tenant/domain và đầu mối xác nhận |
| HG3-03 | Email nào là định danh đăng nhập chính thức? | OPEN | Quy tắc chọn, chuẩn hóa, uniqueness và xử lý thay đổi email |
| HG3-04 | Sáu đơn vị đang thiếu lãnh đạo/email được xử lý thế nào? | OPEN | Danh sách đã xác nhận hoặc quy tắc khóa quyền an toàn cho đơn vị chưa gán |
| HG3-05 | Ai có quyền admin ban đầu? | OPEN | Danh tính người được phê duyệt và quy trình bootstrap/recovery an toàn |
| HG3-06 | Lãnh đạo có thể phụ trách nhiều đơn vị hay không? | OPEN | Cardinality và quy trình gán/thu hồi đơn vị được phê duyệt |
| HG3-07 | Một giảng viên có thể có nhiều email hay không? | OPEN | Cardinality, email chính/phụ và quy tắc đăng nhập/liên kết được phê duyệt |

Quyết định về tên canonical của vai trò quản trị (`ADMIN` hoặc `SYSTEM_ADMIN`) phải được ghi cùng hồ sơ hard gate trước khi thiết kế schema RBAC.

### 2.2 Điều kiện `PASS`

Hard gate chỉ đạt `PASS` khi đồng thời đáp ứng tất cả điều kiện sau:

- Cả HG3-01 đến HG3-07 đều có câu trả lời không mâu thuẫn với nhau.
- Mỗi quyết định ghi rõ người xác nhận, ngày xác nhận và phạm vi áp dụng.
- Cơ chế đăng nhập được chốt đủ chi tiết để đánh giá thư viện phù hợp, session lifecycle và yêu cầu secret.
- Quy tắc email nêu rõ chuẩn hóa, uniqueness, thay đổi email, email chính/phụ và xử lý xung đột.
- Danh sách hoặc phương án xử lý an toàn cho cả sáu đơn vị trong `docs/phase-0/05_approval_units.csv` được xác nhận.
- Admin bootstrap được xác định mà không đưa password, token, secret hoặc dữ liệu xác thực vào Git.
- Cardinality tài khoản–giảng viên–email–đơn vị lãnh đạo được chốt.
- Tên canonical của cả ba vai trò được chốt và không còn khác biệt giữa tài liệu, schema và code dự kiến.
- Thiết kế vẫn giữ `user_id` và `lecturer_uid` là hai định danh riêng, bất biến.
- Có review của đại diện nghiệp vụ, quản trị tài khoản và an toàn thông tin phù hợp.

### 2.3 Quy tắc dừng

- Không cài dependency authentication khi hard gate chưa `PASS`.
- Không tạo schema hoặc migration cho tài khoản, identity provider, role, session hay audit khi cardinality và cơ chế đăng nhập chưa được chốt.
- Không tạo admin mặc định bằng email suy đoán hoặc credential hard-code.
- Không tạo tài khoản hoặc liên kết `lecturer_uid` hàng loạt từ email nguồn nếu chưa có quy tắc đối chiếu được duyệt.
- Không tự điền lãnh đạo hoặc email còn thiếu cho sáu đơn vị.
- Nếu quyết định thay đổi sau khi đã `PASS`, phải đánh giá lại schema, migration, threat model và test plan trước khi tiếp tục.

## 3. Phạm vi Giai đoạn 3

### 3.1 Cơ chế đăng nhập

Sau khi hard gate `PASS`, lựa chọn và cấu hình cơ chế đăng nhập đã được phê duyệt:

- Nếu dùng tài khoản nội bộ: quy định cách mời/kích hoạt tài khoản, lưu trữ password hash theo chuẩn phù hợp, reset/recovery, chống brute force và không lưu mật khẩu tạm trong Git hoặc log.
- Nếu dùng SSO: quy định issuer, client, callback, claim mapping, kiểm tra issuer/audience/state/nonce, xử lý account linking và xung đột danh tính.
- Nếu có lộ trình chuyển đổi giữa hai cơ chế: identity provider phải liên kết với `user_id` hiện có mà không đổi `lecturer_uid` hoặc lịch sử audit.
- Thông báo lỗi đăng nhập không được làm lộ việc một tài khoản hoặc email cụ thể có tồn tại.

Không triển khai đồng thời nhiều phương án chỉ để né quyết định hard gate.

### 3.2 Tài khoản người dùng và ánh xạ danh tính

Thiết kế bảng tài khoản và mapping sau khi cardinality được phê duyệt, tối thiểu đáp ứng:

- `user_id` bất biến và không phụ thuộc email.
- Trạng thái vòng đời tài khoản được chốt rõ; đề xuất Giai đoạn 0 gồm `INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED` phải được xác nhận trước khi mã hóa thành enum hoặc constraint.
- Chỉ tài khoản ở trạng thái được phép mới đăng nhập và sử dụng session.
- Một tài khoản liên kết với tối đa một `lecturer_uid`, trừ khi hard gate đưa ra quyết định khác có migration plan rõ ràng.
- Không có hai tài khoản hoạt động cùng liên kết với một `lecturer_uid` nếu chưa có ngoại lệ được phê duyệt.
- Tài khoản lãnh đạo hoặc admin có thể không liên kết `lecturer_uid` nếu quyết định nghiệp vụ cho phép.
- Người có nhiều vai trò dùng một tài khoản duy nhất; không tạo tài khoản riêng cho từng vai trò.
- Email được chuẩn hóa và kiểm tra xung đột theo đúng quyết định HG3-03 và HG3-07.
- Mapping chưa đủ căn cứ phải ở trạng thái chưa giải quyết và không được cấp quyền truy cập dữ liệu giảng viên.

Mọi schema đề xuất phải được review riêng và không được làm thay đổi mô hình bảng dữ liệu nghiệp vụ Phase 2.

### 3.3 Vai trò và phân quyền

RBAC tối thiểu gồm:

| Vai trò | Phạm vi Phase 3 | Giới hạn bắt buộc |
| --- | --- | --- |
| `LECTURER` | Xem dữ liệu hiện hành gắn với `lecturer_uid` của chính tài khoản | Không xem dữ liệu giảng viên khác; chưa thêm, sửa, xác nhận hoặc submit dòng |
| `FACULTY_LEADER` | Xem dữ liệu thuộc các đơn vị được giao phụ trách | Không xem đơn vị ngoài mapping; chưa phê duyệt hoặc từ chối |
| Vai trò admin canonical | Quản lý tài khoản, trạng thái, role và mapping danh tính/đơn vị | Không mặc nhiên có quyền lãnh đạo; không vượt qua audit hoặc các invariant danh tính |

Một tài khoản có thể có nhiều vai trò nếu hard gate xác nhận mô hình này. Quyền tổng hợp vẫn phải được kiểm tra theo cả role và scope; có role nhưng thiếu scope bắt buộc thì không được truy cập dữ liệu tương ứng.

### 3.4 Ánh xạ lãnh đạo và đơn vị

- Dùng danh mục đơn vị đã được xác nhận làm nguồn canonical; không tin tên đơn vị do trình duyệt gửi lên.
- Mapping lãnh đạo–đơn vị phải tuân theo cardinality được chốt tại HG3-06.
- Tài khoản có role `FACULTY_LEADER` nhưng không có đơn vị hợp lệ không được xem dữ liệu lãnh đạo.
- Sáu đơn vị đang `PENDING_ASSIGNMENT` phải giữ trạng thái khóa an toàn cho tới khi có mapping được phê duyệt.
- Gán, đổi hoặc thu hồi đơn vị phải ghi audit với actor, thời điểm và giá trị trước/sau.
- Không ghi tên lãnh đạo hoặc email thật vào seed/test fixture được commit nếu chưa có quyết định rõ ràng về dữ liệu thử nghiệm.

### 3.5 Session management

Thiết kế session phải bao phủ:

- tạo, xác minh, gia hạn và hết hạn session;
- cookie an toàn và chống CSRF theo cơ chế đăng nhập được chọn;
- session rotation sau đăng nhập hoặc thay đổi mức đặc quyền;
- thu hồi từng session và toàn bộ session của một tài khoản;
- thu hồi session khi tài khoản bị đình chỉ/vô hiệu hóa hoặc khi thay đổi quyền nhạy cảm;
- giới hạn thời gian sống, idle timeout và chính sách đăng nhập lại cho thao tác quản trị;
- không lưu raw token, password hoặc secret trong audit log;
- hành vi nhất quán khi session hợp lệ về chữ ký nhưng tài khoản đã mất quyền hoặc đổi trạng thái.

Giá trị timeout và chính sách concurrent session phải được ghi trong thiết kế kỹ thuật và được review an toàn thông tin.

### 3.6 Bảo vệ route và authorization server-side

- Route không xác thực phải trả về hành vi phù hợp với loại request mà không làm lộ dữ liệu.
- Route protection ở middleware, proxy hoặc UI chỉ là lớp sàng lọc; truy vấn và server action/API vẫn phải authorization lại ở server.
- Mọi truy vấn dữ liệu phải nhận scope từ session đã xác minh và mapping trong database, không nhận `lecturer_uid`, role hoặc đơn vị từ payload làm nguồn thẩm quyền.
- Authorization mặc định là từ chối khi thiếu role, scope, mapping hoặc trạng thái tài khoản hợp lệ.
- Kiểm tra object-level authorization phải được thực hiện trước khi trả dữ liệu hoặc metadata nhạy cảm.
- Không cache hoặc tái sử dụng dữ liệu giữa các scope người dùng theo cách có thể gây rò rỉ chéo.
- Các hàm policy/query scope dùng chung phải được kiểm thử độc lập và tích hợp tại từng entry point.

### 3.7 Phạm vi đọc dữ liệu

#### Giảng viên

- Chỉ đọc các dòng hiện hành thuộc đúng `lecturer_uid` đã liên kết với session.
- Tài khoản chưa có mapping hợp lệ không được xem dữ liệu giảng viên.
- Không cho client chọn `lecturer_uid` khác để mở rộng truy vấn.

#### Lãnh đạo

- Chỉ đọc dữ liệu có đơn vị nằm trong tập đơn vị được gán cho tài khoản.
- Scope đơn vị được backend lấy từ mapping đang hiệu lực.
- Khi mapping bị thu hồi, request tiếp theo phải mất quyền; chính sách thu hồi session phải tuân theo thiết kế đã chốt.

#### Admin

- Chỉ truy cập giao diện và API quản trị sau khi server xác minh role admin canonical.
- Có thể quản lý tài khoản, trạng thái, role, mapping `lecturer_uid` và mapping đơn vị trong phạm vi được phê duyệt.
- Thao tác nguy hiểm phải kiểm tra invariant để tránh mất admin cuối cùng, trùng mapping hoặc cấp quyền không đầy đủ.
- Admin không mặc nhiên được xem hoặc xử lý dữ liệu với tư cách lãnh đạo nếu không có role và unit scope tương ứng.

### 3.8 Audit đăng nhập và thay đổi quyền

Audit tối thiểu ghi nhận:

- đăng nhập thành công và thất bại ở mức không làm lộ credential;
- đăng xuất và thu hồi session;
- tạo, kích hoạt, đình chỉ hoặc vô hiệu hóa tài khoản;
- liên kết, thay đổi hoặc hủy liên kết `lecturer_uid`/identity provider;
- gán hoặc thu hồi role;
- gán hoặc thu hồi đơn vị lãnh đạo;
- thay đổi email hoặc định danh đăng nhập theo chính sách được duyệt;
- actor, action, target, thời điểm, kết quả và correlation metadata cần thiết;
- giá trị trước/sau cho thay đổi quyền, có redaction đối với dữ liệu nhạy cảm.

Audit phải có chính sách retention, quyền đọc và bảo vệ chống sửa/xóa được review. Không commit audit output và không dùng audit log như nơi lưu token, password, session secret hoặc raw credential.

## 4. Ngoài phạm vi

- Giảng viên thêm dòng mới.
- Giảng viên chỉnh sửa hoặc xác nhận dòng để tạo submission.
- Submit phê duyệt.
- Lãnh đạo duyệt hoặc từ chối.
- Tạo phiên bản nghiệp vụ mới sau phê duyệt.
- Hoàn thiện workflow event cho quy trình Phase 4.
- Production deployment.
- Tạo tài khoản người dùng thật trên production.
- Kết nối hoặc thay đổi cấu hình SSO/Google Workspace/VNU production.
- Chạy migration trên production.
- Thay đổi Caddy/reverse proxy production.
- Tự đóng các quyết định hoặc rủi ro còn mở từ Giai đoạn 0.

Các chức năng workflow được chuyển sang Giai đoạn 4 và chỉ được bắt đầu sau khi nền tảng authorization của Giai đoạn 3 đạt nghiệm thu.

## 5. Threat model và yêu cầu kiểm thử

Thiết kế kỹ thuật phải lập threat model tối thiểu cho:

- credential stuffing, brute force và account enumeration;
- session fixation, session theft, CSRF và callback manipulation;
- privilege escalation qua role hoặc unit mapping;
- IDOR/BOLA khi thay đổi `lecturer_uid`, `user_id`, unit hoặc record identifier trong request;
- mass assignment đối với role, trạng thái và mapping;
- tài khoản bị đình chỉ nhưng session cũ còn sử dụng được;
- cache hoặc query làm rò rỉ dữ liệu chéo giữa giảng viên/đơn vị;
- bootstrap admin, mất admin cuối cùng và account recovery;
- audit log injection hoặc ghi dữ liệu nhạy cảm vào log;
- race condition khi gán/thu hồi role hoặc mapping.

Bộ kiểm thử phải có cả trường hợp được phép và bị từ chối, ưu tiên chứng minh không thể vượt scope bằng request được sửa thủ công.

## 6. Checkpoint và tiêu chí nghiệm thu

### CP3-0 — Kế hoạch

- [x] Phạm vi, ngoài phạm vi và hard gate được ghi rõ.
- [x] Không cài thư viện authentication trong bước lập kế hoạch.
- [x] Không tạo schema, migration hoặc mã authentication trong bước lập kế hoạch.
- [x] Không thay đổi bảng dữ liệu nghiệp vụ.
- [x] Không kết nối production.

### CP3-1 — Hard gate quyết định

- [ ] HG3-01: chốt tài khoản nội bộ hay SSO.
- [ ] HG3-02: chốt việc dùng Google Workspace/VNU account.
- [ ] HG3-03: chốt email đăng nhập chính thức và quy tắc chuẩn hóa/xung đột.
- [ ] HG3-04: chốt cách xử lý sáu đơn vị thiếu lãnh đạo/email.
- [ ] HG3-05: chốt admin ban đầu và bootstrap/recovery.
- [ ] HG3-06: chốt một lãnh đạo có thể phụ trách bao nhiêu đơn vị.
- [ ] HG3-07: chốt một giảng viên có thể có bao nhiêu email.
- [ ] Chốt tên canonical của vai trò admin.
- [ ] Có bằng chứng xác nhận của các bên có thẩm quyền.

**Điều kiện chuyển checkpoint:** Toàn bộ CP3-1 phải đạt trước khi cài dependency authentication hoặc tạo schema.

### CP3-2 — Thiết kế authentication và threat model

- [ ] Ghi rõ cơ chế đăng nhập, account lifecycle và recovery.
- [ ] Chọn thư viện sau khi đối chiếu quyết định hard gate và tài liệu chính thức của phiên bản framework đang dùng.
- [ ] Hoàn thành threat model và security review.
- [ ] Chốt session lifecycle, timeout, rotation và revocation.
- [ ] Chốt chiến lược secret cho local/test mà không commit secret.

### CP3-3 — Thiết kế dữ liệu identity và RBAC

- [ ] Review schema tài khoản, identity mapping, role, unit scope, session và audit.
- [ ] Chứng minh cardinality và unique constraints khớp quyết định hard gate.
- [ ] Có migration plan và rollback/rehearsal cho môi trường local.
- [ ] Không thay đổi mô hình bảng dữ liệu nghiệp vụ Phase 2.
- [ ] Fixture/seed chỉ dùng dữ liệu giả, không chứa credential hoặc dữ liệu cá nhân thật.

### CP3-4 — Authentication và session

- [ ] Đăng nhập/đăng xuất hoạt động theo cơ chế đã duyệt.
- [ ] Chỉ trạng thái tài khoản hợp lệ được đăng nhập.
- [ ] Session hết hạn, rotation và revocation được kiểm thử.
- [ ] Đình chỉ/vô hiệu hóa tài khoản làm mất quyền sử dụng session theo chính sách.
- [ ] Không có secret hoặc token nhạy cảm trong log, Git hay response.

### CP3-5 — Authorization và data scoping

- [ ] Route bảo vệ từ chối request chưa xác thực.
- [ ] Server kiểm tra role và scope tại mọi entry point.
- [ ] `LECTURER` chỉ đọc dữ liệu của đúng `lecturer_uid` đã liên kết.
- [ ] `FACULTY_LEADER` chỉ đọc dữ liệu của đơn vị được gán.
- [ ] Role lãnh đạo thiếu unit mapping không có quyền đọc dữ liệu lãnh đạo.
- [ ] Admin quản lý account/mapping theo invariant và không mặc nhiên có quyền lãnh đạo.
- [ ] Test IDOR/BOLA và privilege escalation đều bị từ chối.

### CP3-6 — Audit và quản trị tài khoản

- [ ] Audit đăng nhập, session revocation và thay đổi quyền có đủ actor/action/target/result.
- [ ] Audit giá trị trước/sau được redaction phù hợp.
- [ ] Gán/thu hồi role, `lecturer_uid` và unit mapping được kiểm tra invariant.
- [ ] Không thể tạo mapping danh tính trùng hoặc tự khóa admin cuối cùng ngoài quy trình recovery được duyệt.
- [ ] Quyền xem audit và retention được ghi nhận.

### CP3-7 — Nghiệm thu kỹ thuật Phase 3

- [ ] Lint đạt.
- [ ] Typecheck đạt.
- [ ] Test đạt, bao gồm authorization negative tests.
- [ ] Build đạt.
- [ ] Không có `.env`, secret, Excel hoặc audit output bị Git track.
- [ ] Không có thay đổi ngoài phạm vi Phase 3.
- [ ] Không có kết nối hoặc thay đổi production.
- [ ] Tài liệu nghiệm thu ghi rõ các điều kiện Phase 0 còn `OPEN`.

## 7. Điều kiện Giai đoạn 0 tiếp tục `OPEN`

Giai đoạn 3 không tự động đóng các điểm còn mở từ Giai đoạn 0. Đặc biệt:

- Các quyết định nghiệp vụ và identity/access vẫn cần bằng chứng ký xác nhận chính thức.
- Sáu đơn vị hiện chưa có lãnh đạo và email được xác nhận.
- Restore và backup ngoài máy chủ production chưa hoàn thành theo hồ sơ hiện có.
- Backup/restore riêng cho UEB Core chưa được triển khai và kiểm thử.
- Production readiness chưa đạt.

Nếu Phase 3 tạo ra bằng chứng mới, bằng chứng đó chỉ được dùng để cập nhật hồ sơ qua quy trình review riêng; không tự đổi trạng thái các quyết định/rủi ro cũ.

## 8. Thứ tự thực hiện dự kiến

1. Phê duyệt kế hoạch Phase 3.
2. Trả lời và xác nhận HG3-01 đến HG3-07; chốt tên canonical của vai trò admin.
3. Dừng tại hard gate cho đến khi toàn bộ CP3-1 đạt `PASS`.
4. Đọc tài liệu framework hiện có trong `node_modules/next/dist/docs/` và tài liệu chính thức của thư viện ứng viên trước khi thiết kế hoặc viết code.
5. Lập threat model, thiết kế authentication/session và chọn thư viện.
6. Review schema identity/RBAC/session/audit mà không thay đổi bảng dữ liệu nghiệp vụ.
7. Tạo migration và fixture dữ liệu giả cho môi trường local.
8. Triển khai authentication, session lifecycle và route protection.
9. Triển khai policy server-side và query scoping cho giảng viên, lãnh đạo và admin.
10. Triển khai quản trị tài khoản/mapping và audit trong đúng phạm vi Phase 3.
11. Chạy negative security tests, toàn bộ quality gates và rà soát file cấm.
12. Lập biên bản nghiệm thu Phase 3, giữ workflow và production ngoài phạm vi.

Không bước nào trong thứ tự trên cho phép cài thư viện trước khi hard gate đạt `PASS`, triển khai workflow Phase 4 hoặc kết nối production khi chưa có yêu cầu và phê duyệt riêng.
