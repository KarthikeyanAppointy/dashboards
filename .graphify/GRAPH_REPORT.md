# Graph Report - .  (2026-05-24)

## Corpus Check
- 51 files · ~56,402 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 286 nodes · 498 edges · 14 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 51 · Candidates: 84
- Excluded: 54 untracked · 4348 ignored · 1 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `0acd3e6`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `writeJSONError()` - 28 edges
2. `writeJSON()` - 26 edges
3. `main()` - 20 edges
4. `getEnv()` - 18 edges
5. `startAlertEvaluator()` - 12 edges
6. `reportTriggerHandler()` - 11 edges
7. `substituteWorkflowHistoryPlaceholders()` - 10 edges
8. `workflowsHandler()` - 10 edges
9. `buildMsearchBody()` - 8 edges
10. `buildResponse()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `substituteWorkflowHistoryPlaceholders()` --calls--> `workflowHistoryUseGCS()`  [EXTRACTED]
  background-slo/backend/main.go → background-slo/backend/main.go  _Bridges community 6 → community 3_
- `authVerifyHandler()` --calls--> `writeJSONError()`  [EXTRACTED]
  background-slo/backend/main.go → background-slo/backend/main.go  _Bridges community 3 → community 2_
- `queryElasticsearch()` --calls--> `buildMsearchBody()`  [EXTRACTED]
  background-slo/backend/main.go → background-slo/backend/main.go  _Bridges community 8 → community 11_
- `workflowsHandler()` --calls--> `writeJSONError()`  [EXTRACTED]
  background-slo/backend/main.go → background-slo/backend/main.go  _Bridges community 8 → community 2_
- `workflowsHandler()` --calls--> `buildResponse()`  [EXTRACTED]
  background-slo/backend/main.go → background-slo/backend/main.go  _Bridges community 8 → community 10_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (18): AuthContext, STATUS_OPTIONS, CHANNEL_OPTIONS, CONDITION_OPTIONS, EMPTY_RULE, METRIC_OPTIONS, SES_DEFAULT_TEMPLATES, SES_REGION_OPTIONS (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (44): ActivityErrorEntry, AlertHistory, AlertRule, APIResponse, CodefacPipeline, Config, dashboardCacheEntry, esActivityErrorAgg (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (33): alertHistoryHandler(), alertsConfigHandler(), alertsRulesHandler(), alertsRulesTestHandler(), authMeHandler(), codefacPipelinesHandler(), codefacPipelineTriggerHandler(), extractBearerToken() (+25 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (23): allowedGoogleClientIDs(), authVerifyHandler(), corsMiddleware(), EnsureAlertHistoryTable(), EnsureAlertsTable(), EnsureCodefacPipelinesTable(), EnsureNotificationChannelsTable(), EnsureRBACTable() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (18): CHANNEL_DEFS, CHANNEL_OPTIONS, CODEFAC_METRIC_OPTIONS, CONDITION_OPTIONS, COOLDOWN_OPTIONS, DAY_OF_WEEK_OPTIONS, DEFAULT_MESSAGE_TEMPLATES, DEFAULT_REPORT_TEMPLATES (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (5): CARD_WINDOW_MAP, formatLatency(), getWindowLatency(), SummaryCards(), WINDOW_OPTIONS

### Community 6 - "Community 6"
Cohesion: 0.2
Nodes (15): alertRuleInCooldown(), applyCodefacWorkflowPayload(), applyWorkflowHistoryReplacement(), fetchWorkflowHistory(), historyReplacementString(), injectWorkflowHistoryJSON(), newUUIDv4(), replaceHistoryPlaceholders() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (1): NAV_SECTIONS

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (11): extractP100TopN(), formatP100Report(), getGCPIdentityToken(), parseActivityErrorStatusFilter(), parseStatusFilter(), queryElasticsearch(), reportTriggerHandler(), resolveESBaseURL() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (9): AlertSetupModal(), CHANNEL_OPTIONS, CONDITION_OPTIONS, DEFAULT_METRICS_BY_TILE, getTileType(), resolveMetricOptions(), SES_DEFAULT_TEMPLATES, SES_REGION_OPTIONS (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.29
Nodes (8): buildResponse(), computeRateData(), formatCloseTime(), formatPercentage(), formatRate(), parseRecentHits(), parseTotalHits(), parseWindowResponse()

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (7): buildActivityErrorQuery(), buildDomainFilter(), buildMsearchBody(), buildP100ByWorkflowTypeQuery(), buildRecentQuery(), buildTasklistLatencyQuery(), buildWindowQuery()

### Community 13 - "Community 13"
Cohesion: 0.4
Nodes (3): ACTIVITY_STATUS_OPTIONS, normalizeStatus(), toggleStatus()

### Community 14 - "Community 14"
Cohesion: 0.5
Nodes (4): fetchWorkflowHistoryAllPages(), fetchWorkflowHistoryPage(), normalizeNextPageToken(), parseHistoryPageBody()

## Knowledge Gaps
- **88 isolated node(s):** `Config`, `Tenant`, `AlertRule`, `CodefacPipeline`, `NotificationChannel` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 7`** (1 nodes): `NAV_SECTIONS`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TenantStore` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `tenantsHandler()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `main()` connect `Community 3` to `Community 1`, `Community 2`, `Community 8`, `Community 6`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `Config`, `Tenant`, `AlertRule` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._