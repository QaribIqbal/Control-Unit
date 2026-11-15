import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../server/dashboard.js';
import { daysSince, dentalStage, groupByDay, groupFlags, slotTime, weekDays, whoseMove, dayLabel, moduleOf } from '../src/detail.js';
import type { ExecutionRecord } from '../shared/types.js';

let n = 0;
const rec = (p: Partial<ExecutionRecord>): ExecutionRecord => ({ id: `d${++n}`, agent: 'Rio', timestamp: '2026-11-14', actionType: 'dental_lead', target: `T${n}`, detail: 'x', status: 'unknown', outputLink: null, source: { path: '/x', line: n }, entityKey: `k${n}`, recordKind: 'snapshot', metadata: {}, ...p });

describe('detail helpers', () => {
  it('reads whose move it is from the owner text', () => {
    expect(whoseMove('Qarib')).toBe('qarib');
    expect(whoseMove('Rio (watch)')).toBe('rio');
    expect(whoseMove('Recruiter at Acme')).toBe('third');
    expect(whoseMove('Not recorded')).toBe('none');
    expect(whoseMove(undefined)).toBe('none');
  });
  it('counts days since the last update in the dashboard timezone', () => {
    expect(daysSince(rec({ timestamp: '2026-10-08' }), '2026-11-15', 'Asia/Karachi')).toBe(38);
    expect(daysSince(rec({ timestamp: '2026-11-01', metadata: { updatedAt: '2026-11-14' } }), '2026-11-15', 'Asia/Karachi')).toBe(1);
    expect(daysSince(rec({ timestamp: null }), '2026-11-15', 'Asia/Karachi')).toBeNull();
  });
  it('maps dental milestones onto pipeline columns', () => {
    expect(['Sent', 'Reply', 'Call booked', 'Sale', ''].map(stage => dentalStage(rec({ metadata: { stage } })))).toEqual(['Contacted', 'Replied', 'Call booked', 'Sale', 'Contacted']);
  });
  it('groups by day newest first, undated last', () => {
    const groups = groupByDay([rec({ timestamp: '2026-11-13' }), rec({ timestamp: null }), rec({ timestamp: '2026-11-15' }), rec({ timestamp: '2026-11-15' })], 'Asia/Karachi');
    expect(groups.map(g => [g.day, g.rows.length])).toEqual([['2026-11-15', 2], ['2026-11-13', 1], [null, 1]]);
    expect(dayLabel('2026-11-15', '2026-11-15')).toMatch(/^Today/);
    expect(dayLabel(null, '2026-11-15')).toBe('No date recorded');
  });
  it('groups verification flags by agent and severity', () => {
    const data = buildDashboard([
      rec({ actionType: 'job_application', recordKind: 'execution', status: 'success', agent: 'Rio' }),
      rec({ actionType: 'output', recordKind: 'execution', status: 'success', agent: 'Scout' }),
    ], [], { now: new Date('2026-11-15T12:00:00Z') });
    expect(groupFlags(data).map(g => [g.agent, g.high.length, g.low.length])).toEqual([['Scout', 1, 0], ['Rio', 0, 1]]);
  });
  it('reads slot times, weeks and record modules', () => {
    expect(slotTime(rec({ source: { path: '/p', excerpt: '## 07:00 — IG-1 (Instagram reel) — READY' } }))).toBe('07:00');
    expect(weekDays('2026-11-15')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(moduleOf(rec({ actionType: 'interview' }))).toBe('interviews');
  });
});
