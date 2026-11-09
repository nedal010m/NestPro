# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Ownership (`/projects/{projectId}` & `/presets/{presetId}`)**:
   - Every document in `/projects/{projectId}` and `/presets/{presetId}` must have `ownerId == request.auth.uid`.
   - Only authenticated users with `request.auth.token.email_verified == true` may create, update, or delete documents.
   - `ownerId` and `createdAt` are immutable once created (`incoming().ownerId == existing().ownerId && incoming().createdAt == existing().createdAt`).
2. **Temporal Integrity**:
   - On `create`: `incoming().createdAt == request.time && incoming().updatedAt == request.time`.
   - On `update`: `incoming().updatedAt == request.time`.
3. **Path Variable & Volumetric Bounds**:
   - Document IDs (`projectId`, `presetId`) must match `^[a-zA-Z0-9_\-]+$` and `.size() <= 128`.
   - `NestProject.name` is a string with `1 <= size() <= 120`.
   - `NestProject.shapes` is a list with `size() <= 100`.
   - `NestProject.placements` is a list with `size() <= 500`.
   - `SheetPreset.label` is a string with `1 <= size() <= 60`.
4. **Query Enforcer (`allow list`)**:
   - `allow list` on `/projects` and `/presets` strictly checks `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Create**: Creating a project with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Create**: Creating a project with `email_verified == false` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: Setting `ownerId: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Create**: Including an extra undeclared field `isAdmin: true` in `/projects/{projectId}` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Update**: Updating a project with an undeclared key `hacked: 1` -> `PERMISSION_DENIED`.
6. **Owner Transfer on Update**: Mutating `ownerId` during `update` -> `PERMISSION_DENIED`.
7. **Timestamp Forgery on Create**: Providing a client-crafted `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
8. **CreatedAt Mutation on Update**: Changing `createdAt` during an `update` operation -> `PERMISSION_DENIED`.
9. **ID Poisoning**: Creating `/projects/invalid$id!with*bad^chars` -> `PERMISSION_DENIED`.
10. **Oversized String / Array Denial-of-Wallet**: Creating a project with `name.size() > 120` or `shapes.size() > 100` -> `PERMISSION_DENIED`.
11. **Cross-Tenant Read (`get`)**: Reading `/projects/{projectId}` where `resource.data.ownerId != request.auth.uid` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping (`list`)**: Listing `/projects` without filtering by `ownerId == request.auth.uid` -> `PERMISSION_DENIED`.

## 3. Red Team Conflict Audit Report
- **Identity Spoofing**: Blocked by `data.ownerId == request.auth.uid` in `isValidNestProject` and `isValidSheetPreset`.
- **State Shortcutting / Update Gap**: Blocked because `allow update` begins with `isValidNestProject(incoming())` AND checks `affectedKeys().hasOnly(...)` plus immutability of `ownerId` and `createdAt`.
- **Resource Poisoning**: Blocked by `isValidId()` on path variables and `.size()` limits on every string, map, and list field.
- **Value Poisoning**: Blocked because `isValid[Entity](incoming())` runs on every `create` and `update`.
