import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordDetail } from '../src/ui.js';
import type { ExecutionRecord } from '../shared/types.js';

const record: ExecutionRecord = {
  id: 'plan-1', agent: 'Rio', timestamp: '2026-11-15', actionType: 'social_post',
  target: 'IG-1115-1530', detail: '## 15:30 — IG-1115-1530 (Instagram reel, body-listed slot) — BLOCKED\nReason: the locked calendar places the evening IG slot at 22:30, not 15:30.\nNo reel footage exists at all (see 07:00).\nFiles:\n- Missing: IG-1115-1530.mp4 (video), cover frame, caption\n---',
  status: 'blocked', outputLink: null, source: { path: '/PLAN.md', excerpt: '## 15:30 — IG-1115-1530 (Instagram reel, body-listed slot) — BLOCKED' },
  entityKey: 'plan-1', recordKind: 'snapshot', metadata: { platform: 'Instagram' },
};

describe('record detail notes', () => {
  it('renders source notes as readable Markdown while retaining raw evidence', () => {
    const html = renderToStaticMarkup(<RecordDetail record={record} timezone="UTC" />);
    expect(html).toContain('<h2>15:30 — IG-1115-1530 (Instagram reel, body-listed slot) — BLOCKED</h2>');
    expect(html).toContain('not 15:30.<br/>\nNo reel footage exists at all (see 07:00).<br/>\nFiles:');
    expect(html).toContain('<li>Missing: IG-1115-1530.mp4 (video), cover frame, caption</li>');
    expect(html).toContain('<hr');
    expect(html).toContain('<pre class="excerpt">## 15:30 — IG-1115-1530 (Instagram reel, body-listed slot) — BLOCKED</pre>');
  });

  it('does not make unsafe links or HTML from imported notes executable', () => {
    const unsafe = { ...record, detail: '[click](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n[good](https://example.com)' };
    const html = renderToStaticMarkup(<RecordDetail record={unsafe} timezone="UTC" />);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
