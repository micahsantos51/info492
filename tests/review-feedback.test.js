import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDecisionExport } from '../js/review-feedback.js';
import { scoreJev } from '../scripts/score-jev.js';

function proposal(id, extra = {}) {
  return { id, rfiId: 'R-1', revision: 1, model: 'fixture', promptVersion: 'a', simulated: false,
    category: 'high', priority: 'P0', evaluatedAt: '2026-11-01', evaluationInput: { description: 'Original.' }, ...extra };
}
const before = proposal('before');
const simulated = proposal('sample', { simulated: true, category: 'low' });
const late = proposal('late', { evaluatedAt: '2026-11-02', category: 'low' });
const assessments = [before, simulated, late, proposal('other', { revision: 2 })];
const decisions = [{ priority: 'P1', reason: 'Crew has another work area.', at: '2026-11-01',
  revision: 1, assessmentIds: ['before', 'sample', 'other'] }];
const records = [{ id: 'R-1', question: 'Updated.', attachments: ['private'], assessments, decisions }];

test('decision export preserves the assessed revision and only the proposals available at decision time', () => {
  const row = reviewDecisionExport(records).decisions[0];
  assert.deepEqual(row.proposals.map(x => x.id), ['before', 'sample']);
  assert.equal(row.proposals[0].evaluationInput.description, 'Original.');
  assert.equal(row.reason, decisions[0].reason);
  assert.doesNotMatch(JSON.stringify(row), /private|Updated/);
});

test('independent score excludes simulations, deduplicates live calls and counts missing cases', () => {
  const report = reviewDecisionExport(records);
  report.decisions.push({ ...report.decisions[0], proposals: [late].map(x => ({ ...x, suggestedPriority: x.priority })) });
  const key = [{ rfi_id: 'R-1', revision: '1', final_label: 'High' }, { rfi_id: 'R-2', revision: '1', final_label: 'Low' }];
  const [run] = scoreJev(report, key).runs;
  assert.deepEqual([run.evaluated, run.matches, run.missing, run.accuracyOverKey], [1, 1, 1, 0.5]);
  assert.equal(run.disagreements[0].rfiId, 'R-2');
  assert.throws(() => scoreJev(report, [key[0], key[0]]), /Duplicate/);
  assert.throws(() => scoreJev(report, []), /empty/);
  report.decisions.forEach(row => { row.proposals = row.proposals.filter(p => p.simulated); });
  assert.deepEqual(scoreJev(report, key).runs, []);
});
