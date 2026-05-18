# Test Plan Quality Tracking — AI Impact Module

## Overview

The AI Impact module now tracks quality across the full RHAI delivery pipeline: **RFE Review** (from rfe-assessor), **Feature Review** (from strat-creator), and **Test Plan Review** (from odh-test-gen). Test plan quality scores previously stayed in local `TestPlanReview.md` files with no dashboard visibility — this feature surfaces them alongside the other pipeline stages.

The "Test Plan Review" tab fills the slot previously held by the disabled "QE / Validation" placeholder in the AI Impact navigation, completing the three-stage quality chain.

**Repos involved:**

- `rhai-org-pulse` — server storage/routes/sync, client UI, fixture, tests
- `odh-test-gen` — Jira label-stamping steps added to `/test-plan-create` skill

---

## Data Flow

```
Jira (RHAISTRAT feature issue)
  │ Feature gets strat-creator-human-sign-off label
  │
  ▼ Detected by GitLab CI scheduler (TODO)
test-plan-generator (NEW GitLab repo)
  │ Runs Claude Code with /test-plan-create skill
  │ Produces TestPlan.md, TestPlanReview.md, TestPlanGaps.md, test_cases/
  │ Stamps test-plan-auto-created label on Jira issue
  │
  ├─▶ org-pulse /test-plans/bulk API
  │   │ Parse TestPlanReview.md frontmatter
  │   │ POST quality scores to dashboard
  │   │ Auto-triggers Jira sync 10s later
  │   │
  │   ▼
  │  Dashboard UI — "Test Plan Review" tab
  │    Metrics, charts, filterable list, detail panel
  │    Cross-links to Feature Review and RFE Review
  │
  └─▶ opendatahub-test-plans (GitHub)
      │ Fork repo, create branch, commit test plan files
      │ Open PR for QE review
      │
      ▼
     Merged by QE after review
```

---

## Scoring Model


|                   | RFE Review                     | Feature Review             | Test Plan Review                                                   |
| ----------------- | ------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| **Criteria**      | what, why, how, task, size     | what, why, how, task, size | specificity, grounding, scope_fidelity, actionability, consistency |
| **Scale**         | 0-2 each, 10-point total       | 0-2 each, 10-point total   | 0-2 each, 10-point total                                           |
| **Verdicts**      | PASS / FAIL                    | PASS / FAIL                | Ready / Revise / Rework                                            |
| **Auto-revision** | Up to 2 cycles                 | N/A                        | Up to 2 cycles                                                     |
| **Source tool**   | rfe-assessor CI                | strat-creator pipeline     | test-plan-generator CI (auto-triggered)                            |
| **Source repo**   | rfe-assess-data (GitLab)       | strat-pipeline-data (GitLab) | opendatahub-test-plans (GitHub, via PR)                         |


---

## Design Decisions

### Naming: "Test Plan Review" (not "QE / Validation")

The original module.json placeholder used `"qe-validation"` as the nav item ID and "QE / Validation" as the label. We renamed to `"test-plan-review"` / "Test Plan Review" to match the naming pattern of "RFE Review" and "Feature Review" — each tab is named after what it reviews, not who reviews it.

The route ID was changed from `qe-validation` to `test-plan-review` across all files (module.json, client/index.js, client/constants.js, PipelineTimeline.vue) to keep internal IDs consistent with the user-facing label.

### Terminology: "AI Recommendation"

This matches the established pattern in Feature Review, where the underlying field is displayed as "AI Recommendation".

Filter options follow the same pattern: "All AI Recommendations", "AI Recommendation: Ready", etc.

### Detail Panel Layout: Matching Feature Details

The detail panel (`TestPlanDetailPanel.vue`) was deliberately designed to mirror the existing Feature Detail dialog layout, based on side-by-side comparison. Key layout decisions:

1. **No floating link in header** — source key link is rendered as a dedicated "Source Strategy" row below the scores, not as a floating top-right link
2. **Score display** — AI Recommendation badge + Human Review Status + overall score on a single row, matching Feature Details pattern
3. **Dimension scores** — 2-column grid with Pass/Partial/Fail badges (instead of numeric 0/1/2), with expandable criterion notes per dimension
4. **Score History includes current** — the history section shows the current review as the first entry (not just historical), so users always see the full timeline
5. **Section order** — Header → Feature name → Scores → Approval → Source Strategy → Dimension Scores → History → Feedback → Gap Analysis → Auto-revised → Labels → Components → Related Reviews → Pipeline Progress

### Gap Analysis Section

The `gapAnalysis` field is a distinct section from `feedback`. It contains a structured analysis of what the test plan is missing relative to the source feature's requirements, organized into collapsible sections (Scope & Endpoints, Test Strategy & Risks, Environment & Infrastructure).

Rendered by the dedicated `GapAnalysisText.vue` component with proper dashboard styling:
- Section headers are clickable with chevron icons (▶/▼) and count badges showing number of gaps per section
- All sections start collapsed for progressive disclosure
- Smooth expand/collapse transitions with hover effects
- Parses markdown headers (`## Title`) and bullet points with inline bold (`**text**`)

It only renders when there is actual gap content (`v-if="currentPlan?.gapAnalysis"`), so plans with no identified gaps simply omit the section entirely.

### Charts: Score Distribution + Dimension Breakdown

Two Chart.js bar charts render between the metrics row and the list:

1. **Score Distribution** — histogram of overall scores 0-10, colored red (0-3), amber (4-7), green (8-10)
2. **Dimension Breakdown** — stacked horizontal bar per criterion, with Pass (2) / Partial (1) / Fail (0) segments

These mirror the chart patterns used in other dashboard sections. Dark mode is supported via MutationObserver on the `<html>` class.

### Human Review Status Derivation

Rather than requiring the push script to explicitly set `humanReviewStatus`, the system derives it from Jira labels during sync:

- `test-plan-human-sign-off` label present → `approved`
- `test-plan-rubric-fail` label present → `needs-review`
- Neither → `awaiting-review`

This keeps the push script simple (it doesn't need to interpret labels) and ensures the dashboard always reflects current Jira state.

### Jira Sync: Fire-and-Forget After Bulk Ingest

After a successful `POST /test-plans/bulk`, the server waits 10 seconds then auto-triggers Jira sync in the background. This ensures that freshly ingested data gets enriched with live Jira metadata (title, status, priority, labels) without requiring a separate manual step. The delay avoids hammering Jira immediately after a large ingest.

The sync can also be triggered manually via `POST /test-plans/sync` and polled via `GET /test-plans/sync/status`.

### Non-blocking Label Stamping in Skill

Both label-stamping steps (3.6 and 4.5) in the `/test-plan-create` skill are explicitly **non-blocking** — if the Atlassian MCP call fails (network error, insufficient permissions, MCP unavailable), the skill logs a warning and continues. This ensures test plan generation is never blocked by a Jira integration failure.

---

## API Routes

All routes are mounted at `/api/modules/ai-impact/`. Static routes are registered before parameterized ones.


| Method | Path                      | Auth   | Description                                                                                |
| ------ | ------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| GET    | `/test-plans/status`      | admin  | `{ lastSyncedAt, totalTestPlans, totalHistoryEntries }`                                    |
| GET    | `/test-plans/sync/status` | public | Sync state: `{ syncing, lastSyncedAt, lastSyncError }`                                     |
| POST   | `/test-plans/sync`        | admin  | Trigger manual Jira sync                                                                   |
| POST   | `/test-plans/bulk`        | admin  | Bulk upsert (max 5000 items, 10MB). Body: `{ testPlans: [...] }`                           |
| DELETE | `/test-plans`             | admin  | Clear all data. Demo mode guard.                                                           |
| GET    | `/test-plans`             | public | List all (slim projection — no criterionNotes, feedback, beforeScore, beforeScores, error) |
| GET    | `/test-plans/:key`        | public | Full detail + history for one test plan                                                    |
| PUT    | `/test-plans/:key`        | admin  | Single upsert. Demo mode guard.                                                            |


---

## Server Implementation

### Storage (`server/test-plans/storage.js`)

Mirrors the assessments storage pattern:

- **Storage key:** `ai-impact/test-plans.json`
- **Collection key:** `testPlans`
- **Counter:** `totalTestPlans`
- **Idempotency:** keyed on `reviewedAt` timestamp — re-posting the same review is a no-op
- **History:** max 20 entries per key, newest-first, trimmed to keep only `scores`, `score`, `verdict`, `autoRevised`, `reviewedAt`
- **Slim projection:** strips `criterionNotes`, `feedback`, `beforeScore`, `beforeScores`, `error` from list responses
- **Atomic writes:** temp file + rename pattern
- **Empty state:** includes `lastJiraSyncAt: null` for sync tracking

### Validation (`server/test-plans/validation.js`)

Required fields:

- `feature` — non-empty string
- `sourceKey` — matches `^(RHAISTRAT|RHOAIENG|RHAIRFE)-\d+$`
- `scores` — object with 5 criteria (`specificity`, `grounding`, `scope_fidelity`, `actionability`, `consistency`), each 0-2 integer
- `score` — 0-10 integer, must equal sum of individual scores
- `verdict` — `Ready`, `Revise`, or `Rework`
- `reviewedAt` — ISO 8601 date string

Optional fields: `autoRevised` (bool), `beforeScore`/`beforeScores` (must both be set or both null), `criterionNotes`, `feedback`, `gapAnalysis`, `error`, `components` (string[]), `testCaseCount` (int), `jiraTitle`, `jiraStatus`, `jiraPriority`, `labels` (string[], max 50), `humanReviewStatus`, `approvedBy`, `approvedAt`.

Snake_case normalization: `source_key` → `sourceKey`, `auto_revised` → `autoRevised`, `before_score` → `beforeScore`, `criterion_notes` → `criterionNotes`, `test_case_count` → `testCaseCount`, `reviewed_at` → `reviewedAt`. This allows the push script to send either naming convention.

`humanReviewStatus` is derived from labels when not explicitly set:

- `test-plan-human-sign-off` → `approved`
- `test-plan-rubric-fail` → `needs-review`
- default → `awaiting-review`

### Jira Sync (`server/test-plans/jira-sync.js`)

Mirrors `features/jira-sync.js`. Auto-triggers 10s after bulk ingest (fire-and-forget).

For each tracked `sourceKey`:

1. Fetches issue with `expand=changelog` via Jira Cloud REST API
2. Reads current labels → derives `humanReviewStatus`
3. Extracts `test-plan-human-sign-off` changelog entry → `approvedBy` + `approvedAt`
4. Updates stored data with `jiraTitle`, `jiraStatus`, `jiraPriority`, `labels`, `humanReviewStatus`

Manual trigger: `POST /test-plans/sync`. Poll: `GET /test-plans/sync/status`.

### Route Registration (`server/index.js`)

Three lines added after feature route registration:

```javascript
const registerTestPlanRoutes = require('./test-plans/routes');
registerTestPlanRoutes(router, context);
```

---

## Client Implementation

### Composable (`client/composables/useTestPlans.js`)

Mirrors `useFeatures.js`: `loadTestPlans()`, `loadTestPlanDetail(key)`, refs for `testPlans`, `loading`, `error`, `detailCache`.

### Helpers (`client/utils/test-plan-helpers.js`)

- `getVerdictClass(verdict)` — Ready→green, Revise→amber, Rework→red
- `getVerdictBgClass(verdict)` — background color variants
- `getVerdictLabel(verdict)` — display label
- `getCriterionLabel(criterion)` — `scope_fidelity` → "Scope Fidelity"
- `getCriterionScoreClass(score)` — 2→green, 1→amber, 0→red
- `getScoreColorClass(score)` — 0-10 scale color
- `CRITERIA` — ordered list of criterion keys

### View (`client/views/TestPlanView.vue`)

Mirrors `FeatureReviewView.vue`. Uses `useTestPlans()`, `useAIImpact()` (for `jiraHost`), injects `moduleNav`. Passes `PHASES` from `constants.js` to detail panel for Pipeline Progress rendering.

### Components


| Component                   | Description                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TestPlanReviewContent.vue` | Container: LoadingOverlay → MetricsRow → Charts → List                                                                                                                                                                                                                                                                   |
| `TestPlanMetricsRow.vue`    | 6 stat cards: Total, Avg Score, Ready/Revise/Rework counts, Auto-revised                                                                                                                                                                                                                                                 |
| `TestPlanCharts.vue`        | Score Distribution histogram (0-10, red/amber/green) + Dimension Breakdown stacked bar (Pass/Partial/Fail per criterion). Dark mode via MutationObserver.                                                                                                                                                                |
| `TestPlanList.vue`          | Search (key/feature/component), verdict filter ("All AI Recommendations" / "AI Recommendation: Ready/Revise/Rework"), sort (default/score low-high/high-low)                                                                                                                                                             |
| `TestPlanListItem.vue`      | Source key, feature name, verdict badge, score, components, auto-revised indicator                                                                                                                                                                                                                                       |
| `TestPlanDetailPanel.vue`   | Full detail modal: header, AI recommendation + review status + score, approval info, source strategy link, dimension scores (2-col grid with expandable criterion notes), score history (includes current entry), feedback, collapsible gap analysis (GapAnalysisText), auto-revised indicator, labels, components, related reviews, pipeline progress |
| `GapAnalysisText.vue`       | Collapsible gap analysis renderer with section headers (chevron icons, count badges), bullet points with inline bold, smooth expand/collapse transitions                                                                                                                                                                 |


### Existing Component Updates


| Component                  | Change                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PipelineTimeline.vue`     | Added `testPlan` prop for test-plan-only context. Shows verdict + score in test-plan-review phase. Green checkmark if human-approved, blue circle if awaiting approval. Clickable link emits `navigateToTestPlan`. Added `test-plan-review` case to `getRFEPhaseSignal()` for RFE context. |
| `FeatureDetailPanel.vue`   | Loads test plan data for feature.key, passes to PipelineTimeline, emits `navigateToTestPlan` for timeline clicks.                                                                                                                                         |
| `RFEDetailModal.vue`       | Loads test plan data for rfe.linkedFeature.key, passes to PipelineTimeline, emits `navigateToTestPlan` for timeline clicks.                                                                                                                               |
| `AssessmentGuideModal.vue` | Added "Test Plan Review" tab: workflow diagram (Strategy Input → AI Analysis → Quality Review → Test Cases), scoring criteria table, verdict outcomes, CLI tool references (`/test-plan-create`, `/test-plan-create-cases`, `/test-plan-case-implement`). |
| `AIImpactSettings.vue`     | Added test plan data section: status display (`lastSyncedAt`, `totalTestPlans`, `totalHistoryEntries`), clear button.                                                                                                                                     |


### Wiring


| File                  | Change                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `module.json`         | Nav item: `{ "id": "test-plan-review", "label": "Test Plan Review", "icon": "ClipboardCheck" }` |
| `client/index.js`     | Route: `'test-plan-review': defineAsyncComponent(() => import('./views/TestPlanView.vue'))`     |
| `client/constants.js` | Phase: `{ id: 'test-plan-review', name: 'Test Plan Review', order: 4, status: 'active' }`       |


---

## Jira Label Strategy

Labels stamped by `/test-plan-create` on the source Jira issue (RHAISTRAT or RHOAIENG):


| Label                      | When stamped                                   | Dashboard use                                    |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `test-plan-auto-created`   | After Phase 3 generates TestPlan.md (Step 3.6) | Classifies "has AI test plan"                    |
| `test-plan-rubric-pass`    | After review verdict = Ready (Step 4.5)        | Quality gate passed                              |
| `test-plan-rubric-fail`    | After review verdict = Rework (Step 4.5)       | Quality gate failed                              |
| `test-plan-auto-revised`   | After auto-revision improves scores (Step 4.5) | Tracks self-improvement rate                     |
| `test-plan-human-sign-off` | Human adds manually in Jira                    | Tracks human approval (changelog gives who/when) |


This mirrors the existing label conventions for RFE (`rfe-creator-*`) and Feature (`strat-creator-*`) stages:

```
RFE                    Feature                  Test Plan
─────────────         ─────────────            ─────────────
rfe-creator-          strat-creator-           test-plan-
  auto-created  →       auto-created    →        auto-created
  auto-revised          rubric-pass              rubric-pass
                        human-sign-off           human-sign-off
```

Each stage answers: "Was it AI-generated? Did it pass the rubric? Did a human approve it?"

The pipeline timeline in the UI can show green/amber/red per stage by checking label presence, and the Jira changelog gives temporal data for trend analysis (when did adoption ramp up, what's the human review latency).

---

## Demo Fixture

`fixtures/ai-impact/test-plans.json` contains 7 entries with:

- All three verdicts (Ready, Revise, Rework)
- Jira-enriched fields (jiraTitle, jiraStatus, jiraPriority, labels)
- One with `autoRevised: true` + `beforeScore`/`beforeScores` showing score improvement
- One with `error` field (simulating a review failure)
- Human approval data (`approvedBy`, `approvedAt`)
- Diverse components and test case counts
- Source keys matching existing `features.json` fixture for cross-linking

---

## Tests

5 test files, 84 test cases, all passing:


| Test file                      | Cases | Coverage                                                                                                                                                                           |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-plan-validation.test.js` | 33    | All required/optional fields, snake_case normalization, cross-validation (score = sum of scores), `beforeScore`/`beforeScores` pairing, `humanReviewStatus` derivation from labels |
| `test-plan-storage.test.js`    | 16    | Read/write, upsert, idempotency, history management, trimming, slim projections, atomic writes                                                                                     |
| `test-plan-routes.test.js`     | 13    | All 8 routes, auth guards, demo mode guards, bulk size limits, sync trigger/status                                                                                                 |
| `test-plan-jira-sync.test.js`  | 17    | Label extraction, changelog parsing for approval dates/actors, error handling, partial sync failures                                                                               |
| `gap-analysis-text.test.js`    | 5     | Section parsing, collapsible behavior, expand/collapse, count badges, chevron rotation                                                                                             |


---

## E2E Validation

Validated end-to-end with real Jira data:

1. **Label stamping:** Stamped `test-plan-auto-created` on RHAISTRAT-1306 ("Dev Preview - MCP Catalog: Pre-Canned MCP Servers") via Atlassian MCP tools
2. **Data ingest:** POSTed test plan review data via `/test-plans/bulk` with Jira-enriched fields (status: Release Pending, priority: Major)
3. **UI verification:** Dashboard renders detail panel with criteria scores, feedback, gap analysis, components, cross-links to Feature Review
4. **Jira sync:** Sync correctly enriches stored data with live issue metadata from Jira Cloud
5. **Demo mode:** `DEMO_MODE=true` loads fixture data, all 7 entries render with charts and detail panels

A data-loading script is available at `docs/e2e-test-plan-quality.sh` for manual testing (loads 6 test plans with diverse verdicts, gap analysis content, and Jira-enriched fields via curl).

Manual E2E checklist: `docs/e2e-test-plan-quality.md`

---

## Files Summary

**New files (23 in rhai-org-pulse):**


| #   | Path                                                              |
| --- | ----------------------------------------------------------------- |
| 1   | `modules/ai-impact/server/test-plans/storage.js`                  |
| 2   | `modules/ai-impact/server/test-plans/validation.js`               |
| 3   | `modules/ai-impact/server/test-plans/routes.js`                   |
| 4   | `modules/ai-impact/server/test-plans/jira-sync.js`                |
| 5   | `modules/ai-impact/client/composables/useTestPlans.js`            |
| 6   | `modules/ai-impact/client/utils/test-plan-helpers.js`             |
| 7   | `modules/ai-impact/client/views/TestPlanView.vue`                 |
| 8   | `modules/ai-impact/client/components/TestPlanReviewContent.vue`   |
| 9   | `modules/ai-impact/client/components/TestPlanList.vue`            |
| 10  | `modules/ai-impact/client/components/TestPlanListItem.vue`        |
| 11  | `modules/ai-impact/client/components/TestPlanDetailPanel.vue`     |
| 12  | `modules/ai-impact/client/components/TestPlanMetricsRow.vue`      |
| 13  | `modules/ai-impact/client/components/TestPlanCharts.vue`          |
| 14  | `modules/ai-impact/client/components/GapAnalysisText.vue`         |
| 15  | `modules/ai-impact/__tests__/server/test-plan-validation.test.js` |
| 16  | `modules/ai-impact/__tests__/server/test-plan-storage.test.js`    |
| 17  | `modules/ai-impact/__tests__/server/test-plan-routes.test.js`     |
| 18  | `modules/ai-impact/__tests__/server/test-plan-jira-sync.test.js`  |
| 19  | `modules/ai-impact/__tests__/client/gap-analysis-text.test.js`    |
| 20  | `fixtures/ai-impact/test-plans.json`                              |
| 21  | `docs/plan-test-plan-quality-tracking.md`                         |
| 22  | `docs/e2e-test-plan-quality.md`                                   |
| 23  | `docs/e2e-test-plan-quality.sh`                                   |


**Modified files (12 in rhai-org-pulse):**


| #   | Path                                                           | Change                                                                                   |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | `modules/ai-impact/server/index.js`                            | +3 lines: import + register test plan routes                                             |
| 2   | `modules/ai-impact/module.json`                                | Nav item: disabled `qe-validation` placeholder → active `test-plan-review`               |
| 3   | `modules/ai-impact/client/index.js`                            | Route mapping for `test-plan-review`                                                     |
| 4   | `modules/ai-impact/client/constants.js`                        | Phase entry: `test-plan-review`, order 4, active                                         |
| 5   | `modules/ai-impact/client/components/AIImpactSettings.vue`     | Test plan data status section + clear button                                             |
| 6   | `modules/ai-impact/client/components/PipelineTimeline.vue`     | `testPlan` prop, test-plan-only context signals, RFE test-plan-review case               |
| 7   | `modules/ai-impact/client/components/AssessmentGuideModal.vue` | "Test Plan Review" tab                                                                   |
| 8   | `modules/ai-impact/client/components/FeatureDetailPanel.vue`   | Test plan loading, pass to PipelineTimeline, navigateToTestPlan handler                  |
| 9   | `modules/ai-impact/client/components/RFEDetailModal.vue`       | Test plan loading via linkedFeature.key, pass to PipelineTimeline, navigateToTestPlan    |
| 10  | `modules/ai-impact/client/views/FeatureReviewView.vue`         | handleNavigateToTestPlan handler                                                         |
| 11  | `modules/ai-impact/client/views/RFEReviewView.vue`             | handleNavigateToTestPlan handler                                                         |
| 12  | `fixtures/ai-impact/rfe-data.json`                             | RHAIRFE-1001 linkedFeature updated to RHAISTRAT-1168 (matches feature/test plan fixture) |


**Modified files (1 in odh-test-gen):**


| #   | Path                               | Change                                                                                                             |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `skills/test-plan-create/SKILL.md` | Steps 3.6 + 4.5: Jira label-stamping, `mcp__atlassian__editJiraIssue` in allowedTools, non-blocking error handling |


---

## Next Steps

### 1. Automated Test Plan Generation & Publishing Pipeline (highest priority)

**Status**: Not yet implemented

**Detailed plan**: See [plan-automated-test-plan-generation.md](plan-automated-test-plan-generation.md) for full architecture and implementation details.

The dashboard API is ready to receive data. A new GitLab CI pipeline will automatically generate test plans when features are approved and publish results to both org-pulse and opendatahub-test-plans.

**Architecture:**

```
Jira (RHAISTRAT feature issue)
  │ Feature gets strat-creator-human-sign-off label
  │
  ▼ Label detected by GitLab CI scheduler
NEW GitLab repo: test-plan-generator (to be created)
  │ Monitors Jira for strat-creator-human-sign-off label
  │ Follows rfe-assessor pattern (https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor)
  │
  │ On label detection:
  │   1. Run Claude Code with /test-plan-create {RHAISTRAT-XXX}
  │   2. Optionally run /test-plan-create-cases for test case generation
  │   3. Parse generated TestPlanReview.md frontmatter
  │   4. POST to org-pulse /test-plans/bulk (dashboard data)
  │   5. Fork opendatahub-test-plans (GitHub)
  │   6. Commit TestPlan.md, TestPlanReview.md, TestPlanGaps.md, test_cases/
  │   7. Open PR to opendatahub-test-plans from fork
  │
  ▼
org-pulse /test-plans/bulk → Jira sync auto-triggers 10s later
  │ Dashboard shows test plan quality scores
  │
  ▼
opendatahub-test-plans (GitHub)
  │ PR with test plan artifacts for human review
  │ Merged by QE after review
```

**GitLab CI job (similar to rfe-assessor assess-rfe):**

```yaml
generate-test-plans:
  stage: test-plan
  timeout: 2h
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - when: manual
  variables:
    CLAUDE_PROMPT: "/test-plan-create {discovered-RHAISTRAT-keys}"
    CLAUDE_PLUGINS: "https://github.com/opendatahub-io/odh-test-gen.git"
  script:
    # 1. Query Jira for RHAISTRAT issues with strat-creator-human-sign-off label
    # 2. Run Claude Code with /test-plan-create for each
    # 3. Parse TestPlanReview.md frontmatter
    # 4. POST to org-pulse (like rfe-assessor does)
    # 5. Fork opendatahub-test-plans, commit files, open PR
```

**New repo needed:**

- **test-plan-generator** (GitLab) — new repo following rfe-assessor pattern
  - `scripts/discover-approved-features.py` — Query Jira for strat-creator-human-sign-off
  - `scripts/push-to-org-pulse.py` — POST TestPlanReview data to dashboard
  - `scripts/publish-to-github.sh` — Fork, commit, PR to opendatahub-test-plans
  - `.gitlab-ci.yml` — Scheduled job + manual trigger

**Secrets needed in GitLab CI:**

- `ORG_PULSE_URL` / `ORG_PULSE_API_TOKEN` — org-pulse dashboard API
- `GITHUB_TOKEN` — fork opendatahub-test-plans, create PRs
- `JIRA_EMAIL` / `JIRA_TOKEN` — query for approved features
- `GCP_SA_KEY` — Claude Code (Vertex AI)

**Script responsibilities:**

1. **discover-approved-features.py**:
   - JQL: `project = RHAISTRAT AND labels = strat-creator-human-sign-off AND labels NOT IN (test-plan-auto-created)`
   - Returns list of keys to process
   - Marks processed by adding `test-plan-auto-created` label

2. **push-to-org-pulse.py**:
   - Parse TestPlanReview.md frontmatter (scores, verdict, reviewed_at)
   - Enrich from TestPlan.md (feature name, components)
   - Count TC-*.md files
   - POST to `/api/modules/ai-impact/test-plans/bulk`

3. **publish-to-github.sh**:
   - Fork opendatahub-test-plans (if not already forked)
   - Create branch: `test-plan/{feature-slug}`
   - Commit TestPlan.md, TestPlanReview.md, TestPlanGaps.md, test_cases/
   - Push to fork
   - Open PR to opendatahub-test-plans main with `gh pr create`

**Reference implementation:** https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor

### 2. criterionNotes Gap

**Status**: Tracked in odh-test-gen [#20](https://github.com/opendatahub-io/odh-test-gen/issues/20)

`TestPlanReview.md` stores criterion-level feedback in the markdown body, not in frontmatter fields. The push script will send empty `criterionNotes` initially, which means the org-pulse UI shows "No notes available" when users expand dimension scores in the Test Plan Detail panel.

**Recommended solution**: Modify `/test-plan-create` skill's review phase to write per-criterion notes into structured frontmatter fields (e.g., `criterion_notes.specificity: "..."`). The org-pulse API already validates and stores this field.

**Impact**: Low priority — nice-to-have enhancement for transparency. The dashboard works without it.

### 3. Pipeline Timeline Wiring from Parent Views

**Status**: ✅ **COMPLETE**

The `testPlan` prop on `PipelineTimeline.vue` is now fully wired from both RFE Detail and Feature Detail parent views. Test plan data appears in the pipeline timeline with verdict, score, human approval status, and clickable navigation to Test Plan Detail.

**Implementation**:
- **FeatureDetailPanel.vue**: Imports `useTestPlans()`, loads test plan for `feature.key` when panel opens, passes `:testPlan="testPlanData?.latest"` to PipelineTimeline
- **RFEDetailModal.vue**: Imports `useTestPlans()`, loads test plan for `rfe.linkedFeature.key` when panel opens, passes `:testPlan="testPlanData?.latest"` to PipelineTimeline
- **PipelineTimeline.vue**: Added `test-plan-review` case to `getRFEPhaseSignal()` to display test plan data when viewing RFE
- **Navigation handlers**: Both parent views emit `@navigateToTestPlan` events that route to `test-plan-review` view with select param
- **Fixture alignment**: Updated `rfe-data.json` to link RHAIRFE-1001 → RHAISTRAT-1168 (matching existing feature and test plan data)

**Result**: Complete bidirectional cross-linking across all three pipeline stages (RFE ↔ Feature ↔ Test Plan).

### 4. Multiple Plans Per Key

Multiple test plan directories in odh-test-gen could target the same `source_key` (e.g., re-running the skill after changes). The upsert pattern handles this correctly — the latest `reviewedAt` becomes the `latest` entry, older reviews move to history. The push script should sort by `reviewedAt` before posting to ensure correct ordering.

---

## Key Reference Files

If modifying or extending this feature, these are the patterns to follow:


| Purpose              | Reference file                                               |
| -------------------- | ------------------------------------------------------------ |
| Storage pattern      | `modules/ai-impact/server/assessments/storage.js`            |
| Validation pattern   | `modules/ai-impact/server/assessments/validation.js`         |
| Route pattern        | `modules/ai-impact/server/assessments/routes.js`             |
| Jira sync pattern    | `modules/ai-impact/server/features/jira-sync.js`             |
| View pattern         | `modules/ai-impact/client/views/FeatureReviewView.vue`       |
| List pattern         | `modules/ai-impact/client/components/FeatureList.vue`        |
| Detail panel pattern | `modules/ai-impact/client/components/FeatureDetailPanel.vue` |
| Composable pattern   | `modules/ai-impact/client/composables/useFeatures.js`        |
| Fixture pattern      | `fixtures/ai-impact/assessments.json`                        |
| Push script pattern  | `rfe-assessor/scripts/push-to-org-pulse.py`                  |


