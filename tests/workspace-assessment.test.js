import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEvidence } from '../js/jev-evidence.js';
import { assessWorkspaceRfi, readJevEnvelope, renderSourceEvidence, simulatedWorkspaceAssessments } from '../js/workspace-assessment.js';
import { applyJevClassification, due, emptyBoard, jevInputForBoardItem, mergeRfiRecords, rankable, refreshClassificationState } from '../js/demo3-core.js';

const input = {
  id: 'R-1', revision: 3, question: 'See drawing dated 2022-03-01. The waiver threshold is $150,000.00. The valve price is $4,530.15.',
  submittedDate: '2022-04-01', due: '2022-04-09', priority: 'P0', response: 'Hidden answer',
};

test('source coverage counts passages, preserves exact decimal amounts, and separates deadlines from effects', () => {
  const info = describeEvidence({description: input.question, submitted_date: input.submittedDate, due_date: input.due});
  const [cost, schedule] = info.factors;
  assert.equal(cost.count, 2);
  assert.equal(cost.status, 'quantified');
  assert.match(cost.impact, /unknown/);
  assert.ok(cost.excerpts.every(line => input.question.includes(line)));
  assert.match(cost.excerpts[1], /4,530\.15/);
  assert.equal(schedule.count, 0);
  assert.match(schedule.impact, /unknown/);
  assert.equal(info.neededBy, input.due);
  const source = renderSourceEvidence({...input, question: 'Extra costs require <script> approval.'});
  assert.match(source, /Available source evidence/);
  assert.match(source, /&lt;script&gt;/);
  assert.doesNotMatch(source, /<script>/);
});

test('live assessments bind the original revision to the same inputs and provenance returned by the service', async () => {
  const record = {...input};
  const fetchImpl = async (url, options) => {
    if (url === 'data/jev-config.json') return Response.json({backend_origin:'https://fixture.example'});
    assert.equal(url, 'https://fixture.example/api/jev/classify');
    assert.deepEqual(JSON.parse(options.body), {rfi_id: record.id,
      evaluation_input: {description: input.question, submitted_date: input.submittedDate, due_date: input.due}});
    record.revision = 4;
    record.question = 'New text after request';
    return Response.json({rfi_id: 'R-1', evaluation:{category:'lacking_info', confidence:.83}, model:'jev-test', prompt_version:'12345'});
  };
  const result = await assessWorkspaceRfi(record, {fetchImpl});
  assert.equal(result.revision, 3);
  assert.equal(result.evaluationInput.description, input.question);
  assert.equal(result.priority, null);
  assert.equal(result.category, 'lacking_info');
  assert.equal(result.model, 'jev-test');
  assert.equal(result.promptVersion, '12345');
  assert.equal(result.simulated, false);
  assert.equal(result.evidence.factors[0].count, 2);
});

test('the live endpoint rejects mismatched IDs, handles earlier deploys, and keeps disagreements visibly simulated', () => {
  const response = {rfi_id: input.id, evaluation:{category:'low', confidence:.8}};
  assert.throws(() => readJevEnvelope(response, 'R-2'), /invalid assessment/);
  assert.equal(readJevEnvelope(response, input.id).promptVersion, null);
  const sample = simulatedWorkspaceAssessments(input);
  assert.deepEqual(sample.map(r => r.priority), ['P0','P1']);
  assert.ok(sample.every(r => r.simulated && r.source.includes('Simulated') && r.confidence === null));
  assert.ok(sample.every(r => r.rfiId === input.id && r.revision === input.revision && r.evaluationInput.description === input.question));
});

test('board reclassification follows changed inputs and leaves old snapshots intact until the new input is evaluated', () => {
  const board = emptyBoard();
  mergeRfiRecords(board,[{rfi_id:input.id, description:input.question, submitted_date:input.submittedDate, due_date:input.due}]);
  const item = board.items[0];
  const old = JSON.stringify(jevInputForBoardItem(item));
  applyJevClassification(item, {category:'mid',confidence:.7}, old);
  assert.equal(due(item), input.due);
  item.due_override = input.due;
  refreshClassificationState(item);
  assert.equal(item.classification_state, 'classified');
  item.due_override = '2022-04-20';
  refreshClassificationState(item);
  assert.equal(item.classification_state, 'stale');
  assert.equal(rankable(item), false);
  assert.equal(item.classification_input, old);
  applyJevClassification(item, {category:'high',confidence:.9}, JSON.stringify(jevInputForBoardItem(item)));
  refreshClassificationState(item);
  assert.equal(rankable(item), true);
  assert.equal(item.result.priority, 'P0');
});
