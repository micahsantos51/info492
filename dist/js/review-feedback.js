// Keep the original inputs paired with the assessments the coordinator actually saw.
export function reviewDecisionExport(records) {
  const decisions = [];
  for (const record of records) {
    const assessments = new Map(record.assessments.map((assessment) => [assessment.id, assessment]));
    for (const decision of record.decisions) {
      const proposals = decision.assessmentIds.flatMap((id) => {
        const item = assessments.get(id);
        if (!item || item.revision !== decision.revision || item.rfiId !== record.id) return [];
        return [{
          id, source: item.source, simulated: item.simulated, model: item.model ?? null,
          promptVersion: item.promptVersion ?? null, evaluatedAt: item.evaluatedAt,
          category: item.category, suggestedPriority: item.priority, confidence: item.confidence ?? null,
          evaluationInput: item.evaluationInput, evidence: item.evidence,
        }];
      });
      decisions.push({
        rfiId: record.id, revision: decision.revision, confirmedAt: decision.at,
        confirmedPriority: decision.priority, reason: decision.reason, proposals,
      });
    }
  }
  return { format: 'info492-review-decisions-v1', exportedAt: new Date().toISOString(), decisions };
}

export function downloadReviewDecisions(records) {
  const report = reviewDecisionExport(records);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rfi-review-decisions-' + report.exportedAt.slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
