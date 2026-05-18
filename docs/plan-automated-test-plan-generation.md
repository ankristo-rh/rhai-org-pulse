# Automated Test Plan Generation Pipeline

## Overview

Automate test plan generation when features receive human approval. A new GitLab CI pipeline monitors Jira for approved RHAISTRAT Feature issues (strat-creator-human-sign-off label), runs the `/test-plan-create` skill, and publishes results to both the org-pulse dashboard API and a GitLab persistence repo.

This eliminates manual test plan creation while maintaining a persistent record of all generated test plans. Manual use of the `/test-plan-create` skill can still publish to GitHub for team review.

---

## Current State

**Manual workflow** (as of today):
1. Developer manually runs `/test-plan-create {RHAISTRAT-XXX}` in odh-test-gen
2. Reviews TestPlanReview.md locally
3. Manually creates PR to opendatahub-test-plans
4. Quality scores not pushed to org-pulse dashboard

**Problems:**
- ❌ Requires manual intervention for each feature
- ❌ No automatic org-pulse dashboard updates
- ❌ Inconsistent — depends on developer remembering to run skill

---

## Proposed Architecture

```
Jira (RHAISTRAT feature issues)
  │ QE/PM adds strat-creator-human-sign-off label when feature is approved
  │
  ▼ Detected by scheduled GitLab CI job (every 3 hours)
NEW: test-plan-generator (GitLab repo)
  │ https://gitlab.com/redhat/rhel-ai/agentic-ci/test-plan-generator
  │
  │ Job: generate-test-plans
  │   1. Clone test-plans-data repo
  │   2. Create timestamped run directory: RHAISTRAT/{YYYYMMDD-HHMMSS}/
  │   3. Query Jira for approved RHAISTRAT Feature issues (via discover-approved-features.py)
  │      JQL: project = RHAISTRAT 
  │           AND type = Feature
  │           AND labels = strat-creator-human-sign-off 
  │           AND labels NOT IN (test-plan-auto-created)
  │   4. Run bulk test plan generation into run directory:
  │      a. Run: /test-plan-create RHAISTRAT-* --output-dir {run-dir}
  │         (skill handles review, scoring, auto-revision for all issues)
  │      b. Skill outputs to {run-dir}/test-plans/RHAISTRAT-{XXX}/...
  │         - TestPlan.md (with frontmatter: feature, components, etc.)
  │         - TestPlanReview.md (with frontmatter: scores, verdict, last_updated)
  │         - TestPlanGaps.md (gap analysis)
  │   5. Conditional test case generation (for high-quality plans only):
  │      Filter: verdict = "Ready" AND score >= 8
  │      Run: /test-plan-create-cases {run-dir}/test-plans/RHAISTRAT-{XXX} ...
  │      Outputs: {run-dir}/test-plans/RHAISTRAT-{XXX}/test_cases/TC-*.md
  │   6. Update current symlink: RHAISTRAT/current → {timestamp}
  │   7. POST test plan reviews to org-pulse /test-plans/bulk API
  │   8. Apply retention policy (last 7 days: daily, 7d-1y: weekly, >1y: delete)
  │   9. Commit and push to test-plans-data repo (includes new run + pruned old runs)
  │   10. Add test-plan-auto-created label to processed Jira issues
  │
  ├─▶ org-pulse dashboard
  │   │ POST /api/modules/ai-impact/test-plans/bulk
  │   │ Quality scores visible immediately
  │   │ Auto-triggers Jira sync
  │   │
  │   ▼
  │  Test Plan Review tab shows metrics, charts, detail panels
  │
  └─▶ test-plans-data (GitLab repo - persistence layer)
      │ Structure: RHAISTRAT/{YYYYMMDD-HHMMSS}/test-plans/{RHAISTRAT-XXX}/...
      │ Symlink: RHAISTRAT/current -> latest run
      │ Direct push (no MR/PR), retention policy applied
      │
      ▼
     Test plan artifacts with historical runs persisted outside org-pulse

Note: Manual /test-plan-create usage can still publish to GitHub for team review
```

---

## Reference Implementation

**Pattern to follow:** https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor

### Similar Components
- Scheduled GitLab CI job monitoring Jira labels
- Claude Code execution with skill plugins
- Result parsing and push to org-pulse API
- Non-blocking failure handling
- Timestamped run directories with retention policy
- OTEL metrics collection for token/cost tracking
- Dual publishing (org-pulse API + GitLab data repo)

### Key Differences

| Aspect | rfe-assessor | test-plan-generator |
|--------|--------------|---------------------|
| **Skill** | `/assess-rfe RHAIRFE-*` | `/test-plan-create RHAISTRAT-*` (plus conditional `/test-plan-create-cases <dir>`) |
| **JQL filter** | `labels = rfe-created` | `project = RHAISTRAT AND type = Feature AND labels = strat-creator-human-sign-off` |
| **Completion label** | `assessment-auto-created` | `test-plan-auto-created` |
| **Output files** | `{key}.result.md`, `scores.csv` | `TestPlan.md`, `TestPlanReview.md`, `TestPlanGaps.md`, `test_cases/TC-*.md` |
| **Frontmatter parsing** | Simple key:value from result.md | YAML frontmatter from TestPlanReview.md |
| **Data repo** | `rfe-assess-data/RHAIRFE/{run}/` | `test-plans-data/RHAISTRAT/{run}/test-plans/` |
| **Org-pulse endpoint** | `/api/modules/ai-impact/assessments/bulk` | `/api/modules/ai-impact/test-plans/bulk` |
| **Payload key** | `assessments` | `testPlans` |
| **Skill output** | Already scored/assessed by skill | Already scored/reviewed/auto-revised by skill |

### What the Skill Already Handles

The `/test-plan-create` skill in odh-test-gen already performs:
- Test plan generation from strategy + ADR
- Quality scoring (5-criteria rubric: specificity, grounding, coverage, clarity, realistic_scope)
- Automated review and feedback
- Auto-revision (up to 2 cycles if score < 8)
- Gap analysis (unresolved questions)
- Test case counting

**No need to replicate** assessment logic in the pipeline. The skill outputs are already production-ready.

---

## New GitLab Repository

**Name:** `test-plan-generator`  
**Location:** `https://gitlab.com/redhat/rhel-ai/agentic-ci/test-plan-generator`  
**Purpose:** Automated test plan generation CI hub

### File Structure

```
test-plan-generator/
├── .gitlab-ci.yml                      # CI pipeline configuration
├── scripts/
│   ├── discover-approved-features.py   # Query Jira for RHAISTRAT Feature issues
│   ├── push-test-plans-to-org-pulse.py # POST TestPlanReview data to dashboard
│   ├── push-results.py                 # Commit and push to GitLab data repo with retention
│   ├── clone-data-repo.sh              # Clone GitLab data repo
│   ├── setup-claude-ci.sh              # Claude Code installation in CI
│   ├── run-claude.sh                   # Claude Code wrapper with OTEL metrics
│   ├── org_pulse_utils.py              # Shared utilities for org pulse API
│   └── otel-*.py                       # OTEL collector and summary scripts
├── README.md
└── LICENSE
```

**Pattern:** Follow [rfe-assessor](https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor) architecture. Scripts will be newly written but inspired by existing implementations.

**Note:** The `/test-plan-create` skill already handles test plan generation, quality scoring, and automated review/revision. No need to replicate assessment logic in the pipeline.

---

## CI/CD Variables

### Required

| Variable | Description |
|----------|-------------|
| `JIRA_EMAIL` | Jira bot user email for API access |
| `JIRA_API_TOKEN` | Jira bot user API token (masked, protected) |
| `RESULTS_PUSH_TOKEN` | GitLab PAT with write_repository scope (masked, protected) |
| `ORG_PULSE_URL` | Org-pulse dashboard URL |
| `ORG_PULSE_API_TOKEN` | Org-pulse API token (masked, protected) |
| `GCP_PROJECT_ID` | GCP project for Vertex AI (Claude Code) |
| `GCP_SERVICE_ACCOUNT_KEY` | GCP service account JSON base64-encoded (masked, protected) |

### Optional

| Variable | Default |
|----------|---------|
| `RESULTS_REPO` | `redhat/rhel-ai/test-plans-data` |
| `JIRA_SERVER` | `https://redhat.atlassian.net` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | `claude-opus-4-6` |
| `CLAUDE_MODEL` | `claude-opus-4-6` |
| `CLAUDE_PLUGINS` | Git URL to odh-test-gen repo (for `/test-plan-create` skill) |

### Skill Configuration

The `/test-plan-create` skill lives in the [odh-test-gen](https://github.com/opendatahub-io/odh-test-gen) repo. The CI job must clone this repo as a Claude Code plugin:

```yaml
variables:
  CLAUDE_PLUGINS: "https://github.com/opendatahub-io/odh-test-gen.git"
```

The `run-claude.sh` script will clone the plugin and pass `--plugin-dir` to Claude Code.

**Note:** Jira bot credentials and org-pulse API token to be provided by Alex Corvin.

---

## CI/CD Pipeline Structure

### Job Template (.claude)

Based on [rfe-assessor pattern](https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor/-/blob/main/.gitlab-ci.yml):

```yaml
.claude:
  tags:
    - aipcc-small-x86_64
  image: registry.access.redhat.com/ubi9/ubi-minimal:latest
  variables:
    FF_TIMESTAMPS: "true"
    CLAUDE_CODE_USE_VERTEX: "1"
    ANTHROPIC_VERTEX_PROJECT_ID: "$GCP_PROJECT_ID"
    CLOUD_ML_REGION: "global"
    DISABLE_AUTOUPDATER: "1"
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-4-6"
    JIRA_SERVER: "https://redhat.atlassian.net"
    JIRA_TOKEN: "$JIRA_API_TOKEN"
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/gcp-key.json"
    RESULTS_REPO: "redhat/rhel-ai/test-plans-data"
  artifacts:
    when: always
    paths:
      - claude-otel.jsonl
      - claude-stderr.log
    expire_in: 30 days
  before_script:
    - bash scripts/setup-claude-ci.sh
    - mkdir -p /root/.tokens && echo "${RESULTS_PUSH_TOKEN:-}" > /root/.tokens/results
    - RESULTS_PUSH_TOKEN="$(cat /root/.tokens/results)" bash scripts/clone-data-repo.sh "$RESULTS_REPO" test-plans
    - chmod -R a+rwX "$CI_PROJECT_DIR"
  script:
    # Create timestamped run directory and set up structure
    - RUN_TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
    - RUN_DIR="test-plans/RHAISTRAT/$RUN_TIMESTAMP"
    - mkdir -p "$RUN_DIR"
    - echo "--- Starting run $RUN_TIMESTAMP ---"
    
    # Step 1: Generate test plans into run directory
    - bash scripts/run-claude.sh "/test-plan-create RHAISTRAT-* --output-dir $RUN_DIR"
    
    # Step 2: Conditional test case generation for high-quality plans (score >= 8)
    - |
      QUALIFIED_DIRS=$(python3 scripts/conditional-test-cases.py --test-plans-dir "$RUN_DIR/test-plans")
      if [ -n "$QUALIFIED_DIRS" ]; then
        echo "Generating test cases for qualified features..."
        bash scripts/run-claude.sh "/test-plan-create-cases $QUALIFIED_DIRS" || echo "WARNING: Test case generation failed (non-blocking)"
      else
        echo "No features qualified for test case generation"
      fi
    
    # Step 3: Update current symlink
    - ln -sfn "$RUN_TIMESTAMP" "test-plans/RHAISTRAT/current"
    
    # Step 4: Push test plan reviews to org-pulse
    - |
      if [ -n "${ORG_PULSE_URL:-}" ] && [ -n "${ORG_PULSE_API_TOKEN:-}" ]; then
        python3 scripts/push-test-plans-to-org-pulse.py \
          --features-dir "$RUN_DIR/test-plans" || echo "WARNING: Org pulse push failed (non-blocking)"
      fi
    
    # Step 5: Commit and push to GitLab data repo with retention policy
    - |
      RESULTS_PUSH_TOKEN=$(cat /root/.tokens/results) python3 scripts/push-results.py \
        --results-dir test-plans --results-repo "$RESULTS_REPO"
    
    # Cleanup
    - rm -rf /root/.tokens
```

### Jobs

**generate-test-plans** (scheduled)
- Runs on schedule (every 3 hours)
- Queries Jira for approved features
- Generates test plans via `/test-plan-create` skill
- Conditionally generates test cases via `/test-plan-create-cases` for high-quality plans (score >= 8)
- Pushes to org-pulse + GitLab data repo
- Timeout: 4 hours
- Resource group: `generate-test-plans` (prevents concurrent runs)

**test-test-plans** (manual)
- Manual trigger for testing with limited feature set
- Pass `--limit N` to Jira query, process only N features
- Dry-run mode for org-pulse push (validate without sending)
- Same conditional test case generation logic
- Timeout: 1 hour

**generate-test-cases-manual** (manual)
- Manual trigger for generating test cases for specific features
- Use when test plan was previously generated but scored < 8, now improved
- Use when you want to regenerate test cases after test plan updates
- Prompt: `/test-plan-create-cases test-plans/RHAISTRAT-{XXX} test-plans/RHAISTRAT-{YYY} ...`
- Can process multiple features in parallel (skill handles directory args)
- Pushes updated test cases to GitLab data repo
- Timeout: 2 hours

## Pipeline Schedule

**Recommended:** Every 3 hours (8 times/day)

**Rationale:**
- Features approved throughout workday
- 3-hour latency acceptable (not time-critical)
- Balances freshness vs resource usage
- Matches rfe-assessor scheduling

**Configuration:** GitLab UI → CI/CD → Schedules → `0 */3 * * *`

---

## Test Case Generation Strategy

### Decision: Conditional Automatic + Manual On-Demand

The pipeline uses a **two-tier approach** for test case generation:

#### Tier 1: Automatic for High-Quality Plans
- **Trigger:** `verdict == "Ready" AND score >= 8`
- **Rationale:** High-quality test plans have sufficient detail and clarity for automated TC generation
- **Benefits:**
  - Reduces time-to-implementation for ready features
  - Maximizes value of automated pipeline
  - No manual intervention needed for most common case

#### Tier 2: Manual for Lower-Quality Plans
- **Trigger:** Manual job invocation by QE
- **Use cases:**
  - Test plan scored < 8 initially but was later improved
  - Test plan needs human review before TC generation
  - Need to regenerate TCs after test plan updates
- **Command:** `/test-plan-create-cases test-plans/RHAISTRAT-XXX ...`
- **Benefits:**
  - QE retains control over when TCs are generated
  - Allows for gap resolution before TC generation
  - Supports iterative refinement workflow

### Why Not Always Generate Test Cases?

**Cost:** Each `/test-plan-create-cases` run generates 15-50+ test cases with multiple Claude API calls. Running for every feature (regardless of quality) would:
- Increase pipeline runtime (risk timeout)
- Increase token costs significantly
- Generate TCs for incomplete/low-quality plans (wasted effort)

**Quality:** Test plans with score < 8 often have:
- Missing endpoint details
- Unclear test objectives
- Unresolved gaps flagged in TestPlanGaps.md
- Generating TCs from these would produce incomplete or incorrect test specifications

### Alternative Considered: Always Run

We considered always running `/test-plan-create-cases` for every feature but rejected it because:
- Pipeline would need 6+ hour timeout (vs current 4h)
- Token costs would ~2x
- Many generated TCs would need rework after human test plan review
- Better to wait for human approval on lower-quality plans

## Workflow Details

### 1. Feature Discovery (discover-approved-features.py)

**JQL Query:**
```sql
project = RHAISTRAT 
AND type = Feature
AND labels = strat-creator-human-sign-off 
AND labels NOT IN (test-plan-auto-created)
AND status NOT IN (Closed, Rejected)
ORDER BY created ASC
```

**Output:** Space-separated list of RHAISTRAT keys (e.g., "RHAISTRAT-1519 RHAISTRAT-1525")

**Deduplication:** `test-plan-auto-created` label prevents re-processing

**Note:** Project and type filters ensure only approved RHAISTRAT Feature issues are processed.

### 2. Setup Run Directory

**Create timestamped directory:**
```bash
RUN_TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
RUN_DIR="test-plans/RHAISTRAT/$RUN_TIMESTAMP"
mkdir -p "$RUN_DIR"
```

**Structure:**
```
test-plans/RHAISTRAT/20260518-143000/  ← Run directory
└── (skill will create test-plans/ subdirectory here)
```

### 3. Test Plan Generation (Claude Code)

**Command:** `/test-plan-create RHAISTRAT-* --output-dir $RUN_DIR`

**What the skill does automatically:**
1. Fetches strategy from Jira (RHAISTRAT issue)
2. Fetches linked ADRs (if available)
3. Analyzes scope, endpoints, risks, infrastructure
4. Generates test plan with quality scoring (5-criteria rubric)
5. Auto-revises if score < 8 (max 2 revision cycles)
6. Outputs final artifacts with review metadata

**Produces (per feature):**
- `$RUN_DIR/test-plans/RHAISTRAT-{XXX}/TestPlan.md` (frontmatter: feature, components, strategy_key, etc.)
- `$RUN_DIR/test-plans/RHAISTRAT-{XXX}/TestPlanReview.md` (frontmatter: scores, verdict, last_updated, auto_revised, etc.)
- `$RUN_DIR/test-plans/RHAISTRAT-{XXX}/TestPlanGaps.md` (gap analysis with unresolved questions)

**Note:** Using `--output-dir` ensures output goes directly into the data repo run directory.

### 4. Conditional Test Case Generation

**Process:** Script walks `$RUN_DIR/test-plans/` to find qualified features

**Trigger condition:** Parse `TestPlanReview.md` frontmatter:
```python
if verdict == "Ready" and score >= 8:
    # High-quality test plan - generate test cases automatically
```

**Command:** `/test-plan-create-cases $RUN_DIR/test-plans/RHAISTRAT-{XXX} ...`

**Note:** Only processes **current run** (not historical runs), making it fast and focused.

**What the skill does:**
1. Reads `TestPlan.md` (sections on scope, endpoints, test strategy)
2. Reads `TestPlanGaps.md` (avoids creating TCs for pending areas)
3. Generates individual test case files per category (API, UI, E2E, etc.)
4. Creates E2E test cases for all P0 endpoints
5. Validates coverage (endpoints, objectives, priorities)
6. Updates `TestPlan.md` with TC summary and coverage matrix
7. Creates `test_cases/INDEX.md` with organized TC listing

**Produces:**
- `test-plans/RHAISTRAT-{XXX}/test_cases/TC-*.md` (individual test case specifications)
- `test-plans/RHAISTRAT-{XXX}/test_cases/INDEX.md` (organized listing with stats)
- Updated `TestPlan.md` sections 5, 6, 10 (TC organization, E2E coverage, summary)

**Rationale for conditional generation:**
- Only high-quality test plans should generate TCs (score >= 8)
- Lower-scored plans may have gaps that need human review first
- Reduces pipeline runtime and token cost for incomplete plans

### 3. Conditional Test Case Filtering (conditional-test-cases.py)

**Purpose:** Filter test plans by quality, output qualified directories for test case generation.

**Process:**
1. Walk `$RUN_DIR/test-plans/` for `*/TestPlanReview.md` files
2. Parse YAML frontmatter to extract:
   - `verdict` (Ready, Revise, Rework)
   - `score` (0-10)
   - `source_key` (RHAISTRAT-XXX)
3. Filter for qualified plans: `verdict == "Ready" AND score >= 8`
4. Output space-separated list of qualified directories to **stdout**
5. Print diagnostic summary to **stderr**

**Example output (stderr - diagnostics):**
```
Conditional test case filter:
  Qualified: 2 features (score >= 8, verdict = Ready)
  Skipped: 1 features

  Qualified features:
    ✓ RHAISTRAT-1519 (score: 9, verdict: Ready) - feature_name
    ✓ RHAISTRAT-1530 (score: 8, verdict: Ready) - feature_name

  Skipped features:
    ⊘ RHAISTRAT-1525 (score: 7) - feature_name
```

**Example output (stdout - captured by CI):**
```
/path/to/RHAISTRAT-1519 /path/to/RHAISTRAT-1530
```

**CI usage:**
```bash
QUALIFIED_DIRS=$(python3 scripts/conditional-test-cases.py --test-plans-dir "$RUN_DIR/test-plans")
if [ -n "$QUALIFIED_DIRS" ]; then
  bash scripts/run-claude.sh "/test-plan-create-cases $QUALIFIED_DIRS"
fi
```

**Pattern:** Matches `discover-approved-features.py` (filter + output list for CI orchestration).

### 4. Dashboard Publishing (push-test-plans-to-org-pulse.py)

**Input:** `$RUN_DIR/test-plans/` (current run only)  

**Process:**
1. Walk `$RUN_DIR/test-plans/*/TestPlanReview.md` files
2. Parse YAML frontmatter:
   - Required: `source_key`, `scores`, `score`, `verdict`, `last_updated`
   - Optional: `auto_revised`, `before_score`, `before_scores`, `criterion_notes`, `feedback`, `error`
3. Read `TestPlanGaps.md` body content for gap analysis (separate file, not in frontmatter)
4. Enrich from `TestPlan.md` frontmatter (`feature`, `components`)
5. Count `TC-*.md` files in `test_cases/` subdirectory
6. Transform data for API:
   - Top-level keys: snake_case → camelCase (`source_key` → `sourceKey`, `auto_revised` → `autoRevised`)
   - **Nested scores: keep snake_case** (`scope_fidelity`, `actionability`, `consistency` - API requires this)
   - Date conversion: `last_updated: '2026-05-18'` → `reviewedAt: '2026-05-18T00:00:00Z'`
7. POST to `/api/modules/ai-impact/test-plans/bulk` in batches of 25

**Auth:** Bearer token via `ORG_PULSE_API_TOKEN`  
**Error handling:** Non-blocking (always exits 0), logs warnings

**Key implementation details:**
- ✅ Gap analysis read from separate `TestPlanGaps.md` file (not frontmatter with `|` block scalar)
- ✅ Uses skill's `last_updated` field for `reviewedAt` (prevents duplicate history on repeated pushes)
- ✅ Nested score keys **not normalized** - API validation requires snake_case
- ✅ Test case count reflects TCs generated by Step 2 conditional generation

**Tested with:** Real skill output from collection-tests and opendatahub-test-plans repositories.

### 5. GitLab Publishing (push-results.py)

**Process:**
1. Validate run completeness (check for `.md` files, TestPlanReview.md frontmatter)
2. Apply retention policy:
   - Last 7 days: keep latest run per day
   - 7 days to 1 year: keep latest run per week
   - Older than 1 year: delete
3. Stage all changes (including deletions from pruning)
4. Commit with descriptive message: `"RHAISTRAT test plan generation run\n\nCo-Authored-By: Claude ..."`
5. Push to GitLab with retry + rebase (no force push)
6. Add `test-plan-auto-created` label to processed Jira issues

**Data repo structure:**
```
test-plans-data/
└── RHAISTRAT/
    ├── 20260510-143000/          # Timestamped run directories
    │   └── test-plans/
    │       ├── RHAISTRAT-1519/
    │       │   ├── TestPlan.md
    │       │   ├── TestPlanReview.md
    │       │   ├── TestPlanGaps.md
    │       │   └── test_cases/
    │       │       ├── TC-001.md
    │       │       └── TC-002.md
    │       └── RHAISTRAT-1525/
    │           └── ...
    ├── 20260513-092000/
    │   └── test-plans/...
    └── current -> 20260513-092000  # Symlink to latest run
```

**Rationale:** Timestamped runs preserve historical snapshots. Retention policy prevents unbounded growth.

**Note:** Manual `/test-plan-create` usage can still publish to GitHub (opendatahub-test-plans) for team review via PR.

---

## Failure Handling

**Non-blocking design:**
- Scripts always exit 0 (except critical setup failures)
- Partial failures logged, don't block pipeline
- Dashboard push failure doesn't block GitLab push (independent operations)
- Failed features NOT labeled (will retry next run)

**Retry mechanism:**
- Failed features lack `test-plan-auto-created` label
- Next scheduled run automatically retries
- Manual retry: Remove label in Jira

**Error scenarios:**
- Missing TestPlanReview.md: Skip feature, log warning, don't label
- API 401/403: Log auth error, abort batch (check ORG_PULSE_API_TOKEN)
- GitLab push conflict: Retry with rebase (up to 3 attempts)
- Skill timeout: CI job timeout (4h), captures partial output in artifacts

---

## Monitoring and Observability

### OTEL Metrics Collection

Following rfe-assessor pattern, collect token usage and cost metrics:

- **otel-collector.py** - HTTP server listening on port 4318, captures OTLP JSON exports from Claude Code
- **otel-summary.py** - Parse OTEL logs and print summary (input/output tokens, cache hits, estimated cost)
- **Artifacts** - Upload `claude-otel.jsonl` and `claude-stderr.log` to GitLab (30-day retention)

### Key Metrics to Track

1. **Per-run metrics** (from OTEL)
   - Total input tokens (prompt + cache)
   - Total output tokens
   - Cache read tokens (prompt caching efficiency)
   - Estimated cost per run
   - Run duration

2. **Pipeline health** (from CI logs)
   - Features processed per run
   - Features skipped (errors, missing data)
   - API push success rate (org-pulse, GitLab)
   - Retention policy stats (runs pruned, runs kept)

3. **Org-pulse dashboard** (from API response)
   - Test plans created/updated/unchanged
   - Entry-level errors (invalid frontmatter, missing fields)
   - Batch-level errors (network, auth, validation)

### Alerts and Dashboards

**Recommended alerts:**
- Pipeline failures (non-zero exit code)
- Zero features processed (possible Jira query issue)
- Org-pulse auth failures (token expiration)
- GitLab push failures after 3 retries
- Run duration > 3.5 hours (approaching 4h timeout)

**Recommended dashboards:**
- GitLab pipeline success rate (last 30 days)
- Average features per run (trend over time)
- Token usage per run (identify cost spikes)
- Test plan quality distribution (verdicts: Ready vs Needs Work)

---

## Success Criteria

1. ✅ Pipeline detects RHAISTRAT Feature issues with `strat-creator-human-sign-off` label
2. ✅ Test plans generated automatically via Claude Code
3. ✅ Quality scores appear on org-pulse dashboard within minutes
4. ✅ Test cases generated automatically for high-quality plans (score >= 8, verdict = Ready)
5. ✅ Test plan artifacts pushed to GitLab persistence repo (test-plans-data)
6. ✅ Test case count accurately reflected in org-pulse dashboard
7. ✅ Jira issue labeled with `test-plan-auto-created`
8. ✅ No manual intervention required for standard workflow
9. ✅ Manual job available for regenerating test cases on demand
10. ✅ Failures are non-blocking and logged
11. ✅ No sensitive data leakage (GitLab instead of GitHub)

---

## Rollout Plan

### Phase 1: Repository Setup
- Create test-plan-generator GitLab repo
- Create test-plans-data GitLab repo (persistence layer)
- Configure CI variables (Jira bot, GitLab token, org-pulse token, GCP SA)
- Set up pipeline schedules (every 3h)

### Phase 2: Script Implementation

Write new scripts inspired by [rfe-assessor](https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor):

1. **discover-approved-features.py** - Query Jira for approved RHAISTRAT Features
   - JQL with project + type filters
   - Output: space-separated list of keys

2. **setup-claude-ci.sh** - Install Claude Code in UBI9 minimal container
   - Install git, shadow-utils, python3
   - Create claude-ci user
   - Install Claude Code via curl script
   - Configure GCP credentials
   - Set git safe.directory

3. **run-claude.sh** - Run Claude with OTEL metrics collection
   - Re-exec as claude-ci user if running as root
   - Preflight checks (env vars)
   - Start OTEL collector (otel-collector.py)
   - Run Claude with --dangerously-skip-permissions
   - Stream output (stream-claude.py)
   - Collect token/cost summary (otel-summary.py)
   - Copy artifacts to CI_PROJECT_DIR

3a. **conditional-test-cases.py** - Filter test plans by quality, output qualified directories
   - Walk test-plans/ for TestPlanReview.md files
   - Parse frontmatter (verdict, score)
   - Filter for verdict="Ready" AND score >= 8
   - Output: Space-separated list of qualified feature directories (stdout)
   - Diagnostics: Human-readable summary to stderr
   - CI uses output to invoke run-claude.sh with /test-plan-create-cases
   - Pattern matches discover-approved-features.py (filter + output list)

4. **clone-data-repo.sh** - Clone GitLab data repo
   - Use RESULTS_PUSH_TOKEN for auth
   - Set git user config
   - Skip if already exists

5. **push-test-plans-to-org-pulse.py** - Parse and POST to org-pulse
   - Walk test-plans/ for TestPlanReview.md files
   - Parse YAML frontmatter (simple regex, no PyYAML)
   - Normalize snake_case → camelCase
   - Enrich from TestPlan.md (feature name, components)
   - Count test cases
   - POST in batches of 25
   - Non-blocking (always exit 0)

6. **push-results.py** - Commit and push with retention
   - Validate run completeness
   - Apply retention policy (daily/weekly/yearly)
   - Commit with Co-Authored-By
   - Push with retry + rebase (no force)

7. **org_pulse_utils.py** - Shared utilities
   - push_batch() - HTTP POST with auth
   - push_to_org_pulse() - Batch iteration
   - normalize_field_name() - snake_case → camelCase

8. **otel-collector.py** - Collect OTEL metrics from Claude
9. **otel-summary.py** - Parse and print token/cost summary
10. **stream-claude.py** - Stream Claude output, detect completion

### Phase 2.5: Local Integration Testing (Before CI Deployment)

Before deploying to GitLab CI, validate the pipeline scripts work correctly with org-pulse:

**Step 1: Generate Test Data Locally**
- Run `/test-plan-create` on 1-2 RHAISTRAT features locally in odh-test-gen
- Collect output artifacts:
  - `test-plans/RHAISTRAT-{key}/TestPlan.md`
  - `test-plans/RHAISTRAT-{key}/TestPlanReview.md`
  - `test-plans/RHAISTRAT-{key}/TestPlanGaps.md`
  - `test-plans/RHAISTRAT-{key}/test_cases/TC-*.md` (if generated)

**Step 2: Test org-pulse API Integration**
- Start org-pulse locally in dev mode (`npm run dev:full`)
- Use generated test data as input directory
- Run `push-test-plans-to-org-pulse.py` against local API:
  ```bash
  ORG_PULSE_URL=http://localhost:3001 \
  ORG_PULSE_API_TOKEN=<local-token> \
    python3 scripts/push-test-plans-to-org-pulse.py \
      --features-dir path/to/test-plans
  ```
- Verify data appears in org-pulse dashboard (http://localhost:5173)
- Check Test Plan Review tab for metrics, scores, verdicts

**Step 3: Validate Data Format Compatibility**
- Compare generated TestPlanReview.md frontmatter with org-pulse expectations
- Verify all required fields present (scores, verdict, reviewedAt, etc.)
- Test edge cases:
  - Missing optional fields (gapAnalysis, beforeScores)
  - Error states (skill timeout, parse failures)
  - Zero test cases vs many test cases
- Update `fixtures/ai-impact/test-plans.json` if format changed

**Step 4: Test Script Error Handling**
- Simulate missing TestPlanReview.md (script should skip, log warning)
- Simulate malformed YAML frontmatter (script should skip, log error)
- Simulate API errors (401, 500, network timeout)
- Verify scripts always exit 0 (non-blocking)

**Success Criteria:**
- ✅ Test plan data successfully POSTs to local org-pulse
- ✅ Dashboard displays scores, verdicts, test case counts correctly
- ✅ Fixture format matches pipeline output
- ✅ Error scenarios handled gracefully (non-blocking)

### Phase 3: Testing
- Manual trigger with 1-2 test RHAISTRAT Feature issues
- Verify dual publishing (org-pulse + GitLab data repo)
- Test failure scenarios (missing files, API errors, network issues)
- Verify retention policy (create multiple runs, check pruning)
- Verify no sensitive data in GitLab commits
- Validate OTEL metrics collection

### Phase 4: Automation
- Enable scheduled runs (every 3h)
- Monitor first week of runs (check artifacts, logs, OTEL metrics)
- Tune and optimize (batch sizes, timeouts, retention policy)
- Document troubleshooting procedures

---

## Open Questions

1. **GitLab persistence repo location**: Confirm final path
   - Proposed: `https://gitlab.com/redhat/rhel-ai/test-plans-data`
   - Alternative: `https://gitlab.com/redhat/rhel-ai/agentic-ci/test-plans-data`
   - Needs: Alex to create repo and grant bot write access

3. **Skill plugin source**: Should we use public GitHub or clone to internal GitLab?
   - Option A: Use public `https://github.com/opendatahub-io/odh-test-gen.git` directly
   - Option B: Mirror to internal GitLab for air-gapped CI
   - Consideration: Public repo may have latest skill improvements, internal mirror more secure

4. **Retention policy tuning**: Adjust after observing run frequency/size
   - Current: 7d daily, 7d-1y weekly, >1y delete
   - May need adjustment based on actual data volume

---

## Implementation Status

### Scripts Completed (11 total)

**Core pipeline scripts (7):**
1. ✅ **discover-approved-features.py** (80 lines) - Queries Jira, outputs space-separated keys
2. ✅ **org_pulse_utils.py** (139 lines) - HTTP utilities for API push
3. ✅ **yaml_utils.py** (123 lines) - YAML frontmatter parser (reusable)
4. ✅ **push-test-plans-to-org-pulse.py** (220 lines) - Parse and POST to org-pulse
5. ✅ **conditional-test-cases.py** (130 lines) - Filter by quality, output qualified dirs
6. ✅ **clone-data-repo.sh** (33 lines) - Clone GitLab data repo
7. ✅ **push-results.py** (225 lines) - Git commit/push with retention policy

**CI infrastructure scripts (4):**
8. ✅ **setup-claude-ci.sh** (13 lines) - Install Claude Code in UBI9
9. ✅ **run-claude.sh** (124 lines) - Claude wrapper with OTEL metrics
10. ✅ **otel-collector.py** (107 lines) + **stream-claude.py** (307 lines) + **otel-summary.py** (135 lines)

**Total:** ~1,636 lines of production-ready code

### Testing & Validation

**All scripts validated with real data:**

- ✅ **discover-approved-features.py** - Tested with live Jira, found 27 RHAISTRAT features
- ✅ **push-test-plans-to-org-pulse.py** - Full integration tested
  - Real skill output: collection-tests, opendatahub-test-plans
  - Gap analysis from separate TestPlanGaps.md file
  - Data transformation validated (nested scores stay snake_case)
  - Live API: Successfully POSTed to local org-pulse
  - Edge cases: missing files, malformed YAML, missing required fields
- ✅ **conditional-test-cases.py** - Tested with real skill output
  - Filters correctly by score >= 8 AND verdict = Ready
  - Outputs space-separated directory list
- ✅ **clone-data-repo.sh** - Tested with test-plans-data repo
- ✅ **push-results.py** - Validated with mock run structure
  - Retention policy: prunes >1y, keeps daily/weekly
  - Git commit logic validated
- ✅ **run-claude.sh** - End-to-end tested
  - `/test-plan-create RHAISTRAT-1762` - Generated test plan successfully
  - `/test-plan-create-cases` - Generated test cases successfully
  - OTEL metrics collected and summarized
  - Plugin cloning works (with idempotent skip)
  - Preflight checks validated

**Org-pulse enhancements (bonus):**
- ✅ Gap analysis UI: resolved/new/open visual indicators with color coding
- ✅ beforeScore → history: creates initial entry showing pre-revision state
- ✅ History deduplication: using last_updated prevents duplicate entries

### Architecture Improvements During Implementation

**Original plan:**
- conditional-test-cases.py invoked Claude directly (subprocess mess)
- Scripts walked all historical runs (slow, unnecessary)

**Improved design:**
- Explicit timestamped run directories with `--output-dir`
- conditional-test-cases.py = simple filter (outputs dirs for CI orchestration)
- Scripts process only current run (fast, focused)
- CI explicitly orchestrates Claude invocations (visible, debuggable)

### Remaining Work

1. **Create .gitlab-ci.yml** - Pipeline configuration
2. **Deploy to GitLab** - Push scripts, configure CI variables
3. **Production test** - Run scheduled job with real RHAISTRAT features

---

## Reference Links

- rfe-assessor: https://gitlab.com/redhat/rhel-ai/agentic-ci/rfe-assessor
- test-plan-generator: https://gitlab.com/redhat/rhel-ai/agentic-ci/test-plan-generator (to be created)
- test-plans-data: (GitLab repo URL TBD - persistence layer)
- odh-test-gen: https://github.com/opendatahub-io/odh-test-gen
- opendatahub-test-plans: https://github.com/opendatahub-io/opendatahub-test-plans (manual use only)
- org-pulse Test Plan Review: (URL TBD based on deployment)
