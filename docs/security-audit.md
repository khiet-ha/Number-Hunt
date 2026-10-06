# Security audit policy

CI (`ci.yml › audit`) và workflow hằng tuần (`audit-schedule.yml`) chạy `pnpm audit`.

## Chặn và báo cáo

- **Chặn merge**: chỉ advisory **high/critical** ở cây dependency **production** (`pnpm audit --prod`). Đây là phần thực sự nằm trong bundle của site.
- **Chỉ báo cáo**: toàn bộ cây (gồm dev tooling: eslint, vitest, playwright, semantic-release…) — bảng markdown ở job summary và issue `security-audit`.
- Registry advisory lỗi không chặn merge (`--ignore-registry-errors`); lưới an toàn là workflow hằng tuần.

## Advisory được chấp nhận rủi ro

Khai báo trong `package.json › pnpm.auditConfig.ignoreGhsas`, mỗi mục phải có dòng tương ứng dưới đây.

| GHSA        | Package | Lý do chấp nhận | Rà lại trước |
| ----------- | ------- | --------------- | ------------ |
| _(chưa có)_ |         |                 |              |
