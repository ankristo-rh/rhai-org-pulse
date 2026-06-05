# Feature Data Unification Plan

## Problem Statement

The releases module's feature detail page shows stale/incorrect data because
feature information comes entirely from an external GitLab CI pipeline
(`feature-traffic`). When the pipeline produces incomplete or outdated data,
the app has no way to correct it. Observed on RHAISTRAT-1245:

- `ownerStatusColor: null` -- Jira has "Green" (`customfield_10712`)
- `status: "In Progress"` -- Jira shows "Release Pending"
- `epics: []` -- Jira has a linked Epic (RHOAIENG-59140)
- Feature missing from `index.json` despite existing in tracking data

### Current Architecture (3 disconnected data sources)

```
Pipeline (GitLab CI)          Feature Tracking          Hygiene
       |                           |                       |
  artifact zip                 Jira live query         Jira live query
       |                           |                       |
  features/{KEY}.json     tracking-data-{ver}.json    hygiene data
  index.json                       |                       |
       |                      (cached 10min)               |
  GET /features/:key         GET /tracking/data      GET /hygiene/features
```

Each source has its own schema, its own fields, and they never merge. The
feature detail API (`GET /features/:key`) reads only the pipeline file.

## Proposed Architecture: Unified Feature Store

### Core Concept

A **canonical feature store** -- per-feature JSON files keyed by issue key --
where multiple data sources contribute fields. The store is the single source
of truth for the app. The pipeline `index.json` is no longer the authority on
what features exist; the index is **derived** from the set of feature files.

```
                    +---------------------------+
                    |   Unified Feature Store    |
                    |   features/{KEY}.json      |
                    +---------------------------+
                       ^       ^        ^
                       |       |        |
              Pipeline     Jira       Tracking
              ingest     enrichment    data
                       |       |        |
                       v       v        v
                    +---------------------------+
                    |    Derived Index           |
                    |    index.json              |
                    +---------------------------+
                              |
                    GET /features (list)
                    GET /features/:key (detail)
```

### Data Field Ownership

| Field | Source | Rationale |
|-------|--------|-----------|
| `status` | Jira | Authoritative workflow state |
| `statusCategory` | Jira | Derived from status |
| `colorStatus` | Jira | `customfield_10712` (see "Field Rename" below) |
| `statusNotes` | Pipeline | Plain text / ADF status notes (rendered client-side) |
| `statusSummary` | Jira | `customfield_10814` (rendered HTML, different from statusNotes) |
| `assignee` | Jira | Current assignee |
| `pmOwner` | Jira | `customfield_10469` |
| `labels` | Jira | Current labels |
| `fixVersions` | Jira | Current fix versions |
| `components` | Jira | Current components |
| `priority` | Jira | Current priority |
| `team` | Jira | `customfield_10001` |
| `releaseType` | Jira | `customfield_10851` |
| `docsRequired` | Jira | `customfield_10665` |
| `targetEnd` | Jira | `customfield_10023` |
| `riceScore` | Jira | `customfield_10864` |
| `riceStatus` | Jira | Computed from RICE component fields |
| `epics` | Jira | Children via `parent` field / `"Epic Link"` JQL (see below) |
| `isBlocked` | Jira | Unresolved "Blocks" inward links |
| `linkedRfeKey` | Jira | Clones link to RHAIRFE-* |
| `issueLinks` | Jira | All issue links |
| `metrics` | Pipeline | Epic/issue counts, completion %, health |
| `topology` | Pipeline | Repo mapping |
| `created` / `updated` | Pipeline or Jira | Jira preferred when available |

### Feature Discovery Sources

Features can enter the store from three sources:

1. **Pipeline ingest** -- when artifact zip is downloaded and extracted
2. **Tracking data** -- features in `tracking-data-{version}.json` that
   aren't already in the store get stub entries created
3. **Jira JQL discovery** -- a configurable JQL query (e.g.,
   `project = RHAISTRAT AND issuetype IN (Feature, Initiative)`) discovers
   features not yet known to the store

The UI uses filtering (by version, status, etc.) to control what's displayed,
so having more features in the store than expected is safe.

### Storage Layout

```
releases/execution/
  features/{KEY}.json          # Canonical per-feature files (unified schema)
  index.json                   # Derived index (rebuilt after each write batch)
  last-fetch.json              # Pipeline fetch metadata
  last-enrichment.json         # Jira enrichment metadata
  config.json                  # Pipeline fetch config
  tracking-data-{ver}.json     # Feature tracking cache (unchanged)
```

### Unified Feature Schema

Each `features/{KEY}.json` becomes:

```json
{
  "key": "RHAISTRAT-1245",
  "summary": "...",

  "_sources": {
    "pipeline": "2026-06-04T12:00:00Z",
    "jira": "2026-06-05T08:30:00Z"
  },

  "status": "Release Pending",
  "statusCategory": "Done",
  "colorStatus": "Green",
  "ownerStatusColor": "Green",
  "statusNotes": "On track for EA2 delivery",
  "statusSummary": "<p>On track for EA2 delivery</p>",
  "priority": "Normal",
  "assignee": { "displayName": "...", "accountId": "..." },
  "pmOwner": "...",
  "team": "...",
  "releaseType": "...",
  "fixVersions": ["rhoai-3.5.EA2"],
  "labels": ["core"],
  "components": ["Model Serving"],
  "docsRequired": "Yes",
  "targetEnd": "2026-07-01",
  "riceScore": 42,
  "riceStatus": "complete",
  "isBlocked": false,
  "linkedRfeKey": "RHAIRFE-1234",

  "issueLinks": [
    { "type": "Cloners", "direction": "outward", "linkedKey": "RHAIRFE-1234", "linkedSummary": "...", "linkedStatus": "Approved" },
    { "type": "Blocks", "direction": "inward", "linkedKey": "RHOAIENG-5678", "linkedSummary": "...", "linkedStatus": "In Progress" }
  ],
  "epics": [
    { "key": "RHOAIENG-59140", "summary": "...", "status": "Closed" }
  ],
  "pm": "Product Manager Name",
  "architect": "Architect Name",
  "parentKey": "RHAISTRAT-100",
  "targetVersions": ["3.5"],

  "metrics": { "...pipeline data..." },
  "topology": { "...pipeline data..." },

  "created": "2026-02-26T14:49:47.944+0000",
  "updated": "2026-06-05T08:30:00.000+0000"
}
```

The `_sources` field tracks when each source last contributed, enabling
diagnostics and staleness detection.

## Implementation Phases

### Phase 1: Jira Enrichment Module

**New file**: `modules/releases/server/execution/jira-enrich.js`

Core enrichment logic, independent of when it's called:

```js
// Responsibilities:
// 1. Accept a list of feature keys
// 2. Batch-fetch from Jira (reuse CUSTOM_FIELDS from hygiene/jira-fetch.js)
// 3. Extract epic links from issuelinks
// 4. Return a map of key -> enriched fields

async function enrichFeatures(keys, jiraRequestFn, fetchAllJqlResultsFn) {
  // Batch: 40 keys per JQL query (matching hygiene batch size)
  // Fields: status, assignee, fixVersions, labels, components, priority,
  //         issuelinks, + all CUSTOM_FIELDS
  // Epic extraction: filter issuelinks for type "Epic" (inward or outward)
  // Returns: Map<key, { status, colorStatus, epics, ... }>
}

async function discoverFeatures(jql, jiraRequestFn, fetchAllJqlResultsFn) {
  // Run a JQL query to discover features not yet in the store
  // Returns: Array<{ key, summary, ...jira fields }>
}
```

**Reuse**: Import `CUSTOM_FIELDS`, `serializeField`, `computeRiceStatus` from
`hygiene/jira-fetch.js`. These are already exported.

**Assignee handling** (schema conflict): The pipeline writes `assignee` as an
object `{ displayName, accountId }`, and `FeatureDetailView.vue:396` reads
`feature.assignee.displayName`. However, `hygiene/jira-fetch.js:transformIssue()`
serializes assignee to a plain string (`fields.assignee.displayName`). The
enrichment module must **NOT** use hygiene's string serialization for assignee.
Instead, preserve the object shape:

```js
// In jira-enrich.js — custom assignee handling (don't use serializeField)
assignee: fields.assignee
  ? { displayName: fields.assignee.displayName, accountId: fields.assignee.accountId }
  : null
```

Similarly, `pmOwner` should preserve object shape if the frontend expects it
(currently `FeatureDetailView.vue:397` reads `feature.pm.displayName`). The
enrichment should write `pm` as `{ displayName }` from
`fields[CUSTOM_FIELDS.productManager]`.

**Epic discovery** (corrected approach -- epics are NOT in `issuelinks`):

In Jira Cloud, epics are linked to features via the `parent` field or the
`"Epic Link"` custom field (`customfield_10014`), not via `issuelinks`. The
existing codebase confirms this pattern:
- `hygiene/jira-fetch.js:536-537`: `parent IN (...) OR "Epic Link" IN (...)`
- `delivery/routes.js:931`: `"Epic Link" in (...)`

Epic discovery requires a **separate JQL query per batch** of feature keys:

```js
async function fetchEpicsForFeatures(featureKeys, jiraRequestFn, fetchAllJqlResultsFn) {
  // JQL: "Epic Link" in (KEY1, KEY2, ...) OR parent in (KEY1, KEY2, ...)
  //       AND issuetype = Epic
  // Fields: summary, status, parent, customfield_10014
  // Group results by parent key (via fields.parent.key or customfield_10014)
  // Returns: Map<featureKey, [{ key, summary, status }]>
}
```

This adds one additional Jira API call per batch of 40 features (~16 extra
calls for 632 features). The calls can be parallelized with the main
enrichment batch since they query different fields.

**Batching/rate limiting**: 40 keys per batch, 1s delay between batches
(matching hygiene conventions). `Promise.allSettled` for resilience.

**Partial failure handling**: `enrichFeatures()` returns a `Map<key, data>`
containing only the features that were successfully enriched. Features that
failed (e.g., 404, network error within a batch) are omitted from the map.
The caller (merge function) checks: if a key is missing from the enrichment
map, it passes `jiraData = null` to `mergeFeatureData()`, which preserves the
existing Jira-sourced fields and does NOT update `_sources.jira`. This means:

- Successfully enriched features get fresh `_sources.jira` timestamps
- Failed features retain their previous `_sources.jira` timestamp (stale but valid)
- Features never enriched have no `_sources.jira` at all
- Per-batch failures are logged with the specific keys that failed

**Jira credentials call chain**: The `jira` client (with `jiraRequest` and
`fetchAllJqlResults`) is already created in `modules/releases/server/index.js:118`
via `createJiraClient(secrets)` and passed to `registerExecutionRoutes()` at
line 179. Currently `routes.js` ignores it. The full threading:

```
index.js:118    const jira = createJiraClient({ email, token, host })
index.js:173    registerExecutionRoutes(executionRouter, { ..., jira, ... })
routes.js:125  ← receives context.jira (NEW: destructure and pass to scheduler)
routes.js:127    scheduler.init(context.secrets, context.jira)  ← NEW signature
scheduler.js:28  function init(secrets, jira) { _secrets = secrets; _jira = jira; }
scheduler.js:73  const result = await _fetchArtifacts(storage, config, token, _jira)  ← NEW param
gitlab-fetch.js:23  async function fetchArtifacts(storage, config, token, jira) {
                   // ... after extraction, if jira is provided:
                   enrichFeatures(keys, jira.jiraRequest, jira.fetchAllJqlResults)
```

**Modified function signatures**:
- `scheduler.init(secrets)` → `scheduler.init(secrets, jira)`
- `scheduler.runFetch(storage, config)` — unchanged (uses module-level `_jira`)
- `gitlab-fetch.fetchArtifacts(storage, config, token)` → `fetchArtifacts(storage, config, token, jira)`
- `scheduler.manualRefresh(storage)` — unchanged (calls `runFetch` which uses `_jira`)

The `jira` parameter is **optional** in `fetchArtifacts` — if null/undefined
(e.g., in tests or when Jira is unconfigured), the post-ingest enrichment
step is skipped. This preserves backward compatibility with existing tests
that call `fetchArtifacts(storage, config, token)` without a Jira client.

### Phase 2: Merge Logic + Post-Ingest Hook

**New file**: `modules/releases/server/execution/feature-store.js`

```js
// Mutex to prevent interleaving between post-ingest enrichment and periodic
// Jira sync. Follows the fetchInProgress pattern from scheduler.js.
let storeWriteInProgress = false;

// Core merge function — all three inputs are optional (may be null)
function mergeFeatureData(existing, pipelineData, jiraData) {
  // Returns: merged feature object with _sources timestamps updated
}
```

**Merge semantics** (field-by-field rules):

The merge function applies fields in layers: `existing` → `pipelineData` →
`jiraData`, with category-specific rules:

| Category | Fields | Rule |
|----------|--------|------|
| **Jira-owned** | status, statusCategory, colorStatus, statusSummary, assignee, labels, fixVersions, components, priority, team, releaseType, docsRequired, targetEnd, riceScore, riceStatus, isBlocked, linkedRfeKey, issueLinks, epics, pm | Jira always wins. If `jiraData` is null (enrichment failed/skipped), preserve `existing` value. |
| **Pipeline-owned** | metrics, topology, trafficSignals, statusNotes | Pipeline always wins. On re-ingest, new pipeline data overwrites old. If no new pipeline data, preserve `existing`. |
| **Pipeline-index-only** | architect, parentKey, targetVersions | Written from pipeline's `index.json` entries during ingest. Preserved across Jira-only syncs. |
| **Shared** | key, summary | Jira wins (more authoritative). Pipeline value used as fallback. |
| **Timestamps** | created | Pipeline wins (original creation date, immutable). |
| **Timestamps** | updated | Latest of Jira's `fields.updated` and pipeline's `updated`. |
| **Metadata** | _sources | Updated per-source: `_sources.pipeline` set on pipeline ingest, `_sources.jira` set on Jira enrichment. Never cleared. |

**Second pipeline ingest scenario**: When the pipeline delivers new data for
an existing feature, `pipelineData` overwrites pipeline-owned fields (metrics,
topology), and pipeline-index-only fields are refreshed. Jira-owned fields
are NOT overwritten by pipeline data — they retain the most recent Jira
enrichment values. If `jiraData` is also provided (post-ingest hook succeeded),
it takes precedence for Jira-owned fields.

```js

// Write a batch of features + rebuild index (mutex-protected)
async function writeFeatures(storage, features) {
  // Acquire mutex (wait if another write is in progress)
  // Write each feature/{KEY}.json
  // Rebuild index.json from all feature files
  // Release mutex
}

// Rebuild index.json by scanning feature files (async-aware)
async function rebuildIndex(storage) {
  // List all features/*.json files via storage.listStorageFiles()
  // Read summary fields from each (async, not blocking event loop)
  // Apply field mapping (detail → index):
  //   feature.metrics.health        → index.health
  //   feature.metrics.totalEpics    → index.epicCount
  //   feature.metrics.totalIssues   → index.issueCount
  //   feature.metrics.completionPct → index.completionPct
  //   feature.metrics.blockerCount  → index.blockerCount
  //   feature.assignee.displayName  → index.assignee (string)
  //   feature.updated               → index.lastUpdated
  // Preserve pipeline-only index fields:
  //   pm, architect, parentKey, targetVersions
  //   (stored on per-feature file during pipeline ingest)
  // Write index.json with derived data
}
```

**Concurrency**: The `writeFeatures()` + `rebuildIndex()` pair is protected by
a mutex to prevent interleaving between the post-ingest hook and periodic Jira
sync. This follows the `fetchInProgress` pattern already used in `scheduler.js`.
Only one write batch can run at a time; the other waits.

**Async I/O**: `rebuildIndex()` scans ~632 feature files on a network-backed PVC
(Ceph in OpenShift). The implementation must be async-aware to avoid blocking
the Node.js event loop. Use async iteration rather than synchronous reads.

**Modify**: `modules/releases/server/execution/gitlab-fetch.js`

After the existing artifact extraction (line ~143), add a post-ingest hook:

```js
// After writing pipeline files:
// 1. Collect all feature keys from this batch
// 2. Call jira-enrich.enrichFeatures(keys) -- WRAPPED IN TRY/CATCH
// 3. For each feature, merge pipeline data + jira data
// 4. Write merged features via feature-store.writeFeatures()
// 5. Rebuild index via feature-store.rebuildIndex()
```

The pipeline data is still extracted and staged in-memory as before. Key change
to the write flow:

1. **Feature files**: Pipeline feature data is merged with existing store data
   (preserving prior Jira enrichment), then written via `feature-store`.
2. **Pipeline `index.json`**: Its per-feature entries are read for
   pipeline-only index fields (`pm`, `architect`, `parentKey`,
   `targetVersions`) which are stored on each per-feature file. The pipeline
   `index.json` itself is **not written** to storage -- it is replaced by the
   derived index from `rebuildIndex()`.
3. **`rebuildIndex()`** runs last, producing a derived `index.json` that
   includes all features in the store (not just pipeline-delivered ones).

**Fail-safe**: The post-ingest Jira enrichment is wrapped in a try/catch. If
Jira is unreachable or returns errors, the pipeline data is still written with
only pipeline-sourced fields (the `_sources` field will have only a `pipeline`
timestamp, no `jira` timestamp). The periodic sync (Phase 3) will enrich these
features on its next run. This ensures a Jira outage never blocks pipeline
data ingestion.

### Phase 3: Periodic Jira Sync

**New file**: `modules/releases/server/execution/jira-sync.js`

A scheduled job that re-enriches all features from Jira:

```js
async function syncAllFeatures(storage, jiraRequestFn, fetchAllJqlResultsFn) {
  // 1. Read all feature keys from storage
  // 2. Batch-enrich from Jira via jira-enrich.enrichFeatures()
  // 3. Merge and write back via feature-store
  // 4. Write last-enrichment.json metadata
}
```

**Scheduling** via the cadence-aware refresh registry (PR #877):

```js
context.registerRefresh('jira-enrichment', {
  order: 75,
  cadence: config.jiraEnrichment.syncIntervalHours + 'h',  // default: '6h'
  timeout: 120000,
  handler: async function(options) {
    return syncAllFeatures(storage, jira.jiraRequest, jira.fetchAllJqlResults);
  }
});
```

This is the **only** scheduling mechanism needed. The CronJob fires every 15
minutes (`*/15 * * * *`) and `runAll()` evaluates which handlers are due based
on their cadence and `lastSuccessfulRun`. No custom `setInterval` or
`enrichInProgress` mutex is needed — the refresh registry handles cadence
gating and the feature-store mutex handles write concurrency.

**Order 75** ensures pipeline fetch (70) completes first, then enrichment
runs, then hygiene (80).

**Cadence configuration**: When `jiraEnrichment.syncIntervalHours` is changed
via the Settings UI config save, use the `_onCadenceChange` callback pattern
to re-register the handler with the updated cadence string:

```js
// In routes.js config save handler:
if (context.registerRefresh) {
  context.registerRefresh('jira-enrichment', {
    order: 75,
    cadence: newConfig.jiraEnrichment.syncIntervalHours + 'h',
    timeout: 120000,
    handler: syncHandler
  });
}
```

The Jira enrichment handler will automatically appear in the existing
`RefreshSettings.vue` admin panel — no new UI needed for visibility or control.

### Phase 4: Feature Discovery from Jira + Tracking Data

**Extend `jira-sync.js`**:

```js
async function discoverFromJira(storage, jiraRequestFn, fetchAllJqlResultsFn, config) {
  // 1. Run configured JQL (e.g., project = RHAISTRAT AND issuetype = Feature)
  // 2. Compare keys against existing feature store
  // 3. For new keys, create feature entries from Jira data
  // 4. Write via feature-store
}

async function reconcileTrackingData(storage) {
  // 1. Read all tracking-data-*.json files
  // 2. Extract feature keys
  // 3. For keys not in feature store, create stub entries
  // 4. Queue for Jira enrichment
}
```

**Config**: Add discovery JQL to execution config (admin-configurable via
Settings UI). Default JQL includes a date filter to bound the result set:

```
project = RHAISTRAT AND issuetype IN (Feature, Initiative) AND created >= -365d
```

Without the date filter, the query could return thousands of historical issues.
The `created >= -365d` filter limits discovery to features created in the last
year. Admins can adjust this via the Settings UI (e.g., narrower for large
projects, wider if historical features are needed).

### Phase 5: Index Derivation + API Updates

**Modify**: `modules/releases/server/execution/routes.js`

- `GET /features` -- reads derived `index.json` (no API change, but index
  now includes all discovered features)
- `GET /features/:key` -- reads unified feature file (no API change, but
  data is now enriched)

**New endpoint**:

```
POST /features/:key/refresh
```

On-demand single-feature refresh from Jira. For cases where a user notices
stale data and wants an immediate update without waiting for the periodic sync.

**Rate limiting**: Per-key cooldown of 60 seconds (in-memory Map of
`key → lastRefreshTimestamp`). Returns 429 with `retryAfter` if cooldown is
active. Requires authentication (`requireAuth`) but NOT admin — any
authenticated user can trigger a single-feature refresh. This is safe because:
- It's a single Jira API call (not a batch)
- The 60s cooldown prevents abuse
- It only writes one feature file (no index rebuild — the next scheduled
  `rebuildIndex()` will pick it up, or it can be triggered explicitly)

**Modify index derivation**: The index shape stays the same (backward
compatible), but is now derived from feature store files rather than being
a primary pipeline artifact.

## Files to Create

| File | Purpose |
|------|---------|
| `modules/releases/server/execution/jira-enrich.js` | Jira batch enrichment + epic extraction |
| `modules/releases/server/execution/feature-store.js` | Merge logic, feature writes, index derivation |
| `modules/releases/server/execution/jira-sync.js` | Periodic sync + Jira discovery + tracking reconciliation |

## Files to Modify

| File | Changes |
|------|---------|
| `modules/releases/server/execution/gitlab-fetch.js` | Post-ingest hook: add `jira` param to `fetchArtifacts()`, enrich pipeline data |
| `modules/releases/server/execution/routes.js` | Destructure `jira` from context, pass to `scheduler.init()`, add per-feature refresh endpoint, register Jira enrichment refresh handler with `cadence: '6h'`, wire `_onCadenceChange` for config saves |
| `modules/releases/server/execution/scheduler.js` | Change `init(secrets)` → `init(secrets, jira)`, thread `_jira` to `fetchArtifacts()` call |
| `modules/releases/module.json` | Ensure `jira` is in `secrets.platform` (likely already there) |
| `fixtures/releases/execution/features/*.json` | Update fixture schema to match unified format |
| `fixtures/releases/execution/index.json` | Update to match derived index format |
| `modules/releases/client/views/FeatureDetailView.vue` | Rename `ownerStatusColor` → `colorStatus` |
| `modules/releases/client/execute/views/OverviewView.vue` | Rename `ownerStatusColor` → `colorStatus` |
| `docs/DATA-FORMATS.md` | Document unified feature schema |

## Backward Compatibility

### API contract (no breaking changes)

- `GET /features` -- same response shape. Index now has more features
  (discovered from Jira/tracking) but existing filters still work.
- `GET /features/:key` -- same response shape with additional fields.
  Frontend already handles optional fields via `?.` chains.
- `GET /tracking/data` -- unchanged. Feature tracking remains a separate
  live-query system with its own caching.

### Data migration

- Existing `features/{KEY}.json` files are valid under the new schema
  (pipeline-only fields are a subset).
- First Jira enrichment run adds Jira-sourced fields to existing files.
- No data loss: pipeline fields (`metrics`, `topology`) are preserved.
- `_sources` field is additive (new field, no conflict).

### Field rename: `ownerStatusColor` → `colorStatus`

The pipeline writes `ownerStatusColor`, the hygiene and tracking modules use
`colorStatus`. The unified schema standardizes on **`colorStatus`** (matching
the Jira field name and the rest of the codebase). This requires frontend
changes:

| File | Change |
|------|--------|
| `FeatureDetailView.vue:126` | `feature.value?.ownerStatusColor` → `feature.value?.colorStatus` |
| `OverviewView.vue:545-546` | `f.ownerStatusColor` → `f.colorStatus` |
| `fixtures/releases/execution/features/*.json` | Add `colorStatus` field to fixtures |

During migration, the merge layer writes **both** `colorStatus` (canonical)
and `ownerStatusColor` (deprecated alias) to feature files and index entries.
This provides backward compatibility during rollout. The alias can be removed
after the frontend changes land.

### Field rename: `statusNotes` → `statusNotes` (kept as-is)

The pipeline writes `statusNotes` (plain text or ADF). The hygiene/tracking
modules use `statusSummary` (rendered HTML from `customfield_10814`). These are
**different fields with different formats**:

- `statusNotes`: Pipeline-provided plain text / ADF, rendered client-side via
  `renderStatusNotes()` in `FeatureDetailView.vue:434`
- `statusSummary`: Jira's rendered HTML from `expand=renderedFields`

The unified schema keeps **both fields**:
- `statusNotes` — preserved from pipeline data (for ADF rendering)
- `statusSummary` — added from Jira enrichment (HTML string)

The frontend already uses `statusNotes` for the detail view's "Status Notes"
banner. The `statusSummary` field is used by the tracking table. No rename
needed — they serve different purposes.

### Frontend impact

- `FeatureDetailView.vue` requires the `ownerStatusColor` → `colorStatus` rename (see above)
- `OverviewView.vue` requires the same rename
- `colorStatus` field is now reliably populated (was often null as `ownerStatusColor`)
- `epics` array is now populated from Jira parent/Epic Link queries
- `status` reflects Jira's current workflow state

### Feature tracking coexistence

The feature tracking system (`feature-tracking-routes.js`) remains unchanged.
It's a live Jira query for release-scoped views, independent of the feature
store. The two systems serve different purposes:
- **Feature store**: canonical per-feature data for detail pages and overview
- **Feature tracking**: release-scoped live view with scope-change detection

## Testability

### Unit tests (new)

| Test file | Covers |
|-----------|--------|
| `__tests__/server/execution/jira-enrich.test.js` | Batch enrichment, epic extraction, field mapping |
| `__tests__/server/execution/feature-store.test.js` | Merge logic (Jira wins), index derivation, edge cases |
| `__tests__/server/execution/jira-sync.test.js` | Sync orchestration, discovery, tracking reconciliation |
| `__tests__/server/execution/gitlab-fetch-enrich.test.js` | Post-ingest hook integration |

### Test strategy

- **Mock Jira API** using the existing `_setFetch` pattern from gitlab-fetch
- **Mock storage** using `createTestContext()` from `shared/server/module-context.js`
- **Fixture data**: Extend existing demo fixtures with `_sources` and enriched fields
- **Edge cases**: Feature exists in pipeline but not Jira (deleted), feature in Jira but not pipeline (discovery), merge conflicts (both sources have `status`)

### Smoke/integration tests

- Existing smoke tests verify app loads and data renders -- enriched data
  flows through the same API endpoints, so no new smoke tests needed.
- Integration tests for releases module should verify that feature detail
  pages render enriched fields (colorStatus badge, epic list).

## Deployment Considerations

### Secret requirements

The enrichment module needs Jira credentials (`JIRA_EMAIL`, `JIRA_TOKEN`).
These are already declared in `modules/releases/module.json` under
`secrets.platform: ["jira"]` and available via `context.secrets`.

### Performance / Rate Limits

- **Batch size**: 40 features per JQL query (proven safe in hygiene module)
- **Throttle**: 1s between batches
- **Estimated load**: ~632 features / 40 per batch = ~16 enrichment API calls + ~16 epic discovery calls = ~32 total per full sync
- **Jira Cloud rate limit**: ~10 req/s sustained -- 32 calls over ~32s is well within limits
- **Epic discovery**: Requires separate `"Epic Link" in (...)` JQL queries (epics are linked via `parent` field and `customfield_10014`, not `issuelinks`). These can run in parallel with enrichment batches.
- **Jira discovery (Phase 4)**: Bounded by `created >= -365d` filter to prevent unbounded result sets

### Pipeline fetch latency

Post-ingest enrichment adds ~20-30s to the pipeline fetch cycle (16 batches x
~1.5s each). This is acceptable since pipeline fetches run on a 12h interval.

### Rollout

1. Deploy with enrichment disabled (feature flag in execution config)
2. Enable post-ingest enrichment, verify data quality
3. Enable periodic sync
4. Enable Jira discovery
5. Monitor Jira API usage and adjust batch/throttle params if needed

The config flag (defaults to `false`, consistent with `DEFAULT_CONFIG.enabled`
in `scheduler.js` -- enable via Settings UI per-environment):
```json
{
  "jiraEnrichment": {
    "enabled": false,
    "syncIntervalHours": 6,
    "discoveryEnabled": false,
    "discoveryJql": "project = RHAISTRAT AND issuetype IN (Feature, Initiative) AND created >= -365d"
  }
}
```

The `syncIntervalHours` maps directly to the refresh handler's `cadence`
string (e.g., `6` → `'6h'`). Changing this value via the Settings UI
re-registers the handler with the updated cadence via `_onCadenceChange`.

### CronJob and cadence

The CronJob fires every 15 minutes (`*/15 * * * *`) and calls
`POST /api/admin/refresh-all`. The cadence-aware refresh registry evaluates
which handlers are due on each tick. Most ticks complete in seconds (all
handlers skipped). When the Jira enrichment handler is due (every 6h by
default), it adds ~30s to that tick's execution time.

The CronJob still has `activeDeadlineSeconds: 1800` (30 min). Even when
multiple handlers fire on the same tick (e.g., pipeline fetch at 12h +
enrichment at 6h + hygiene at 24h), total execution should remain well within
the timeout. Monitor after rollout if feature count grows significantly.

### Resilience during pod restarts

The `last-enrichment.json` metadata file tracks enrichment progress:
```json
{
  "status": "success",
  "timestamp": "2026-06-05T08:30:00Z",
  "featureCount": 632,
  "duration": 24500,
  "lastKey": "RHAISTRAT-1500"
}
```

The `strategy: Recreate` deployment means brief downtime during rollouts. If
a periodic sync is interrupted mid-way, the next sync starts fresh (full
re-enrichment takes only ~20-30s, so partial progress tracking is not worth
the complexity). The `lastKey` field is for diagnostics only.

## Edge Cases

### Demo mode

When `DEMO_MODE=true`, the app uses `demo-storage.js` backed by fixture data.
Jira APIs are not available. The enrichment module must:

- **Skip all Jira calls** when demo mode is active (check
  `process.env.DEMO_MODE` at init time, or check `context.isDemoMode`)
- **Pre-populate fixtures** with `_sources` metadata and enriched fields
  (`colorStatus`, `epics`, etc.) so the UI renders correctly in demo mode
- The `jiraEnrichment.enabled` flag is irrelevant in demo mode -- enrichment
  is unconditionally skipped

### Feature deletion / staleness

If a feature is deleted from Jira, the enrichment will simply return no data
for that key. The existing feature file is preserved with its last-known data.

Over time, deleted features accumulate in the store. To address this:
- The enrichment adds a `_jiraStatus` field: `"found"` or `"not_found"`
- Features with `_jiraStatus: "not_found"` for 3+ consecutive syncs get a
  `_stale: true` flag
- The derived index can optionally exclude `_stale` features (configurable)
- No automatic deletion -- admin can review stale features in diagnostics

### Pipeline disabled, Jira sync enabled

If pipeline fetch is disabled but `jiraEnrichment.enabled` is true, the Jira
sync runs against whatever feature files exist in the store. This is a valid
operating mode — it keeps Jira-sourced fields fresh even when the pipeline
isn't running. The `metrics` and `topology` fields will be stale (or missing
for Jira-discovered features), but the `_sources` timestamps make this visible.

The Jira sync does NOT require a prior successful pipeline fetch. Features
discovered via Jira JQL (Phase 4) will have Jira-sourced fields but empty
`metrics` and `topology`. The UI should gracefully handle missing pipeline
fields (which it already does via `?.` chains and empty-state fallbacks).

### Storage abstraction

`rebuildIndex()` uses `storage.listStorageFiles('releases/execution/features')`
to enumerate feature files. This is the storage abstraction's directory listing
method -- never raw `fs.readdirSync`. The `listStorageFiles` function is
available on both the real storage and `demo-storage.js`.

## Architectural Notes

### Hard Constraint #3: "Display layer, not a compute engine"

AGENTS.md states the app should do "lightweight fetching, caching, and serving"
with heavy computation in external processes. This plan adds batch Jira
fetching, merge logic, and index derivation (scanning 632+ files). This stays
within the constraint because:

- **Jira fetching** is lightweight I/O (16 batched API calls, ~32s total). It's
  comparable to the existing roster sync and hygiene fetch, both of which run
  in-process.
- **Merge logic** is simple field assignment, not aggregation or ML scoring.
- **Index derivation** is a directory scan + JSON field extraction, not complex
  computation. At 632 files x ~2KB each, this is trivially fast.
- **Periodic scheduling** matches existing patterns (roster sync, hygiene
  refresh, pipeline fetch all use in-process scheduling).

The external pipeline remains responsible for the genuinely expensive work:
traversing epic hierarchies, counting child issues, computing completion
metrics, and building topology maps. The app's enrichment layer only fetches
flat fields from Jira — it does not replicate the pipeline's deep traversal.

## Open Questions

1. **Hygiene integration**: The hygiene module also fetches from Jira with
   overlapping fields. Should it read from the unified feature store instead
   of querying Jira independently? This could reduce Jira API load but
   creates a dependency. Recommend: keep hygiene independent for now, consider
   consolidation in a future iteration.

2. **Feature tracking merging**: Should tracking data responses also pull from
   the feature store for consistency? Currently tracking does its own live
   Jira queries. Recommend: keep independent for now since tracking needs
   changelog data that the store doesn't capture.

3. **Stale pipeline data**: What happens when the pipeline hasn't run in days
   but Jira sync keeps updating? The `metrics` and `topology` fields will be
   stale while Jira fields are fresh. The `_sources` timestamps make this
   visible. Recommend: expose staleness info in the UI (e.g., "Metrics last
   updated 3 days ago").
