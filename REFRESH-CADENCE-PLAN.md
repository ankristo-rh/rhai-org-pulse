# Refresh Cadence — Implementation Plan

## Summary

Add per-handler refresh cadence to the refresh registry, enabling the CronJob
to fire every 15 minutes while each handler controls how often it actually runs.
Eliminate the execution scheduler's independent `setInterval` in favor of the
unified cadence system. Update the existing RefreshSettings admin UI to display
and manage cadence values.

## Background

The platform's refresh registry (`shared/server/refresh-registry.js`) supports
`runAll()` which executes all 13 registered handlers every time the CronJob
fires (currently daily at 6 AM UTC). The releases/execution sub-domain works
around this by running its own `setInterval`-based scheduler for 12h artifact
fetches.

This creates two problems:
1. Handlers that need more frequent updates (like execution pipeline) can't use
   the unified system
2. The independent scheduler duplicates mutex/cooldown logic and runs outside
   the admin UI's visibility

## Design

### Cadence Model

Each handler declares a `cadence` value at registration time. On each
`runAll()` invocation, the registry checks `now - lastSuccessfulRun >= cadenceMs`
for each handler and skips those that aren't due yet.

**Cadence values** are strings parsed to milliseconds:

| Format | Example | Meaning |
|--------|---------|---------|
| `'Nm'` | `'15m'` | N minutes |
| `'Nh'` | `'12h'` | N hours |
| `'Nd'` | `'1d'`  | N days |

Default cadence (when not specified): `'24h'`.

A `parseCadence(str)` utility converts these to milliseconds. Invalid values
throw at registration time (fail fast, not at runtime). Zero values (`'0h'`,
`'0m'`) are rejected — minimum declared cadence is `'1m'`. Admin overrides
enforce a `'15m'` floor (prevents accidental API abuse from too-frequent
refreshes).

**Tick alignment drift**: With a 15-min CronJob and a 24h cadence, a handler
will run approximately once per day, but the exact time drifts by up to 15
minutes per cycle (e.g., runs at 6:00, then 6:15 the next day, then 6:15 the
day after that). This is expected and acceptable — exact timing is not required.

### Handler Cadence Table

| Handler ID | Module | Order | Default Cadence | Notes |
|---|---|---|---|---|
| team-tracker:roster-sync | team-tracker | 10 | 24h | LDAP + Google Sheets |
| team-tracker:metrics | team-tracker | 20 | 24h | Per-person Jira stats, heavy |
| team-tracker:github | team-tracker | 30 | 24h | GitHub GraphQL contributions |
| team-tracker:gitlab | team-tracker | 30 | 24h | GitLab GraphQL contributions |
| team-tracker:allocation | team-tracker | 40 | 24h | Sprint allocation data |
| ai-impact:refresh | ai-impact | 50 | 24h | AI Impact assessments |
| ai-impact:feature-sync | ai-impact | 60 | 24h | Feature sync from Jira |
| ai-impact:test-plan-sync | ai-impact | 60 | 24h | Test plan sync from Jira |
| releases:registry-sync | releases | 65 | 24h | Release registry sync |
| releases:execution | releases | 70 | 12h | From config `refreshIntervalHours` |
| releases:delivery | releases | 70 | 24h | Delivery metrics |
| releases:hygiene | releases | 70 | 24h | Feature hygiene rules |
| team-tracker:snapshots | team-tracker | 80 | 24h | Team snapshots |
| platform:backup | platform | 200 | 24h | S3 data backup (new, registered in dev-server.js) |

### State Tracking

`refresh-registry-state.json` currently stores per-handler `completedAt` (set
for both success and failure). Changes:

1. Add `lastSuccessfulRun` (timestamp) — set only on successful completion
2. Add `cadence` (string, e.g. `'24h'`) — the declared cadence value
3. Add `cadenceOverride` (string or null) — admin override from the UI
4. Add `skippedAt` (timestamp) — when the handler was last skipped due to cadence

The cadence check uses: `now - lastSuccessfulRun >= effectiveCadenceMs` where
`effectiveCadence = cadenceOverride || declaredCadence`.

**Missing `lastSuccessfulRun` = immediately due**: If `lastSuccessfulRun` is
`null` or `undefined` (handler never run, or first deploy with new state format),
the handler is considered immediately due. The code must NOT compute
`now - undefined` (which produces `NaN`, and `NaN >= X` is always `false`,
meaning the handler would be incorrectly skipped). Additionally, if
`lastSuccessfulRun` is in the future (clock skew, corrupted state), treat it
as immediately due to prevent handlers from being permanently skipped:
```js
const now = Date.now();
if (lastSuccessfulRun == null || lastSuccessfulRun > now) return true; // due now
return (now - lastSuccessfulRun) >= effectiveCadenceMs;
```

**`completedAt` semantics unchanged**: The existing `completedAt` field continues
to be set for both successful and failed handler runs (no change). Only the new
`lastSuccessfulRun` field is success-only. A handler that fails will have a
recent `completedAt` but an old (or missing) `lastSuccessfulRun`, so it will be
retried on the next tick. This is intentional — failed handlers should retry
sooner, not wait a full cadence cycle.

**`lastSuccessfulRun` for handlers returning `{ status: 'skipped' }`**: A handler
that returns without throwing (even if it returns `{ status: 'skipped' }` because
it's disabled or fetch is already in progress) IS considered a successful run.
`lastSuccessfulRun` is updated. This is correct — a disabled handler that returns
"skipped" should not retry every 15 minutes. The handler explicitly decided to
do nothing; the cadence system should respect that decision.

### Admin Cadence Overrides

Admins can override the cadence for any handler from the RefreshSettings UI.
Overrides are stored in a separate file `refresh-cadence-overrides.json` (not
mixed into handler state, since handler state is rewritten on every run).

```json
{
  "releases:execution": "6h",
  "team-tracker:metrics": "12h"
}
```

The registry loads this file at startup via `readFromStorage()` which returns
`null` for missing files — the registry defaults to an empty object (`{}`),
meaning no overrides. The API endpoint `POST /api/admin/refresh-cadence` saves
overrides and the registry reloads them.

**Backup/restore**: Both `refresh-cadence-overrides.json` and
`refresh-registry-state.json` live in `data/` and are included in S3 backups.
On restore, old `lastSuccessfulRun` timestamps may cause all handlers to appear
"due" (if restored timestamps are far in the past) — this is safe, identical to
cold-start behavior. Admin cadence overrides are restored as-is.

### Handler Dependency Model

Handlers have implicit ordering dependencies (roster-sync → metrics → github/gitlab),
but these are **data-file dependencies**, not runtime dependencies. Each handler
reads from and writes to storage files. When roster-sync is skipped by cadence
and metrics runs, metrics operates on the roster data currently on disk — which
is the same data it would use if roster-sync had run and found no changes.

This means cadence skipping is safe even with different cadences on dependent
handlers. The ordering (via `order` field) only matters within a single tick —
when both handlers are due on the same tick, roster-sync runs before metrics.
Admin overrides that give metrics a shorter cadence than roster-sync will cause
metrics to run against the most recent roster data, which is correct behavior.

### runAll() Changes

```
runAll(options = {})
  options.force — boolean, default false. When true, skip cadence checks.
  options.skipCooldown — passed through to handlers (existing behavior)
```

Flow:
1. Acquire mutex (existing)
2. For each handler (sorted by order, grouped for parallel):
   - If `!force`, check cadence: `now - lastSuccessfulRun < effectiveCadenceMs` → skip
   - Otherwise, run handler (existing logic)
3. Update state with `lastSuccessfulRun` for successful handlers, `skippedAt` for skipped ones
4. Release mutex, persist state (existing)

Skipped handlers do NOT appear in the `progress` object as "running" — they
get a `{ state: 'skipped', reason: 'cadence', nextDueAt: <timestamp> }` entry
so the admin UI can show when they'll next run.

### runModule() Changes

`runModule(slug, options)` — no cadence filtering. When an admin explicitly
refreshes a single module, all handlers for that module run regardless of
cadence. This matches the "Refresh" button behavior in the existing UI.

### getStatus() Changes

The status response gains cadence information per handler:

```json
{
  "running": false,
  "completedAt": 1717600000000,
  "handlers": {
    "team-tracker:roster-sync": {
      "state": "completed",
      "order": 10,
      "completedAt": 1717600000000,
      "cadence": "24h",
      "cadenceOverride": null,
      "lastSuccessfulRun": 1717600000000,
      "nextDueAt": 1717686400000
    },
    "releases:execution": {
      "state": "skipped",
      "reason": "cadence",
      "order": 70,
      "cadence": "12h",
      "cadenceOverride": null,
      "lastSuccessfulRun": 1717560000000,
      "nextDueAt": 1717603200000
    }
  }
}
```

### Dynamic Cadence Updates

The execution handler's `refreshIntervalHours` config maps to its cadence.
When config changes via `POST /config`:

1. `onConfigSave()` updates the config as today
2. The execution route re-registers with the new cadence:
   `context.registerRefresh('execution', { ..., cadence: config.refreshIntervalHours + 'h' })`

`register()` already replaces entries in the Map, so re-registration works.
The `startScheduler` / `stopScheduler` calls are removed entirely.

**Concurrent re-registration safety**: If `onConfigSave()` triggers
re-registration while `runAll()` is iterating, the in-flight run is unaffected
because `runAll()` snapshots `Array.from(entries.entries())` at the start. The
new cadence takes effect on the next `runAll()` invocation. This is correct and
intentional — no locking needed.

**Disabled handler interaction**: The execution handler checks `config.enabled`
and returns `{ status: 'skipped' }` when disabled. With cadence, a disabled
handler will still be "due" after its cadence interval and will run — only to
return immediately with "disabled". This is harmless (sub-millisecond no-op) and
keeps the admin UI showing consistent "last run" timestamps. An alternative
would be to unregister the handler on disable, but that adds complexity for no
real benefit.

**Execution `/status` endpoint fix**: The `GET /execution/status` endpoint
(routes.js:245-249) currently computes `nextScheduledFetch` from
`config.refreshIntervalHours`. After this change, the actual cadence may differ
(admin override). Phase 3 should update this field to read the effective cadence
from the refresh registry's `getStatus()` response for `releases:execution`
instead of computing it from config alone.

### Execution Scheduler Elimination

After cadence support lands:

1. **Remove**: `startScheduler()`, `stopScheduler()`, `initScheduler()`,
   `schedulerTimer` variable
2. **Keep**: `runFetch()`, `manualRefresh()`, `loadConfig()`, `saveConfig()`,
   `onConfigSave()`, `validateConfig()`, `isFetchInProgress()`, `init()`,
   mutex (`fetchInProgress`), cooldown (`COOLDOWN_MS`, `lastSuccessfulFetch`)
3. **Modify `onConfigSave()`**: Remove scheduler restart logic. Accept an
   `onCadenceChange(cadenceStr)` callback parameter instead of managing timers.
4. **Modify execution `routes.js`**: Remove the `setTimeout(initScheduler, 5000)` call.
   Define the handler config ONCE in `routes.js` and reuse it for both initial
   registration and re-registration. This avoids the fragility of duplicating
   handler config in two places:
   ```js
   const config = loadConfig(storage);

   // Handler config defined once — single source of truth
   const handlerConfig = {
     order: 70,
     timeout: 600000,
     handler: async function(options) { ... }
   };

   // Initial registration with cadence from config
   context.registerRefresh('execution', {
     ...handlerConfig,
     cadence: config.refreshIntervalHours + 'h'
   });

   // Wire config save to re-register with updated cadence
   scheduler.setOnCadenceChange(function(newCadenceStr) {
     context.registerRefresh('execution', {
       ...handlerConfig,
       cadence: newCadenceStr
     });
   });
   ```
   `onConfigSave()` in `scheduler.js` calls `onCadenceChange(newConfig.refreshIntervalHours + 'h')`
   instead of restarting the scheduler. The handler function and config are
   defined once in `routes.js` — `scheduler.js` never needs access to `context`
   or the handler definition.

### CronJob Changes

**Schedule**: `0 6 * * *` → `*/15 * * * *` (every 15 minutes)

**activeDeadlineSeconds**: Keep at `1800` (30 minutes). The `team-tracker:metrics`
handler has a 30-minute timeout (`timeout: 1800000`). A tighter deadline (e.g.,
840s) would kill the CronJob pod mid-poll while the backend is still running.
Since `runAll()` is fire-and-forget (the POST returns 202 immediately), the
backend completes regardless — but the CronJob would exit non-zero, the backup
step would never run, and k8s would record a failure. With `concurrencyPolicy:
Forbid`, a long-running tick simply blocks the next one. This is acceptable
because heavy ticks (where daily handlers are due) only happen once per day;
the other ~95 ticks/day complete in seconds.

**Polling loop adjustment**: The current CronJob script polls `MAX_ATTEMPTS=120`
x `sleep 15` = 30 minutes. Keep `MAX_ATTEMPTS=120` but reduce sleep to `5`
seconds for faster detection when cadence-skipped runs return instantly. This
yields `MAX_ATTEMPTS=120` x `sleep 5` = 10 min max polling window.

**Poll timeout on heavy ticks**: When daily handlers (e.g., `team-tracker:metrics`,
30-min timeout) are due, the backend may run for 20-30 minutes — longer than the
10-min polling window. The CronJob script must **exit 0 with a warning** when
the poll loop times out, NOT exit non-zero. Rationale: the 202 was accepted, so
the backend is running fine. A poll timeout is not a failure — it just means the
CronJob can't wait for completion. The backend will persist state on completion
regardless of whether the CronJob pod is still alive.

```sh
if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
  echo "WARNING: Refresh still running after polling timeout (backend will complete independently)"
  # Exit 0 — the refresh was accepted, we just can't wait for it
fi
```

This avoids spurious k8s job failures (~once/day when heavy handlers are due).

**Fast-path for no-op ticks**: When all handlers are skipped by cadence,
`runAll()` completes in milliseconds. To enable the CronJob to detect this,
the `POST /api/admin/refresh-all` endpoint is restructured:

1. **Cadence filtering phase** (synchronous/fast): iterate all handlers,
   evaluate cadence, partition into `due` and `skipped` lists. This is pure
   timestamp comparison — sub-millisecond.
2. **Response**: return 202 immediately with skip counts:
   ```json
   { "status": "started", "totalHandlers": 14, "handlersSkipped": 14, "handlersDue": 0 }
   ```
3. **Execution phase** (background): if any handlers are due, run them in
   the background (fire-and-forget, as today). If none are due, `runAll()`
   resolves immediately before the 202 is sent.

Implementation: `runAll()` gains a two-phase return. The first phase
(filtering) is fast and completes before the response. The endpoint awaits
only the filtering phase, captures the counts, sends the 202, then lets
the execution phase continue in the background:

```js
// In refresh-registry.js
async function runAll(options = {}) {
  // ... acquire mutex ...
  const { due, skipped } = filterByCadence(entries, options);
  const counts = { total: entries.size, due: due.length, skipped: skipped.length };

  if (due.length === 0) {
    // Nothing to run — resolve immediately
    running = false;
    persistLastRun();
    return { counts, results: {} };
  }

  // Return counts + a promise for background execution
  const execution = runEntries(due, options).finally(() => {
    running = false;
    persistLastRun();
  });

  return { counts, execution };
}

// In dev-server.js
app.post('/api/admin/refresh-all', ..., async function(req, res) {
  const { counts, execution } = await refreshRegistry.runAll({ ... });
  if (execution) {
    execution.catch(err => console.error(...));
  }
  res.status(202).json({
    status: 'started',
    totalHandlers: counts.total,
    handlersSkipped: counts.skipped,
    handlersDue: counts.due
  });
});
```

The CronJob script checks: if `handlersDue === 0`, skip the polling loop
entirely. This makes ~95% of ticks complete in <5 seconds.

**Script changes**:
- Module sync: runs every tick (it's cheap — just checks git remotes)
- `POST /api/admin/refresh-all`: called WITHOUT force, so cadence filtering
  applies. Response includes skip counts for fast-path optimization.
- Backup: registered as a refresh handler (`platform:backup`, order 200,
  cadence `'24h'`). Runs automatically via `runAll()` when due — the CronJob
  script no longer calls `POST /api/admin/backup` directly. This keeps backup
  within the same cadence system instead of creating a parallel ad-hoc mechanism.
  The `POST /api/admin/backup` endpoint remains available for manual use.

**Why backup is a handler, not a separate cadence check**: The plan introduces a
principled per-handler cadence system. Creating a second, ad-hoc cadence
mechanism for backup (separate `lastBackupAt` storage, different API, different
semantics) would undermine the abstraction. Registering backup as a handler with
`cadence: '24h'` uses the same state tracking, admin override UI, and
diagnostics as everything else.

**Backup mutex sharing**: The manual `POST /api/admin/backup` endpoint has its
own `backupRunning` mutex in `dev-server.js`. The `platform:backup` handler runs
inside `runAll()`'s global mutex, but that doesn't prevent a simultaneous manual
backup call. To avoid concurrent `createBackup()` calls, the handler checks the
existing `backupRunning` flag before proceeding — if a manual backup is
in-flight, the handler returns `{ status: 'skipped', reason: 'backup already in progress' }`
(which still counts as a successful run for cadence purposes).

### Admin UI Updates (RefreshSettings.vue)

Extend the existing `RefreshSettings.vue` component:

1. **Per-handler cadence display**: Show cadence value and next-due time for
   each handler in the handler row
2. **Cadence override control**: Add an edit button/dropdown per handler that
   lets admins set a cadence override. Options: 15m, 1h, 6h, 12h, 24h, or
   "Default" (clears override)
3. **Next run indicator**: Show "Next: 2h 15m" or "Due now" for each handler
4. **Skip indication**: When a handler was skipped on the last tick, show
   "Skipped (not due)" instead of the old status

### API Changes

| Endpoint | Change |
|----------|--------|
| `GET /api/admin/refresh/status` | Response gains `cadence`, `cadenceOverride`, `lastSuccessfulRun`, `nextDueAt` per handler |
| `POST /api/admin/refresh-all` | Now cadence-aware via two-phase `runAll()`. Filtering is synchronous; 202 response includes `totalHandlers`, `handlersSkipped`, `handlersDue`. Execution continues in background. `?force=true` bypasses cadence. |
| `GET /api/admin/refresh-cadence` | **New.** Returns all handler cadence info + overrides |
| `POST /api/admin/refresh-cadence` | **New.** Sets cadence override for a handler. Body: `{ handlerId, cadence }`. `cadence: null` clears override. |
| `POST /api/admin/backup` | Unchanged. Manual backup still available. Automatic backup now handled by `platform:backup` refresh handler with `cadence: '24h'`. |

**Route ordering**: The cadence endpoints use `/api/admin/refresh-cadence`
(hyphenated, not nested under `/refresh/`) to avoid collision with the existing
`POST /api/admin/refresh/:module` parameterized route. The existing
`GET /api/admin/refresh/status` works only because it is registered before the
`:module` route — this ordering constraint is pre-existing and unchanged.

**Important**: The "Refresh All Modules" button in the admin UI should call
`POST /api/admin/refresh-all?force=true` so it bypasses cadence and runs
everything (admin intent is explicit). The CronJob calls without `?force`.

**`force` and `skipCooldown` interaction**: The existing `POST /api/admin/refresh-all`
already passes `skipCooldown: true` to `runAll()`. With this change:
- `?force=true` (admin UI button): passes both `{ force: true, skipCooldown: true }`
  — bypasses cadence AND handler cooldowns. Same as today's behavior.
- No `?force` (CronJob): passes `{ skipCooldown: true }` — cadence filtering
  applies, but handlers that ARE due get `skipCooldown: true` so they don't hit
  the execution handler's 5-min cooldown. This prevents a scenario where a
  manual trigger 3 minutes ago causes the scheduled run to skip.

### Backward Compatibility

- `registerRefresh(id, config)` without `cadence` defaults to `'24h'` — all
  existing callers work unchanged
- `runAll()` without `force` option defaults to cadence-aware (new behavior for
  CronJob). `runAll({ force: true })` restores old "run everything" behavior.
- `runModule()` always runs all handlers (no cadence), preserving existing
  per-module refresh button behavior
- Execution config surface (`enabled`, `refreshIntervalHours`, etc.) preserved
- Manual refresh cooldown in execution scheduler preserved
- All existing API endpoints keep their signatures

## Phased Implementation

### Phase 1: Cadence Infrastructure (refresh-registry.js)

Core cadence logic in the registry:

1. Add `parseCadence(str)` utility function
2. Extend `register()` to accept and store `cadence` option
3. Load cadence overrides from `refresh-cadence-overrides.json` at startup
4. Modify `runAll()` to check cadence, support `force` option
5. Track `lastSuccessfulRun` separately from `completedAt` in state
6. Update `persistLastRun()` to save new fields
7. Enhance `getStatus()` to return cadence info + `nextDueAt`
8. Add `setCadenceOverride(handlerId, cadence)` and `getCadenceOverrides()` methods

**Tests**: Comprehensive unit tests covering:
- Cadence parsing: valid (`'15m'`, `'12h'`, `'1d'`), invalid (`'abc'`, `''`),
  zero (`'0h'` → rejected), boundary (`'1m'` minimum)
- Admin override floor enforcement (`'5m'` → clamped to `'15m'`)
- Handlers skipped when not due; handlers run when due
- `force: true` bypasses cadence for all handlers
- Missing `lastSuccessfulRun` (null/undefined) → handler immediately due
- Failed handlers retry on next tick (`lastSuccessfulRun` not updated on failure)
- Cadence override loading (file exists, file missing → empty, invalid → ignored)
- Dynamic re-registration updates cadence for next run
- State persistence includes `lastSuccessfulRun`, `cadence`, `skippedAt`
- `runModule()` ignores cadence (all handlers for module run)

### Phase 2: Module Handler Updates

Only add explicit `cadence` to handlers with non-default values. Handlers that
want the default 24h cadence don't need any code change — this avoids diff noise
across 8 files and merge conflict risk for zero behavioral change.

1. `modules/releases/server/execution/routes.js` — execution: `cadence: config.refreshIntervalHours + 'h'` (dynamic, from config)

All other handlers (roster-sync, metrics, github, gitlab, allocation, refresh,
feature-sync, test-plan-sync, registry-sync, delivery, hygiene, snapshots) use
the default `'24h'` cadence with no code changes needed.

### Phase 3: Eliminate Execution Scheduler

1. Remove `startScheduler()`, `stopScheduler()`, `initScheduler()` from `scheduler.js`
2. Remove `schedulerTimer` variable
3. Remove the `setTimeout(initScheduler, 5000)` call from `routes.js`
4. Add `setOnCadenceChange(callback)` to `scheduler.js` — stores a callback
   that `onConfigSave()` invokes with the new cadence string
5. Modify `onConfigSave()` to call `onCadenceChange(newConfig.refreshIntervalHours + 'h')`
   instead of restarting the scheduler
6. Wire `routes.js` to define handler config once (closure pattern) and use it
   for both initial registration and re-registration via `setOnCadenceChange`
7. Update `GET /execution/status` to read effective cadence from registry status
   instead of computing from `config.refreshIntervalHours` alone
8. Update existing scheduler tests

### Phase 4: API & CronJob Updates

1. Update `POST /api/admin/refresh-all` in `dev-server.js` to support `?force=true`
   query parameter. CronJob calls without force; admin UI button calls with force.
2. Update 202 response to include `totalHandlers` and `handlersSkipped` counts
   for CronJob fast-path optimization
3. Add `GET /api/admin/refresh-cadence` endpoint
4. Add `POST /api/admin/refresh-cadence` endpoint for cadence overrides
5. Register `platform:backup` as a refresh handler (order 200, cadence `'24h'`)
   in `dev-server.js`. Handler calls the existing `backup.createBackup()`.
   Remove the backup step from the CronJob script (now handled by `runAll()`).
6. Update CronJob YAML: schedule `*/15 * * * *`
7. Update CronJob script: remove backup step (now a handler); adjust polling
   loop to `sleep 5` / `MAX_ATTEMPTS=120`; add fast-path to skip polling when
   all handlers were cadence-skipped

### Phase 5: Admin UI

1. Extend `RefreshSettings.vue` handler rows with cadence display (e.g., "every 12h")
2. Add "next due" time indicator per handler
3. Add cadence override dropdown/control per handler
4. Show "Skipped" state for handlers skipped due to cadence
5. Ensure "Refresh All Modules" button sends `?force=true`
6. Per-module "Refresh" button continues to call `runModule()` (no cadence)

### Phase 6: Documentation & Cleanup

1. Update `shared/API.md` — document `cadence` in `RefreshConfig` typedef
2. Update `docs/MODULES.md` — document cadence option in refresh registration
3. Update `CONTRIBUTING.md` if needed
4. Update `deploy/OPENSHIFT.md` — note CronJob frequency change

## Files Modified

| File | Phase | Change |
|------|-------|--------|
| `shared/server/refresh-registry.js` | 1 | Add cadence parsing, cadence-aware runAll, lastSuccessfulRun tracking, future-timestamp guard, override support |
| `shared/server/module-context.js` | 1 | Update `RefreshConfig` typedef to include `cadence` |
| `shared/server/__tests__/refresh-registry.test.js` | 1 | Add cadence tests (skip, force, retry on failure, parsing, overrides, future timestamp, null handling) |
| `modules/releases/server/execution/routes.js` | 2, 3 | Add dynamic cadence from config; remove initScheduler call; wire onConfigSave via closure pattern; fix `/status` nextScheduledFetch to use effective cadence |
| `modules/releases/server/execution/scheduler.js` | 3 | Remove startScheduler, stopScheduler, initScheduler, schedulerTimer; add setOnCadenceChange callback |
| `modules/releases/server/execution/__tests__/scheduler.test.js` | 3 | Update tests for removed scheduler functions |
| `server/dev-server.js` | 4 | Add force query param to refresh-all with skip counts in 202 response; add `/api/admin/refresh-cadence` GET/POST endpoints; register `platform:backup` handler (order 200, cadence '24h') |
| `deploy/openshift/base/cronjob-sync-refresh.yaml` | 4 | Change schedule to `*/15 * * * *`; remove backup step (now a handler); adjust polling to 5s/120 attempts; add fast-path skip |
| `src/components/RefreshSettings.vue` | 5 | Add cadence display, next-due, override controls, skipped state |
| `shared/API.md` | 6 | Document cadence in RefreshConfig |
| `docs/MODULES.md` | 6 | Document cadence option |

## Testability & Deployment

### Local Testing

1. **Unit tests** (`npm test`): Cadence logic is pure computation — easy to test
   with mock storage and fake timestamps. Tests cover:
   - Cadence parsing (valid and invalid values)
   - Handlers skipped when not due
   - Handlers run when due
   - `force: true` bypasses cadence
   - Failed handlers retry on next tick (lastSuccessfulRun not updated)
   - Cadence override loading and application
   - Dynamic re-registration updates cadence
   - State persistence includes new fields

2. **Local dev** (`npm run dev:full`): Manually trigger refresh via admin UI.
   Verify:
   - RefreshSettings shows cadence per handler
   - "Refresh All" (force) runs everything
   - Manually calling `POST /api/admin/refresh-all` (no force) skips handlers
     not due

3. **Demo mode** (`DEMO_MODE=true`): No real Jira/GitLab tokens needed. Handlers
   complete instantly, cadence skipping is still testable.

### Preprod / Staging

1. Deploy with `*/15 * * * *` CronJob schedule
2. Monitor logs for cadence skip messages: `[refresh-registry] Skipping "X" (not due for Yh Zm)`
3. Verify execution handler runs at its configured interval (e.g., 12h)
4. Verify daily handlers (roster sync, metrics) run only once per day
5. Check `refresh-registry-state.json` has `lastSuccessfulRun` values
6. Test admin override: change a handler's cadence via UI, verify it takes effect on next tick

### Production

1. Deploy CronJob change via ArgoCD (kustomize overlay)
2. ConfigMap change triggers pod rollout automatically
3. Monitor for 24h to confirm:
   - CronJob fires every 15 min
   - Most ticks complete in <30s (all handlers skipped)
   - Handlers run at their declared cadence
   - No duplicate runs (Forbid concurrency policy)
4. Check that execution pipeline data freshness matches configured interval

### Cold Start Behavior

On first deploy (or after PVC wipe), there is no `lastSuccessfulRun` for any
handler. When `lastSuccessfulRun` is missing, the handler is considered
immediately due. This means all 13 handlers will fire on the first tick after
deployment — which is the correct cold-start behavior (same as today's daily
CronJob running everything).

### Rollback

If issues arise:
- Revert CronJob schedule to `0 6 * * *` — instant fix, cadence logic still
  works (daily tick just means handlers always run, same as before)
- Cadence logic is backward-compatible — removing `cadence` from registrations
  falls back to `'24h'` default, which with daily CronJob = current behavior

**State file compatibility**: The `refresh-registry-state.json` format change
(new `lastSuccessfulRun`, `cadence`, `skippedAt` fields) is purely additive.
Old code ignores unknown fields, and new code defaults missing fields (treating
absent `lastSuccessfulRun` as "immediately due"). Rollback is clean in both
directions — no migration or cleanup needed.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| CronJob tick takes >15 min when many handlers are due | `concurrencyPolicy: Forbid` skips overlapping ticks. `activeDeadlineSeconds: 1800` as backstop. Heavy ticks (daily handlers due) happen once/day; other ~95 ticks complete in seconds. |
| Clock skew between CronJob pod and backend pod | Cadence uses server-side timestamps (Date.now()), not CronJob scheduling. CronJob is just the trigger. |
| State file corruption loses lastSuccessfulRun | Handlers would all run on next tick (safe — worst case is one extra run). Persisted state is best-effort. |
| `lastSuccessfulRun` set to future timestamp (clock skew, corruption) | Future timestamps are treated as immediately due (explicit guard in cadence check). Prevents permanent handler skipping. |
| Admin sets cadence too low (e.g., 1m for metrics) | Minimum cadence validation: `'1m'` floor for code-declared cadence, `'15m'` floor for admin overrides. |
| Execution scheduler removal breaks in-flight fetches | The mutex (`fetchInProgress`) is preserved. Only the setInterval trigger is removed. |
| Pod restart during runAll loses in-memory mutex | Pre-existing limitation (same as today). In-memory `running` flag resets to false. Next tick may re-run in-flight handlers. Handlers must be idempotent — they already are (they write results to storage, overwriting previous data). More likely with 96 ticks/day but impact is unchanged: one redundant run. |
| 96 CronJob pods/day is wasteful | Accepted tradeoff. CronJob pods provide: audit trail via k8s job history, visibility via `kubectl`, no state coupling with backend lifecycle, and alignment with the existing CronJob pattern. An in-process `setInterval` would save pod overhead but lose these benefits and re-introduce the same pattern this plan eliminates. ~95% of ticks complete in <5s (fast-path), so actual compute waste is minimal. |

## Out of Scope

- **Upstream-pulse periodic roster push**: Different pattern (event-driven push,
  not time-based data fetch). Stays as-is.
- **Per-handler enable/disable**: Not part of this change. Could be added later.
- **Cadence expressions (cron syntax)**: Interval-based cadence is sufficient.
  "Run at 6 AM daily" is not needed — the CronJob tick is the clock.
- **Distributed locking**: Single-pod deployment. The existing in-memory mutex
  is sufficient. Multi-pod would need Redis/file-based locking (future work).
