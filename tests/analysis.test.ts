import { describe, it, expect } from 'vitest';
import { Store } from '../server/store';
import { AnalysisService, selectRecords } from '../server/analysis';
import type { ExecutionRecord } from '../shared/types';

const row = (id: string, timestamp: string, overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  id, timestamp, agent: 'Rio', actionType: 'linkedin_touch', target: 'Amina', detail: 'Sent a message to Amina', status: 'success', outputLink: null,
  entityKey: `linkedin:${id}`, recordKind: 'execution', metadata: {}, source: { path: '/source.md', line: 1 }, ...overrides,
});
const now = new Date('2026-11-15T12:00:00+05:00');
describe('grounded analysis', () => {
  it('restricts LinkedIn this week to actual dated completed touches', () => {
    const rows = [row('this-week', '2026-11-10'), row('old', '2026-11-08'), row('planned', '2026-11-14', { status: 'planned' }), row('job', '2026-11-14', { actionType: 'job_application' })];
    expect(selectRecords('who did Rio contact on LinkedIn this week?', rows, now, 'Asia/Karachi').map(r => r.id)).toEqual(['this-week']);
  });
  it('works locally without a key and cites only actual records', async () => {
    const store = new Store(':memory:'); const service = new AnalysisService(store, { apiKey: '', model: 'gpt-4.1-mini', dailyLimit: 20, timezone: 'Asia/Karachi' });
    const result = await service.ask('LinkedIn today', [row('one', '2026-11-15')], now);
    expect(result.mode).toBe('local'); expect(result.citations).toEqual(['one']); expect(result.text).toContain('Amina'); expect(store.calls('2026-11-15')).toBe(0); store.close();
  });
  it('never displays model-invented prose or unknown citations and caches valid selections', async () => {
    const store = new Store(':memory:'); let calls = 0;
    const fakeFetch: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ recordIds: ['one', 'made-up'], text: 'Invented 9000 sales' }) }] }] }), { status: 200 }); };
    const service = new AnalysisService(store, { apiKey: 'test-key', model: 'gpt-4.1-mini', dailyLimit: 1, timezone: 'Asia/Karachi' }, fakeFetch);
    const rows = [row('one', '2026-11-15')];
    const result = await service.ask('LinkedIn today', rows, now);
    expect(result.text).not.toContain('9000'); expect(result.citations).not.toContain('made-up');
    await service.ask('LinkedIn today', rows, now); expect(calls).toBe(1); store.close();
  });
  it('records provider failures without leaking provider responses or API keys', async () => {
    const store = new Store(':memory:');
    const fakeFetch: typeof fetch = async () => new Response('test-key private provider response', { status: 401 });
    const service = new AnalysisService(store, { apiKey: 'test-key', model: 'gpt-4.1-mini', dailyLimit: 1, timezone: 'Asia/Karachi' }, fakeFetch);
    const result = await service.ask('LinkedIn today', [row('one', '2026-11-15')], now);
    expect(result.mode).toBe('local'); expect(result.text).not.toContain('test-key'); expect(result.scope).toContain('unavailable'); store.close();
  });
  it('never counts daily summary quantities as activities and enforces daily budget', async () => {
    const store = new Store(':memory:'); let calls = 0;
    const fakeFetch: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ output: [] }), { status: 200 }); };
    const service = new AnalysisService(store, { apiKey: 'test-key', model: 'gpt-4.1-mini', dailyLimit: 0, timezone: 'Asia/Karachi' }, fakeFetch);
    const result = await service.digest([row('claim', '2026-11-15', { actionType: 'summary', recordKind: 'summary', detail: 'Sent 500 messages' })], now);
    expect(result.text).toContain('No individual executions recorded'); expect(result.text).not.toContain('500'); expect(calls).toBe(0); store.close();
  });
  it('does not turn an updated pipeline snapshot into a new daily execution', async () => {
    const store = new Store(':memory:'); const service = new AnalysisService(store, { apiKey: '', model: 'gpt-4.1-mini', dailyLimit: 20, timezone: 'Asia/Karachi' });
    const result = await service.digest([row('snapshot', '2026-11-15', { recordKind: 'snapshot', actionType: 'dental_lead' })], now);
    expect(result.text).toContain('No individual executions recorded'); store.close();
  });
  it('interprets attention queries from recorded failures and blockers', () => {
    const rows = [row('blocked', '2026-11-15', { status: 'blocked', actionType: 'task', detail: 'Waiting for brief' }), row('fine', '2026-11-15', { actionType: 'output', metadata: { content: 'Delivered text' } })];
    expect(selectRecords('What needs my attention?', rows, now, 'Asia/Karachi').map(r => r.id)).toEqual(['blocked']);
  });
});
