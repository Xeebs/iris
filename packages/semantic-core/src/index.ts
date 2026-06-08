export type { IndexerConfig, IndexResult } from './indexer.js';
export { DEFAULT_INDEXER_CONFIG, indexEntities, cosineSimilarity } from './indexer.js';
export type { RetrievalOptions, RetrievalResult } from './retrieval.js';
export { DEFAULT_RETRIEVAL_OPTIONS, retrieveContext } from './retrieval.js';
export type { EmbeddingResult, EmbeddingServiceOptions, EmbeddingModel } from './embedding.js';
export {
  buildEmbeddingInput,
  generateEmbeddings,
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_SMALL,
  EMBEDDING_MODEL_LARGE,
  EMBEDDING_DIMENSIONS,
  BATCH_SIZE,
} from './embedding.js';
export type { VectorStore, VectorSearchFilter, VectorSearchResult } from './vector-store.js';
export { PgvectorStore } from './vector-store.js';
export type { GlossaryTerm } from './glossary.js';
export { GlossaryService } from './glossary.js';
export type { Metric, FormulaEvalResult, ParsedFormula } from './metrics.js';
export { MetricRegistry, MetricFormulaEngine } from './metrics.js';
export type { TokenEventInput, DailyTokenSummary, TokenAnalyticsSummary } from './token-analytics.js';
export { TokenAnalytics } from './token-analytics.js';
export type { ApiKeyRecord, ValidatedKey } from './api-key-manager.js';
export { ApiKeyManager, generateRawKey } from './api-key-manager.js';
export type { IndexCoverageByType, IndexStatus } from './index-status.js';
export { IndexStatusService } from './index-status.js';
export type { DomainAnalysis } from './query-decomposer.js';
export { detectEntityTypes, getDomainKeywords, clearDetectionCache } from './query-decomposer.js';
export type { ContextRole, EntityTypePermission, ContextPermissions } from './context-permissions.js';
export { ContextPermissionService, filterContextByRole } from './context-permissions.js';
export type { PiiStrategy, PiiDetectionType, PiiFieldConfig, WorkspacePiiConfig, MaskedEntity } from './pii-masker.js';
export { detectPiiType, maskValue, maskEntity, maskEntities, PiiConfigService } from './pii-masker.js';
export type { InferredFieldType, DiscoveredField, DiscoveredEntityType, DiscoveredSchema, SchemaConfirmation, SchemaFieldDecision } from './schema-discoverer.js';
export { discoverJsonSchema, discoverCsvSchema, discoverSchema, SchemaDiscovererService } from './schema-discoverer.js';
export type { RecentActivity, SuggestedContext, SuggestionResult } from './proactive-suggester.js';
export { generateSuggestions, ProactiveSuggesterService } from './proactive-suggester.js';
export type { OsiExportOptions, OsiNode, OsiDocument } from './osi-exporter.js';
export { entityToOsiNode, glossaryTermToOsiNode, metricToOsiNode, exportToOSI } from './osi-exporter.js';
export type { DuplicateSignals, DuplicatePair, CanonicalLink, DeduplicationReport } from './entity-deduplication.js';
export { nameSimilarity, emailDomainMatch, computeCompositeScore, EntityDuplicateMatcher } from './entity-deduplication.js';
export type {
  ExportOptions,
  ExportedEntity,
  WorkspaceExport,
  GlossaryExport,
  MetricExport,
  RelationshipExport,
  SchemaExport,
  ExportJob,
} from './data-exporter.js';
export { DataExporter } from './data-exporter.js';
export type {
  SyncQualityInput,
  SyncQualityRecord,
  AnomalyType,
  Anomaly,
  AnomalyReport,
  QualityThresholds,
  TrendPoint,
  DataQualityTrend,
} from './sync-quality-monitor.js';
export {
  SyncQualityMonitor,
  computeCompleteness,
  computeUniqueValueRatio,
  computeSchemaStability,
  detectNewAttributes,
  computeZScore,
} from './sync-quality-monitor.js';
export type {
  CostEventType,
  ConnectorCostSummary,
  CostBreakdownReport,
  CostRecommendation,
} from './connector-cost-attribution.js';
export {
  ConnectorCostAttributor,
  computeIndexCostCents,
  computeQueryCostCents,
  computeRoiScore,
} from './connector-cost-attribution.js';
export type {
  WorkspaceRole,
  ResourceType,
  ResourcePermission,
  WorkspaceMember,
  ResourceShare,
  TeamGroup,
} from './collaboration-manager.js';
export {
  CollaborationManager,
  roleHasPermission,
  permissionsForRole,
} from './collaboration-manager.js';
export type {
  RetrievalStrategy,
  RetrievalMetrics,
  StrategyComparison,
  TestSetQuery,
  SearchExperiment,
} from './search-quality-evaluator.js';
export type {
  RecommendationType,
  ImplementationEffort,
  CostRecommendation,
  SpendPattern,
} from './cost-optimizer.js';
export {
  CostOptimizationAdvisor,
  estimateMonthlySavings,
  rankRecommendations,
  filterLowEffort,
} from './cost-optimizer.js';
export {
  SearchQualityEvaluator,
  precisionAtK,
  recallAtK,
  ndcgAtK,
  meanReciprocalRank,
  computeMetrics,
  averageMetrics,
  compareStrategies,
} from './search-quality-evaluator.js';
