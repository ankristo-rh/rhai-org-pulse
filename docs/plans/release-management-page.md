# Release Registry Management Page — Implementation Plan

## Requirements Summary (from user)

- **Auto-discover first**: Product Pages discovery is the primary entry point; manual create is fallback
- **Archived releases**: Hidden by default, toggle/filter to show them
- **No bulk ops**: One release at a time
- **Nav item**: "Registry" at the top of the releases module nav, visible only to `release-manager` (and admins)
- **Discovery UX**: One-click import all, with summary afterward (no per-release selection)
- **List detail**: Full detail — all fields visible including phases, with expandable rows

## Architecture Analysis

### What exists

- Backend registry CRUD + auto-discover is fully implemented (`modules/releases/server/registry.js`)
- `ReleaseSelector.vue` reads registry data (reusable pattern for API calls)
- `release-manager` role exists in the RBAC system (`shared/server/auth.js:223`)
- `requireReleaseManager` middleware gates all write endpoints
- Demo fixture at `fixtures/releases/registry.json` with 3 releases (2 active, 1 archived)

### What's missing

1. **No generic `requireRole` support in sidebar nav filtering** — `AppSidebar.vue:401-408` hardcodes checks for `team-admin` and `manager`. Adding more roles this way doesn't scale.
2. **No `roles` prop on AppSidebar** — App.vue passes individual boolean props per role instead of the roles array.
3. **No Registry view component** — Need to create the page itself.
4. **No nav item in module.json** — Need to add "Registry" entry with `requireRole: "release-manager"`.
5. **Missing icons in `ICON_MAP`** — `Database` (needed for Registry) and `Rocket` (used by Deliver nav item) are both absent, causing Deliver to fall back to the default icon.

## Files to Modify

### 1. `src/components/AppSidebar.vue` — Generic role filtering (replaces prop-drilling)

Instead of adding another per-role boolean prop, replace the hardcoded role checks with a generic `roles` array prop:

- **Add prop**: `roles: { type: Array, default: () => [] }`
- **Remove**: `isReleaseManager` prop (never add it — avoid the anti-pattern)
- **Keep existing**: `isTeamAdmin`, `isManager`, `isAdmin` props (used for non-`requireRole` logic elsewhere; removing them is a separate refactor)
- **Replace** the nav item `requireRole` filter block (lines 402-408) with:
  ```js
  .filter(item => {
    if (item.requireCondition === 'in-app-mode' && props.teamDataSource !== 'in-app') return false
    if (!item.requireRole) return true
    if (props.isAdmin) return true
    if (props.roles.includes(item.requireRole)) return true
    // Fallback: team-admin sees manager items too
    if (item.requireRole === 'manager' && (props.isTeamAdmin || props.isManager)) return true
    if (item.requireRole === 'team-admin' && props.isTeamAdmin) return true
    return false
  })
  ```
  This makes ANY `requireRole` value in `module.json` work automatically via the `roles` array, while preserving the existing `manager` -> `team-admin` escalation logic.
- **Add icons** to lucide-vue-next imports and `ICON_MAP`: `Database`, `Rocket`, and lowercase alias `'rocket': Rocket` (matching the pattern used by existing aliases like `'bar-chart': BarChart3`). The lowercase alias is needed because `module.json` uses `"icon": "rocket"` (lowercase) for the module section header.

### 2. `src/components/App.vue`

- Destructure `roles` from `useAuth()`:
  ```js
  const { user: authUser, isAdmin: authIsAdmin, isTeamAdmin: authIsTeamAdmin, roles: authRoles, refresh: refreshAuth } = useAuth()
  ```
- Pass to AppSidebar:
  ```html
  <AppSidebar :roles="authRoles" ... />
  ```
- Add `authRoles` to the `return` block.
- No new per-role computed or prop needed.

### 3. `modules/releases/module.json`

Add nav item at the **top** of the `navItems` array (before "Plan"):

```json
{ "id": "registry", "label": "Registry", "icon": "Database", "requireRole": "release-manager" }
```

### 4. `modules/releases/client/index.js`

Add route entry:

```js
'registry': defineAsyncComponent(() => import('./views/RegistryView.vue')),
```

### 5. `modules/releases/client/components/ReleasesSettings.vue`

Remove both the "Release Registry" placeholder section (lines 54-59) AND the "Planning" placeholder section (lines 60-65), since registry now has its own page and leaving one placeholder while removing the other is inconsistent.

### 6. `shared/client/composables/useAuth.js`

No changes needed. The `roles` computed is already exported (line 32: `const roles = computed(() => user.value?.roles || [])`). The sidebar's `props.isAdmin` check (line 405) handles admin bypass, and the `roles` array handles specific role membership. No `isReleaseManager` computed needed.

## Files to Create

### `modules/releases/client/views/RegistryView.vue` (NEW)

This is the main page component. Layout:

```
+--------------------------------------------------+
|  Release Registry                    [Discover]   |
|  ------------------------------------------------ |
|  [Show archived [ ]]                              |
|                                                   |
|  +---------------------------------------------+ |
|  | RHOAI 2.15        Active    GA: 2026-09-01  | |
|  | Fix versions: RHOAI-2.15, rhoai-2.15        | |
|  | Code Freeze: 2026-08-01                     | |
|  | Product Pages: red_hat_openshift_ai / 2.15  | |
|  | Created: 2026-05-01  Updated: 2026-05-01    | |
|  |                              [Edit] [Archive]| |
|  +---------------------------------------------+ |
|  +---------------------------------------------+ |
|  | RHOAI 2.14  [Archived]                      | |
|  |                              [Edit] [Restore]| |
|  +---------------------------------------------+ |
|                                                   |
|                              [+ New Release]      |
+---------------------------------------------------+
```

### Component responsibilities

- Fetch registry via `apiRequest('/modules/releases/registry')`
- Display releases as cards showing all fields:
  - id, displayName, fixVersions (as comma-separated tags), productPagesShortname, productPagesVersion
  - milestones displayed as a definition list with human-readable labels (see Milestone UX below)
  - state badge (green for active, gray for archived)
  - createdAt, updatedAt formatted as locale date strings
- **"Show archived" toggle** — checkbox that filters `state === 'archived'` releases in/out (hidden by default)
- **"Discover" button** — calls `POST /modules/releases/registry/discover`, shows inline status message with result summary (discovered count, created count), re-fetches list
- **"Edit" button** per release — inline edit form within the card (see Inline Edit UX below)
- **"Archive" button** on active releases — calls `DELETE /registry/:id` with confirmation dialog, re-fetches
- **"Restore" button** on archived releases — calls `PUT /registry/:id` with `{ state: 'active' }`, re-fetches. The PUT endpoint already supports changing `state`.
- **"+ New Release" button** — shows inline create form at the top of the list

### Milestone UX (scoped down)

Milestones are a free-form object with arbitrary keys. The full key-value editor (add/remove rows, arbitrary keys) is complex and not needed for V1.

**V1 approach — fixed common fields:**

The create/edit form shows 3 fixed date inputs for the most common milestones:
- Code Freeze (`codeFreeze`)
- EA1 (`ea1`)
- GA (`ga`)

Each is an `<input type="date">` field. Empty fields are omitted from the stored object. Any additional milestones that exist in the data (e.g., from auto-discover) are displayed read-only in the card view.

**Future enhancement:** A full key-value editor with add/remove row support can be added later if users need arbitrary milestone keys.

### Inline edit UX

When "Edit" is clicked:
- The card expands to show the edit form in-place, replacing the display content
- The card scrolls into view if not fully visible (`element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`)
- Only one card can be in edit mode at a time (opening another closes the current)
- "Save" and "Cancel" buttons at the bottom of the form
- The `id` field is read-only during edit (shown as a label, not an input)

### Create form

The create form appears as a new card at the top of the list with:
- `id` — text input (required, validated against pattern `^[a-z0-9][a-z0-9._-]*$`)
- `displayName` — text input (required)
- `fixVersions` — text input, comma-separated. Split on commas, trim whitespace, filter empty strings before sending to API as an array. Example: `"RHOAI-2.15, rhoai-2.15"` -> `["RHOAI-2.15", "rhoai-2.15"]`
- `productPagesShortname` — text input (optional)
- `productPagesVersion` — text input (optional)
- Milestone date fields (codeFreeze, ea1, ga) — date inputs (optional)

### State management

Local component state only (no composable needed). Uses `apiRequest` from `@shared/client/services/api`.

### Component extraction

If the card rendering + inline edit exceeds ~200 lines of template, extract a `RegistryReleaseCard.vue` component into `modules/releases/client/components/`. Start monolithic, extract only if needed.

## What Doesn't Change

- **No backend changes** — all CRUD + discover endpoints already exist and are properly gated. The PUT endpoint already accepts `state` changes, enabling the Restore flow.
- **No new API endpoints** — the existing registry API is complete
- **No changes to demo fixtures** — existing `fixtures/releases/registry.json` provides test data. Demo user is an admin (via `ADMIN_EMAILS` seeding or first-user auto-add), so the sidebar `props.isAdmin` check bypasses `requireRole` — no `fixtures/roles.json` needed.
- **No changes to `shared/server/`** — RBAC and auth already handle `release-manager`

## Known Limitations

1. **Auto-discover `productPagesShortname` heuristic is fragile.** The discover endpoint (`registry.js:366`) uses `releaseNumber.split('-')[0]` to infer the shortname, which may produce incorrect values (e.g., `"rhoai"` instead of `"red_hat_openshift_ai"`). This is a pre-existing issue in the discover endpoint, not introduced by this plan. The edit form allows manual correction after discovery. A future improvement could use the Product Pages API to look up the canonical shortname.

2. **Milestones V1 only supports 3 fixed keys** (codeFreeze, ea1, ga). Additional milestones from auto-discover are displayed read-only. This is a deliberate scope decision — the arbitrary key-value editor can be added in a follow-up.

## Edge Cases

1. **Empty registry**: Show empty state with prominent "Discover from Product Pages" CTA and secondary "Create manually" link
2. **Discovery errors** (no auth configured, no shortnames): Show the error message from the API response in an inline alert below the Discover button
3. **Duplicate ID on create**: API returns 400 — show validation error inline below the id field
4. **Milestone display**: Render as a definition list with human-readable labels:
   - `codeFreeze` -> "Code Freeze"
   - `ea1` -> "EA1"
   - `ga` -> "GA"
   - Any other key -> title-cased key name
5. **Dark mode**: Use existing Tailwind `dark:` classes consistent with other views
6. **Restoring archived releases**: Archived releases show a "Restore" button instead of "Archive". Clicking calls `PUT /registry/:id` with `{ state: 'active' }`.

## Testability

- **Unit tests**: RegistryView can be tested with `@vue/test-utils` + mocked `apiRequest`. Test: list rendering, archive toggle visibility, create form validation (id pattern, required fields), discover button loading state, restore button on archived cards.
- **Integration tests**: Add to `tests/integration/releases.spec.js` following the existing `testView()` pattern:
  ```js
  test('should load Registry view', async ({ page }) => {
    await testView(page, 'registry', 'Registry');
  });
  ```
  The Registry nav item is visible in demo mode because the demo user is an admin, and the sidebar filter (`AppSidebar.vue:405`) returns `true` for all `requireRole` items when `props.isAdmin` is true. No fixture changes needed.
- **Demo mode**: Existing `fixtures/releases/registry.json` provides test data with no config needed. The 3 fixture releases (2 active, 1 archived) exercise both states.

## Deployability

- No new env vars required
- No database/storage migrations
- Nav item is role-gated — invisible to users without `release-manager` role, so zero impact on existing users
- Settings placeholder removal is cosmetic only
- CI change detection already covers all modified paths (`modules/*/client/`, `modules/*/module.json`, `src/`, `shared/client/`)

## Backward Compatibility

- Existing `ReleaseSelector.vue` is unchanged (it reads from the same registry API)
- No API contract changes — all endpoints remain identical
- The settings page still works (minus the placeholder text sections)
- Users without `release-manager` role see no difference
- Adding the `roles` prop to AppSidebar is additive — existing `isAdmin`, `isTeamAdmin`, `isManager` props continue to work. The `roles` prop defaults to `[]` so if not passed, existing behavior is preserved.

## Execution Order

Single phase — this is a self-contained feature with no dependencies on other work:

1. Add `roles` prop to AppSidebar, replace hardcoded role checks with generic filter, add `Database` + `Rocket` icons
2. Pass `roles` from App.vue -> AppSidebar
3. Add "Registry" nav item to `module.json`
4. Create `RegistryView.vue` with full CRUD + discover + restore
5. Add route to `client/index.js`
6. Remove placeholder sections from `ReleasesSettings.vue`
7. Run lint + tests

**Estimated file count**: 5 modified (AppSidebar.vue, App.vue, module.json, client/index.js, ReleasesSettings.vue), 1 created (RegistryView.vue). No backend changes.
