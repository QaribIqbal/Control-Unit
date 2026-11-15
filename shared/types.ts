export type Status = 'success' | 'failed' | 'blocked' | 'pending' | 'in_progress' | 'planned' | 'published' | 'unknown';
export interface SourceRef { path: string; line?: number; sheet?: string; row?: number; excerpt?: string }
export interface ExecutionRecord {
  id: string;
  agent: string;
  timestamp: string | null;
  actionType: string;
  target: string;
  detail: string;
  status: Status;
  outputLink: string | null;
  source: SourceRef;
  entityKey: string;
  recordKind: 'execution' | 'snapshot' | 'summary';
  metadata: Record<string, string | number | boolean | null>;
}
export type SourceKind = 'applications' | 'opportunities' | 'linkedin' | 'dental' | 'social' | 'memory' | 'inbox';
export interface SourceReport {
  path: string; kind: SourceKind; status: 'ok' | 'missing' | 'error';
  records: number; skipped: number; message: string; importedAt: string;
}
export interface ImportResult { records: ExecutionRecord[]; sources: SourceReport[] }
export interface AttentionItem { kind: 'stale' | 'blocked' | 'failed'; recordId: string; days?: number; waitingOn?: string }
export interface Kpi { id: string; label: string; value: number | null; recordIds: string[]; description: string }
export interface AgentSummary {
  name: string; lastRun: string | null; latestOutput: ExecutionRecord | null;
  failed: string[]; blocked: string[]; recordIds: string[];
}
export interface DashboardData {
  runtime?: { mode: 'local' | 'hosted'; ingestionEndpoint: string; collectorRequired: boolean; lastSyncAt: string | null };
  generatedAt: string; timezone: string; records: ExecutionRecord[];
  sources: SourceReport[]; agents: AgentSummary[]; kpis: Kpi[];
  linkedinDaily: { date: string; count: number; recordIds: string[] }[];
  dentalStages: { stage: string; count: number; recordIds: string[] }[];
  socialPlatforms: { platform: string; planned: number; published: number; blocked: number; older: number; recordIds: string[]; plannedIds: string[]; publishedIds: string[]; blockedIds: string[] }[];
  applicationsDaily: { date: string; count: number; recordIds: string[] }[];
  applicationStages: { stage: string; count: number; recordIds: string[] }[];
  pipelineStages: { stage: string; count: number; recordIds: string[] }[];
  attention: AttentionItem[];
  today: { date: string; items: { key: string; label: string; count: number; recordIds: string[] }[] };
  dentalDaily: { date: string; sent: number; replies: number; calls: number; sales: number; recordIds: string[] }[];
  entities: { applications: ExecutionRecord[]; interviews: ExecutionRecord[]; assessments: ExecutionRecord[]; dental: ExecutionRecord[]; social: ExecutionRecord[] };
  stale: { recordId: string; daysWaiting: number; waitingOn: string }[];
  verification: { recordId: string; reason: string }[];
  analysis: { configured: boolean; model: string; callsToday: number; dailyLimit: number };
}
export interface AnalysisResponse {
  text: string; citations: string[]; mode: 'llm' | 'local';
  generatedAt: string; cached?: boolean; scope?: string;
}
