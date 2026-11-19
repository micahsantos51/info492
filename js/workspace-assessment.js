import { describeEvidence, renderAssessmentEvidence } from './jev-evidence.js?v=20261118-handoffs';
import { JEV_PRIORITY_CATEGORIES, JEV_PRIORITY_LABELS } from './jev-priority.js';

export { renderAssessmentEvidence };

export function workspaceInput(record) {
  return {
    submitted_date: record.submittedDate || record.submitted_date || null,
    due_date: record.due || record.requestedBy || record.neededBy || record.due_date || null,
    description: record.question || record.description || null,
  };
}

export function renderSourceEvidence(record) {
  return renderAssessmentEvidence({ evidence: describeEvidence(workspaceInput(record)) }, { preview: true });
}

// Validate the response before connecting it to a record. The priority itself remains advisory.
export function readJevEnvelope(payload, id) {
  const result = payload?.evaluation;
  if (payload?.rfi_id !== id || !JEV_PRIORITY_CATEGORIES.includes(result?.category)
      || !Number.isFinite(result?.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw Error('JEV returned an invalid assessment for this RFI.');
  }
  return {
    category: result.category, confidence: result.confidence,
    model: typeof payload.model === 'string' ? payload.model : null,
    promptVersion: typeof payload.prompt_version === 'string' ? payload.prompt_version : null,
  };
}

export async function requestJevEvaluation(origin, rfiId, input, fetchImpl = fetch) {
  const response = await fetchImpl(`${origin}/api/jev/classify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rfi_id: rfiId, evaluation_input: input }),
    signal: AbortSignal.timeout(75000),
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw Error(`JEV returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw Error(typeof payload.error === 'string' ? payload.error : `JEV request failed (HTTP ${response.status}).`);
  return readJevEnvelope(payload, rfiId);
}

export async function assessWorkspaceRfi(record, { fetchImpl = fetch } = {}) {
  const rfiId = record.id;
  const revision = record.revision;
  const input = workspaceInput(record);
  const config = await fetchImpl('data/jev-config.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!config.ok) throw Error('Could not load the JEV backend address.');
  const { backend_origin } = await config.json();
  const origin = backend_origin ? new URL(backend_origin).origin : '';
  const result = await requestJevEvaluation(origin, rfiId, input, fetchImpl);
  const priority = { high: 'P0', mid: 'P1', low: 'P2' }[result.category] || null;
  return {
    id: crypto.randomUUID(), rfiId, revision, source: 'Live JEV', simulated: false,
    priority, ...result, evaluationInput: input, evaluatedAt: new Date().toISOString(), evidence: describeEvidence(input),
    explanation: `JEV returned ${JEV_PRIORITY_LABELS[result.category]} (${Math.round(result.confidence * 100)}% model confidence).`,
  };
}

export function simulatedWorkspaceAssessments(record) {
  const evaluationInput = workspaceInput(record);
  const evidence = describeEvidence(evaluationInput);
  return [
    { priority: 'P0', source: 'Simulated assessment A' },
    { priority: 'P1', source: 'Simulated assessment B' },
  ].map(assessment => ({
    ...assessment, id: crypto.randomUUID(), rfiId: record.id, revision: record.revision,
    evaluatedAt: new Date().toISOString(), simulated: true, evidence, evaluationInput,
    model: null, promptVersion: null, confidence: null,
    explanation: 'Preset for the disagreement exercise. Review the source and record your own decision.',
  }));
}
