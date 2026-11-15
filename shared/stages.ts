/** Fixed pipeline taxonomy. Free-text stages from Rio's files map onto exactly these six. */
export const STAGES = ['Applied', 'Screening', 'Assessment', 'Interview', 'Offer', 'Closed'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Map free text ("Applied Nov 12", "INTERVIEW HELD Fri Nov 13", "Survey + intro video SUBMITTED") onto the taxonomy.
 * Most advanced evidence wins, except that a terminal word (rejected, withdrawn…) closes the item.
 * `fallback` is used when the text is empty or unrecognised (e.g. the record's own action type).
 */
export function normalizeStage(text: unknown, fallback: Stage = 'Applied'): Stage {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return fallback;
  if (/\b(?:reject(?:ed|ion)?|declin(?:ed|e)|withdr(?:ew|awn)|closed|ghost(?:ed)?|not selected|unsuccessful|lost|expired|no longer|passed on|turned down|cancel(?:l)?ed)\b/.test(t)) return 'Closed';
  if (/\b(?:offer(?:ed)?s?|hired|accepted the|contract sent)\b/.test(t) && !/\b(?:no|not|without)\s+offer/.test(t)) return 'Offer';
  if (/\binterview|final round|call booked|panel\b|meeting held/.test(t)) return 'Interview';
  if (/\bassess|take.?home|test task|survey|intro video|coding (?:test|challenge)|case study|\btask\b/.test(t)) return 'Assessment';
  if (/\bscreen|recruiter|phone call|shortlist|under review|in review|reviewing|first call/.test(t)) return 'Screening';
  if (/\bappl(?:y|ied|ication)|submitt?ed|sent|watching|awaiting|pending|queued|live\b/.test(t)) return 'Applied';
  return fallback;
}
export const isOpenStage = (stage: Stage) => stage !== 'Closed';

/** Interview/assessment records are at least at that stage, whatever loose status text they carry. */
export function applyActionFloor(stage: Stage, actionType: string): Stage {
  if (stage === 'Applied' || stage === 'Screening') return actionType === 'interview' ? 'Interview' : actionType === 'assessment' ? 'Assessment' : stage;
  return stage;
}
