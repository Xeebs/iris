# Iris — Build Pipeline Changelog

Completed tasks are logged here by the daemon after each successful commit.

---

- 2026-06-08 | Search Relevance Tuning & Ranking Improvements | RelevanceTuner (loadWeights, updateWeight, recordFeedback, analyzeFeedback, resetWeights), computeBlendedScore (embedding+bm25+type_boost+recency_decay+relationship_penalty), validateWeights, DEFAULT_WEIGHTS, migration 114 (search_tuning_config + search_feedback), REST routes (GET/PUT/DELETE weights, POST feedback, GET metrics), 37 tests pass (24 unit + 13 route), relevance-tuner-panel.tsx (weight sliders + feedback table + 2-tab layout)
- 2026-06-08 | Native Document Indexing from Connector Sources | DocumentIndexer (extractTextFromPDF, extractTextFromDocx, extractTextFromPlainText, indexDocument with content-hash dedup, searchDocuments via FTS, deleteByConnector, getIndexingStats), migration 113 (indexed_documents + FTS + workspace/connector/recency indexes), REST routes (GET /search, GET /stats, POST /import/bulk, DELETE /connector/:id), 36 tests pass (24 unit + 12 route)
- 2026-06-08 | Query Explanation Engine & Context Relevance Debugging | QueryExplainer (explainRetrieval, detectRetrievalAnomaly, suggestContextExpansion), pure helpers (freshnessBonus, relationshipBonus, typeMatchBonus, breakdownScoring, buildRelevanceReason), 4 anomaly types (empty_results, single_entity_type, low_avg_score, all_stale), REST POST /api/v1/queries/:id/explain, 41 tests pass (32 unit + 9 route), query-explanation-panel.tsx (expandable entity rows, anomaly alerts, expansion suggestions), scoring-breakdown-chart.tsx (stacked bar + factor rows)
- 2026-06-08 | MCP Resources Implementation for Documents & Entities | glossary-resource.ts (registerGlossaryResource with GlossaryService integration), REST GET /api/v1/mcp/resources discovery endpoint (4 resource types with hydrated sample URIs, mimeTypes, rate limits), 24 tests pass (15 discovery + 9 resource), dashboard resources page (already committed), all 4 resource types: entity, document, entity-graph, glossary
- 2026-06-08 | Comprehensive Connector Integration Test Suite (V1 Connectors) | 101 MSW-based tests across 5 connectors: Jira (20 tests, 86% cov), Confluence (20 tests, 85% cov), Linear (22 tests, 97% cov), NetSuite (21 tests, 87% cov), QuickBooks (18 tests, 87% cov); all connectors exceed 80% coverage; fixtures in connector-local tests/fixtures/; all tests pass
- 2026-06-08 | Context Budget Real-Time Monitoring & Alerting System | BudgetMonitor (trackQueryBudget, computeBudgetUtilization, detectBudgetAnomalies via Z-score, suggestBudgetAdjustments, emitBudgetAlert, getActiveAlerts), pure helpers (mean, stdDev, zScore, utilizationToSeverity, alertThresholdsCrossed), migration 112 (workspace_budgets, budget_usage_events, budget_alerts), REST routes (GET budget-status, PUT budget-config, GET budget-history), 43 tests pass (33 unit + 10 route), dashboard widgets (budget-status-gauge.tsx, budget-usage-timeline.tsx, budget-alerts-panel.tsx)
- 2026-06-08 | Semantic Deduplication Verification & Dashboard | DedupInspector (analyzeDedupClusters, compareEntities, suggestMerge, approveMerge, explainDedupDecision), computeCompletenessScore, diffAttributes, matchingAttributes, scoreCanonicalCandidates, migration 111, dedup-admin routes (clusters, members, merge, dedup-status), 30 unit tests + 11 route tests pass, dedup-cluster-explorer.tsx (sortable/filterable table), entity-comparison-panel.tsx (side-by-side diff + merge buttons), dedup-analysis/page.tsx
- 2026-06-08 | Query Cost Estimation & Optimization Recommendation Engine | QueryCostEstimator (analyzeQueryStructure, estimateDeltaTokens, estimateContextTokens, computeCostCents, rankOptimizations, predictCacheSavings), PROVIDER_PRICING for 4 providers, migration 110, REST routes (POST estimate-cost, GET cost-history), 16 unit tests + 10 route tests pass, query-cost-breakdown.tsx (TokenBar, OptimizationList, HistoryTable, Estimator + History tabs)
- 2026-06-08 | Connector Health Monitoring Dashboard Enhancement | ConnectorHealthMonitor (trackSyncMetrics, detectUnhealthyState, suggestRecovery, emitHealthAlert, getHealthScore, acknowledgeAlert), computeHealthScore (weighted 50/20/20/10), scoreToSeverity, inferFailureType, migration 109, 35 unit tests, connector-health-scorecard.tsx (ScoreMeter, SubScoreBar, AlertCard, RecoveryCard, 3-tab UI)
- 2026-06-08 | Dashboard E2E Test Coverage for Admin & Settings Pages | 62 Playwright tests covering 18 admin page sections: admin console, users, billing, DLQ, webhooks, SSO, backup, logs, compliance, dedup, query analytics, sync monitoring, index health, MCP tools, workspace management, performance, and REST API endpoint coverage (api-keys, sso, cost-audit, dedup, PII, data-quality, settings); fixtures: admin-user.json + test-workspace-config.json
- 2026-06-08 | MCP Server Tool Integration Test Suite | 36 tests across all 8 tool types: advanced-query-context (filter, aggregation, chained, workspace guard), detect-anomalies (anomalies, no-anomalies, forecast, errors), query-context-at-date (server.tool, historical query), query-federated-context (merged results, permission denied), auto-tool-registry (dynamic registration, fetch, loadSpecs), streaming-context (expansionKey flow, workspace mismatch), aggregate-entities (count, filters), compare-entities (diff table, no-entities); vitest.config.ts: added context-versioner and federation-manager aliases
- 2026-06-08 | Complete Test Suite for Untested API Routes | 17 route test files (audit, entities, queries, cache-stats, dsr, index-optimization, pii-config, suggestions, enrichment-config, data-quality, sso-config, api-key-management, query-analytics, schema-migrations, admin-dedup, admin-cost-audit, workspace-costs); 96 tests covering happy paths, validation, auth, and error cases
- 2026-06-08 | Context Delta Streaming & Incremental MCP Responses | hashContextSnapshot, computeContextDelta (field-level diffs), streamDeltaAsChunks (token-bounded), encodeContextDelta (reference compression), captureContextSnapshot/getClientContextState/resetClientState (30min TTL), writeDeltaAudit/getDeltaHistory, migration 108, 36 tests pass, context-delta-analyzer dashboard component
- 2026-06-08 | Webhook Management & Testing Dashboard | WebhookDebugger (semantic-core), webhook-admin routes (api), admin page + 5 dashboard components (list-table, event-log, test-panel, retry-queue, debugger); 23 tests pass
- 2026-06-08 | Comprehensive Load Testing & Performance Baseline Suite | 4 k6-style Node.js load scripts (api-stress, mcp-throughput, sync-concurrency, index-query), load-test-config.ts with thresholds, 21 unit tests, CI workflow, PERFORMANCE_BASELINE.md
- 2026-06-08 | Data Lineage Tracking & Impact Analysis Engine | DataLineageService (origin, transformation chain, dependency graph, impact BFS), migration 091, data-lineage routes, 12+23 tests, dashboard page + lineage-flow-diagram + impact-visualizer components
- 2026-06-08 | Smart Schema Field Mapping & Connector Auto-Configuration | areSemanticAliases (alias table for 8 canonical fields), detectTransformationType (direct/compute/lookup/aggregate), computeMappingConfidence, suggestEntityMapping, validateMappingLogic, generateMappingCode, learnFieldMappings, migration 107, 36 tests pass, field-mapping-assistant dashboard component
- 2026-06-08 | Multi-LLM Agent Context Learning & Feedback Loop | inferFeedback (positive: entity ID quoting; negative: re-query), computeWeightAdjustment, recordAgentUsage/recordUserFeedback, updateRelevanceWeights, suggestContextExpansion, getAgentInsights, migration 106, 30 tests pass, agent-feedback-dashboard component
- 2026-06-08 | Event-Driven Real-Time Sync Engine | validateChangeEvent, batchCoalesceEvents (dedup by entity within time window), computeCacheInvalidationKeys, enqueueChangeEvent, markEventFailed (exponential backoff), audit log with cursor pagination, migration 105, 43 tests pass, event-stream-monitor dashboard component with latency percentiles
- 2026-06-08 | MCP Tool Auto-Generation & Dynamic Schema Binding | generateToolsFromConnectorSchema (query + list-metrics tools per entity), buildToolInputSchema (PII field exclusion), versionToolDefinition (breaking change detection), validateToolUsage, auto-tool-registry MCP server integration, migration 104, 34 tests pass, auto-tool-registry dashboard component
- 2026-06-08 | Intelligent Query Clustering & Adaptive Cache TTL Engine | k-means clustering on query embeddings, extractClusterSignature, predictOptimalCacheTtl (stable_reference/moderate/high_velocity), adaptive TTL assignment, cascade invalidation detection, migration 103, 39 tests pass, query-clustering-analysis dashboard component
- 2026-06-08 | Relationship Inference & Hidden Link Discovery Engine | Co-occurrence matrix, implicit relationship scoring (cooccurrence+type+embedding), predictMissingRelationships, admin suggest/confirm/reject API, migration 102, 28 tests pass, relationship-suggestions-panel dashboard component
- 2026-06-08 | Intelligent Query Optimizer & Execution Planner | QueryOptimizer (selectivity analysis, strategy selection, cost estimation, execution plan), migration 092, optimization routes, 29+8 tests, query-optimizer-panel dashboard component
- 2026-06-08 | Cache Prewarming & Predictive Context Loading Engine | analyzeQueryPatterns (co-occurrence matrix), predictNextContext (relationship traversal + entity type detection), preloadToCache, measurePrefixCacheHits, migration 097, 25 tests, CacheEffectivenessChart + CacheWarmingStatus components
- 2026-06-08 | SCIM 2.0 User Provisioning & Directory Sync | RFC 7644 SCIM provisioner (provisionUser, provisionGroup, handleDeprovision, getFilteredUsers/Groups, parseSCIMFilter), migration 096, full CRUD REST endpoints, ServiceProviderConfig, SCIMSyncStatus + directory settings page, 42 tests
- 2026-06-08 | GraphQL API Gateway & Schema Federation | SDL schema, parseOperation parser, resolver dispatcher (entity/entities/metrics/glossary/lineage/mutations), batch endpoint, audit log, migration 095, 43 tests, GraphQLQueryBuilder IDE + explorer page
- 2026-06-08 | Enterprise Compliance & Fine-Grained Audit Export | RSA-2048 signed audit reports, SOC2/GDPR/HIPAA formats, anomaly detection (bulk/off-hours/PII), migration 094, 12+16 tests, AuditExportWizard + AnomalyAlertsList dashboard components
- 2026-06-08 | Intelligent Context Summarization Engine | classifyQueryIntent (analytical/operational/reporting/synthesis), rankContextByTaskRelevance (entity type weights), generateTaskSpecificSummary (bullets/JSON/prose by provider), migration 101, 36 tests, ContextSummaryPreview + SummarizationStats
- 2026-06-08 | Context Versioning & Time-Travel Query Engine | captureContextSnapshot (SHA-256 + gzip), queryAsOfDate (historical query), diffContextVersions (cached diff), listVersionHistory (cursor pagination), rollbackToVersion (admin), migration 100, MCP tool query-context-at-date, VersionTimeline + ContextDiffViewer, 30 tests
- 2026-06-08 | Workspace Federation & Cross-Tenant Data Sharing | registerFederatedWorkspace (parent_child/sibling/partner), checkFederatedPermission (exact/wildcard/prefix), queryFederatedContext, mergeFederatedResults (dedup + budget), auditFederatedAccess, migration 099, MCP tool query-federated-context, 38 tests
- 2026-06-08 | Advanced Multi-LLM Cost Optimizer & Provider Router | classifyQueryComplexity (1-10 score), estimateTokenUsage (per provider), rankProvidersByValue (accuracy 50%+cost 30%+speed 20%), selectOptimalProvider, trackProviderAccuracy, migration 098, 41 tests, ProviderCostComparison + LLM routing page
- 2026-06-08 | Semantic Query Learning & Proactive Suggestion Engine | QueryLearningEngine (pattern learning, related query suggestion, missing context, connector expansion recs), migration 093, 16+10 tests, query-recommendations page + 2 dashboard components

- 2026-06-07: feat(semantic-core,api,dashboard): index snapshot export & disaster recovery — IndexSnapshotService (gzip compressed snapshots, pruneOldSnapshots, create/list/restore), migration 040, REST routes /api/v1/snapshots, SnapshotManager dashboard component, 8 tests
- 2026-06-07: feat(semantic-core,api,dashboard): email template system & customization — EmailTemplateService (CRUD + render + variable interpolation), migration 041, REST routes /api/v1/email-templates, EmailTemplateEditor dashboard component with live preview, 21 tests
- 2026-06-07: feat(semantic-core,api,dashboard): distributed tracing & performance profiling — PerformanceProfiler (p50/p95/p99 per operation, Prometheus export, connector breakdown), migration 042, REST /api/v1/performance, ProfilerDashboard with window selector, 11 tests
- 2026-06-07: feat(core,api,dashboard): session management & device tracking — SessionManager (create/refresh/revoke sessions, trusted devices, geo-anomaly detection, 5-session limit), migration 038, REST /api/v1/sessions, SessionList dashboard component, 13 tests
- 2026-06-07: feat(semantic-core,api,dashboard): usage-based billing & metering — BillingMeter (recordUsage, calculateCharges, tier-based pricing, period close), migration 043, REST /api/v1/billing, BillingUsageChart + billing settings page, 11 tests

- 2026-06-07 feat(semantic-core,api,dashboard): proactive context surfacing — suggestion engine with time-of-day patterns, role affinities, co-occurrence analysis + REST API + dashboard widget

- 2026-06-07 feat(semantic-core,api,dashboard,mcp-server): PII field masking (redact/hash/tokenize) + workspace config API + dashboard panel + MCP tool integration + token consumption widget on dashboard overview

- 2026-06-05 | Snowflake Connector — SQL API sync, partition pagination, incremental sync, 17 MSW tests, 97.4% coverage

<!-- Entries appended below by the pipeline daemon -->
- 2026-06-06: COMMITTED Role-Based Context Segmentation — context_roles/role_entity_type_permissions tables (migration 012), ContextPermissionService, filterContextByRole, MCP tool enforcement, 125/125 tests + 43/43 mcp-server tests pass
- 2026-06-07: COMMITTED Knowledge Graph Visualization Dashboard — GET /api/v1/graph/query (BFS entity expansion + filters), SVG force-directed GraphVisualization component, EntityDetailPanel, GraphExplorer with type/relationship filters + search, /graph page; 100/100 API tests pass
- 2026-06-06: COMMITTED Query Decomposition & Entity Type Detection — keyword matching + gpt-4o-mini LLM fallback, in-process cache, retrieval engine integration, 27 unit tests pass
- 2026-06-06: COMMITTED Sync Scheduling & Frequency Configuration — migration 010, SyncScheduleService (BullMQ repeatable jobs), GET/PUT /connectors/:id/schedule endpoints, wizard frequency picker, 26/26 queue tests + 37/37 API tests pass (fixed mock bleed via mockReset on queue method fns)
- 2026-06-04: COMMITTED Package Manifests — package.json, tsconfig.json, turbo.json, pnpm workspace; root typecheck passes
- 2026-06-04: COMMITTED Local Infrastructure — docker-compose (postgres/pgvector, redis, qdrant), postgres-init.sql, db:migrate stub
- 2026-06-04: COMMITTED Logger — structured JSON logger, sensitive key scrubbing, child() factory, 10/10 tests pass
- 2026-06-04: COMMITTED Error Types — IrisError hierarchy, ConnectorError (retryable), neverthrow Result helpers, 9/9 tests pass
- 2026-06-04: COMMITTED Config Loader — zod env var validation, defaults, caching, _resetConfig for tests, 8/8 tests pass
- 2026-06-04: COMMITTED Connector Registry — ConnectorRegistry class with register/get/list/validateConfig, 12/12 tests pass
- 2026-06-04: COMMITTED Connector Test Utilities — createMockConnector() vi.fn stubs, assertEntityShape() shape validator
- 2026-06-04: COMMITTED HubSpot Connector — connect/sync/getSchema/healthCheck, MSW tests, 14/14 pass
- 2026-06-04: COMMITTED Notion Connector — page/database_row sync, property extraction, MSW tests, 13/13 pass
- 2026-06-04: COMMITTED Embedding Service — OpenAI text-embedding-3-small wrapper, batching, PII scrubbing, truncation, 10/10 tests
- 2026-06-04: COMMITTED Vector Store Interface — VectorStore interface + PgvectorStore (postgres + pgvector), integration tests
- 2026-06-04: COMMITTED Indexer Implementation — flushBatch with dedup (0.85 threshold), cosineSimilarity, 9/9 tests
- 2026-06-04: COMMITTED Retrieval Engine — queryContext with graph expansion, workspace isolation, 8/8 tests
- 2026-06-05: COMMITTED Semantic Cache — Redis-backed semantic cache (0.92 cosine threshold), set/get/invalidate, 12/12 tests pass
- 2026-06-05: COMMITTED Compression Pipeline — dedup/truncate/serialize stages, char-level budget enforcement, 19/19 tests pass
- 2026-06-05: COMMITTED MCP Server Bootstrap — 5 tools (query-context, list-entities, get-entity, get-metric, list-glossary), VectorStore extended, 15/15 tests pass
- 2026-06-05: COMMITTED Audit Logger — Postgres-backed MCP audit log, cursor pagination, error-resilient insert, 9/9 tests pass
- 2026-06-05: COMMITTED API Server Bootstrap — Hono app with connectors/entities/queries/audit routes, Clerk auth middleware, standard error envelope, 9/9 tests pass
- 2026-06-05: COMMITTED Prefix Cache Manager — buildPrefixContent (deterministic, sorted), PrefixCacheManager (get/set/invalidate), Redis-backed with 24h TTL, 13/13 tests pass
- 2026-06-05: COMMITTED Salesforce Connector — Contact/Account/Opportunity sync via SOQL, incremental cursor, pagination, MSW tests, 13/13 pass
- 2026-06-05: feat(tests): Playwright E2E test suites for connector lifecycle, query API, token analytics; fix ioredis import in mcp-server
- 2026-06-05: feat(graph): Neo4j GraphStore implementation with workspace isolation, unit tests, docker-compose Neo4j service
- 2026-06-06: feat(semantic-core): entity relationship indexing and graph-aware retrieval expansion
- 2026-06-06: feat(connector-airtable): Airtable connector with OAuth2, bases/tables/records sync, incremental filtering, MSW tests
- 2026-06-06: feat(connector-slack): Slack connector with channels/users/messages sync, relationship edges, incremental cursor
- 2026-06-06: feat(semantic-core): IndexStatusService with per-type entity counts, REST endpoint, dashboard component
feat(api): webhook-driven real-time sync (HubSpot + Slack HMAC validation, 10 tests)
- 2026-06-06: feat(semantic-core,mcp-server): Role-Based Context Segmentation — context_roles table, ContextPermissionService, filterContextByRole pure function, MCP tools (query-context/list-entities/get-entity) integrated; 125/125 semantic-core tests pass
2026-06-07 feat(queue,api,dashboard): sync job error recovery & dead letter queue — deadletter_jobs migration, DlqService with archive/list/retry, admin routes GET /admin/dlq + POST /admin/dlq/:id/retry, DlqInspector component, /admin/dlq dashboard page
- feat(semantic-core,api,dashboard): workspace data export & backup service — DataExporter, export jobs table, REST routes, admin import, BackupManager UI, 33 tests
- feat(connector-sdk,api): custom connector framework & user-extensible SDK — loadUserConnector, validateConnectorDefinition, REST CRUD, migration 023, 26 tests
- feat(api,semantic-core,dashboard): cross-connector entity linking & data enrichment (667a392)
- feat(mcp-server,semantic-core): advanced MCP query features & aggregations (f921772)
- feat(connector-sdk,dashboard): comprehensive webhook validation & testing suite (75973e2)
- feat(api,dashboard,queue): real-time sync performance monitoring dashboard (9651820)
feat(dashboard,api): admin dashboard pages & system monitoring suite (Layer 44)
feat(semantic-core,api,dashboard): native document indexing from connector sources (Layer 45)
feat(semantic-core,api,dashboard): search relevance tuning & scoring UI (Layer 45)
ae4d218 feat(semantic-core,api,dashboard): entity enrichment engine with external data integration
8778e5b feat(semantic-core,api,dashboard): schema evolution manager with backwards-compatible migration
fe1aa1e feat(semantic-core,api,dashboard): query analytics engine with cache hit prediction
4ceb035 feat(semantic-core): proactive context engine integration tests and suggestion cache migration
f57c456 feat(semantic-core): data lineage integration tests and enhanced lineage schema migration
Entity Validation Engine with Data Quality Rules — entity-validator + rules/failures DB + REST API + dashboard UI
Index Rebuild & Corruption Recovery Tools — IndexRepairService + integrity_scans/rebuild_jobs DB + REST API + dashboard panels
Custom Transformation Pipeline & Entity Mapping Language — TransformationDSLEngine with 11 op types + REST API + live test panel
- feat(semantic-core,api,mcp-server,dashboard): query anomaly detection & metrics forecasting engine — Z-score detector, exponential smoothing forecast, REST routes, MCP tool detect-anomalies, anomaly-timeline.tsx
- feat(mcp-server): advanced MCP aggregation & comparison tools with server registration
- feat(scripts): CLI tooling & developer experience enhancements — iris-cli with connector:test, mcp:debug, index:inspect, sync:simulate
- feat(connector-google-drive): complete Google Drive connector with folder tree, pagination, error handling tests
- feat(connector-postgres): PostgreSQL direct connector with sql-query-builder, transformers, 27 tests
- feat(semantic-core,api,dashboard): schema auto-discovery with human-in-the-loop confirmation — dd4e65a
- feat(semantic-core,api,dashboard): batch sync optimization & performance tuning — 1b429f8
- feat(semantic-core,api,dashboard): multi-LLM router & provider abstraction layer — 6e6c729
- feat(semantic-core,api,dashboard): advanced entity linking & normalization engine — 762f03c
- feat(semantic-core,api,dashboard): MCP tool versioning & backwards compatibility manager — 2ca8651
- feat(semantic-core,api,dashboard): end-to-end connector monitoring & health scoring system — 382e02d
- feat(semantic-core,api,dashboard): end-to-end connector monitoring & health scoring system — 382e02d
- feat(semantic-core,api,dashboard): API rate limiting & quota management system — 02fd1a7
- feat(semantic-core,api,dashboard): advanced entity search & filtering engine — cb3d34d
- feat(semantic-core,api,dashboard): streaming context SSE delivery for large MCP result sets — 727b310
- feat(semantic-core,api,dashboard): batch entity import/export with CSV/JSON support — 90a0012
- feat(semantic-core,api,dashboard): OSI interchange import + export wizard UI — cf32e8e
- feat(semantic-core,api,dashboard): PII field masking audit trail & admin dashboard — 041d271
- feat(semantic-core,api,dashboard): connector circuit breaker with DB-backed state machine — a3b0d38
- feat(semantic-core,api,dashboard): SLO monitoring engine with attainment tracking and violation detection — 6f59154
- feat(semantic-core,api,dashboard): intelligent backup with PITR and RTO/RPO metrics — e6fdc0f
