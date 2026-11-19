// Offline scorer for a separately prepared answer key. No model calls or uploads.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseCSV } from '../js/rfi-data.js';

const tiers = new Map([
  ['p0', 'P0'], ['high', 'P0'], ['p1', 'P1'], ['mid', 'P1'], ['medium', 'P1'],
  ['p2', 'P2'], ['low', 'P2'], ['lacking_info', 'lacking_info'], ['needs information', 'lacking_info'],
]);
const caseId = (id, revision) => JSON.stringify([id, revision]);

export function scoreJev(report, key) {
  if (report.format !== 'info492-review-decisions-v1' || !Array.isArray(report.decisions))
    throw Error('Choose a Demo 4 review decisions export.');
  if (!key.length) throw Error('The answer key is empty. Add independently reviewed cases first.');
  const expected = new Map();
  for (const row of key) {
    const id = row.rfi_id?.trim();
    const revision = Number(row.revision);
    const target = tiers.get(row.final_label?.trim().toLowerCase());
    if (!id || !Number.isSafeInteger(revision) || revision < 1 || !target)
      throw Error('Each key row needs rfi_id, a positive revision and a valid final_label.');
    const k = caseId(id, revision);
    if (expected.has(k)) throw Error('Duplicate RFI and revision in the answer key: ' + id);
    expected.set(k, target);
  }

  const runs = new Map();
  for (const entry of report.decisions) {
    const k = caseId(entry.rfiId, entry.revision);
    if (!expected.has(k)) continue;
    for (const proposal of entry.proposals) {
      if (proposal.simulated !== false) continue;
      const predicted = tiers.get(proposal.category);
      if (!predicted) throw Error('Invalid live Jev category in export.');
      const group = JSON.stringify([proposal.model || null, proposal.promptVersion || null]);
      if (!runs.has(group)) runs.set(group, new Map());
      const cases = runs.get(group);
      const previous = cases.get(k);
      // Several decisions may reference the same run. A repeated call also gets only one vote.
      if (!previous || proposal.evaluatedAt < previous.evaluatedAt)
        cases.set(k, { predicted, evaluatedAt: proposal.evaluatedAt });
    }
  }
  return {
    referenceCases: expected.size,
    runs: [...runs].map(([group, cases]) => {
      const [model, promptVersion] = JSON.parse(group);
      let matches = 0;
      const disagreements = [];
      for (const [k, target] of expected) {
        const predicted = cases.get(k)?.predicted ?? null;
        if (predicted === target) matches++;
        else {
          const [rfiId, revision] = JSON.parse(k);
          disagreements.push({ rfiId, revision, expected: target, predicted });
        }
      }
      return { model, promptVersion, versionReported: Boolean(model && promptVersion),
        evaluated: cases.size, missing: expected.size - cases.size,
        matches, accuracyOverKey: matches / expected.size, disagreements };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , exportPath, keyPath] = process.argv;
    if (!exportPath || !keyPath) throw Error('Usage: node scripts/score-jev.js decisions.json independent-key.csv');
    const [report, csv] = await Promise.all([readFile(exportPath, 'utf8'), readFile(keyPath, 'utf8')]);
    const result = scoreJev(JSON.parse(report), parseCSV(csv.replace(/^\uFEFF/, '')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.runs.length) console.error('No live Jev proposals match the specified RFI IDs and revisions.');
    if (result.runs.some(run => !run.versionReported))
      console.error('The service omitted model or prompt metadata for some proposals. Exclude those results from prompt-version comparisons.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
