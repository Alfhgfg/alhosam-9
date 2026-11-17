# Security Specification - بقالة الحسام (Al-Hussam Multi-Device Store Accounting & POS)

## 1. Data Invariants
1. **Verified Identity**: All authenticated operations require `request.auth != null && request.auth.token.email_verified == true`.
2. **No Self-Promotion / Privilege Escalation**: A non-admin user creating `/users/{uid}` can only create their own document (`uid == request.auth.uid`) with `role: 'pending', status: 'pending'`, or claim an active `/staff_invites/{inviteId}` whose lowercase `email == request.auth.token.email.lower()` and matching `role` and `permissions`. Employees can NEVER modify `role`, `status`, or `permissions` on `/users/{uid}` or create `/admins/{uid}`.
3. **Suspended Staff Lockdown**: Any user with `status == 'suspended'` or `'pending'` in `/users/{uid}` is immediately denied all reads/writes to store operational collections (`products`, `customers`, `sales`, `purchases`, `returns`, `stock_movements`, `expenses`, `vouchers`, `cash_transactions`, `devices`, `processed_operations`).
4. **Device Enforcement & Remote Revocation**: Every operational write (`sales`, `purchases`, `returns`, `stock_movements`, `expenses`, `vouchers`, `cash_transactions`, `audit_logs`, `processed_operations`) MUST reference a valid `deviceId` whose `/devices/{deviceId}` document exists and has `status == 'active'`. Only admins can block/unblock devices, and blocked devices cannot self-reactivate or write any operational records.
5. **Idempotency & Duplicate Prevention**: `/processed_operations/{operationId}` is create-only and immutable (`update: false, delete: false`). Transactions check its existence atomically to prevent duplicate invoices or double stock/cash deductions across network retries and offline sync.
6. **Sales Scope Enforcement**: Employees without `canViewAllSales` permission can only read/list `sales` where `resource.data.employeeId == request.auth.uid` (enforced inside `allow get` and `allow list`, never delegated to the client). Admins and permitted employees can read all sales.
7. **No Unauthorized Deletions or Price/Finance Tampering**: Employees cannot delete sales, purchases, returns, vouchers, expenses, cash transactions, devices, or audit logs. Employees cannot modify `costPrice` or `sellPrice` on existing products unless granted `canManageProducts`.
8. **Immutable Audit Trail**: `/audit_logs/{logId}`, `/stock_movements/{movementId}`, `/cash_transactions/{txId}`, and `/processed_operations/{operationId}` are append-only; `update` and `delete` are forbidden for non-admin users (and `audit_logs` and `processed_operations` are immutable even for admins).
9. **Server Timestamps**: `createdAt`, `updatedAt`, and `lastActiveAt` are strictly validated against `request.time`.
10. **Strict Key & Size Limits**: Every document write validates `keys().hasAll(...)` and `keys().hasOnly(...)`, string length bounds, numeric non-negativity where applicable, and bounded `items` arrays (`size() >= 1 && size() <= 100`).

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Self-Admin Escalation**: Employee posts `/users/{myUid}` with `role: "admin", status: "active"`.
2. **Ghost Field Injection**: Employee creates `/customers/c1` with extra shadow field `isVerified: true` or `creditLimit: 999999`.
3. **Email Spoof Attack**: Unverified user (`email_verified: false`) with admin email attempts to read `/users` or write `/products`.
4. **Employee Deleting Sale Invoice**: Active employee calls `delete` on `/sales/sale_1`.
5. **Employee Altering Audit Log**: Active employee calls `update` or `delete` on `/audit_logs/log_1`.
6. **Employee Overriding Own Permissions**: Active employee calls `update` on `/users/{myUid}` changing `permissions.canDiscount` to `true`.
7. **Employee Scraping Other Staff Sales**: Employee without `canViewAllSales` runs `list` on `/sales` without `where('employeeId', '==', myUid)` (or tries `get` on another employee's sale).
8. **Suspended Employee Sale**: Suspended user (`status: "suspended"`) attempts to create `/sales/sale_x`.
9. **Client Timestamp Forgery**: Employee creates `/sales/sale_x` with backdated `createdAt` (`2020-01-01`).
10. **ID Poisoning / Resource Exhaustion**: User creates `/products/<1500_char_id>` or `/customers/c1` with a 5000-character `name`.
11. **Unauthorized Product Price Change**: Cashier without `canManageProducts` updates `/products/p1` changing `sellPrice` or `costPrice`.
12. **Blocked Device Write & Self-Unblock**: Employee on a device with `/devices/{devId}.status == 'blocked'` attempts to create `/sales/sale_x` or update `/devices/{devId}` back to `status: 'active'`.
13. **Operation Replay Tampering**: Employee attempts to `update` or `delete` `/processed_operations/{opId}` to replay an invoice.
