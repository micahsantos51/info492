const evidenceGroups = [
  {
    key: "cost",
    label: "Cost",
    mention: /\b(costs?|pricing|prices?|budget|financial|overruns?|expenses?|dollars?|USD|CAD)\b|[$€£]\s*\d/i,
    quantified: /\b(?:USD|CAD)\s*\d[\d,.]*|[$€£]\s*\d[\d,.]*(?:\s*[kmb])?\b|\b\d[\d,.]*(?:\s*(?:USD|dollars?|euros?|pounds?))\b/i,
    quantifiedLabel: "Amount stated",
    mentionedLabel: "Mentioned; no amount detected",
    absentLabel: "No explicit cost information found",
  },
  {
    key: "schedule",
    label: "Schedule",
    mention: /\b(schedule|delay\w*|reschedul\w*|postpon\w*|slippage|lead[ -]time|deadlines?|milestones?|critical path|time-sensitive|duration|hours?|days?|weeks?|months?|start date|completion date)\b/i,
    quantified: /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)[ -]+(?:(?:calendar|working|business)[ -]+)?(?:hours?|days?|weeks?|months?)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
    quantifiedLabel: "Time or date stated",
    mentionedLabel: "Mentioned; no time or date detected",
    absentLabel: "No explicit schedule information found",
  },
  {
    key: "work",
    label: "Work impact",
    mention: /\b(block(?:ed|ing)?|stopp?ed|on hold|waiting|unable to proceed|cannot proceed|can't proceed|rework|replace(?:ment)?|fabricat(?:e|ed|ing|ion)|procure\w*|equipment|crew|install\w*|inspect\w*|pour\w*|field work)\b/i,
    quantified: null,
    quantifiedLabel: "",
    mentionedLabel: "Work impact terms found",
    absentLabel: "No explicit work impact terms found",
  },
  {
    key: "safety",
    label: "Safety / compliance",
    mention: /\b(safety|safe|hazard|injur(?:y|ies)|complian(?:ce|t)|regulations?|fire rating|egress|permits?|building code|OSHA)\b/i,
    quantified: null,
    quantifiedLabel: "",
    mentionedLabel: "Safety or compliance terms found",
    absentLabel: "No explicit safety or compliance terms found",
  },
];

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

function sentences(description) {
  const paragraphs = description.split(/\r?\n/);
  return paragraphs.flatMap(paragraph => segmenter
    ? [...segmenter.segment(paragraph)].map(part => part.segment.trim())
    : paragraph.split(/(?<=[.!?])\s+/).map(part => part.trim())).filter(Boolean);
}

function excerpt(line, pattern) {
  if (line.length <= 340) return line;
  const match = line.search(pattern);
  const start = Math.max(0, match - 75);
  return line.slice(start, start + 340).trim();
}

const costImpact = /\b(?:(?:additional|increased?|extra|added|avoidable)\s+(?:costs?|charges?)|cost\s+(?:impact|increase|overrun|savings)|no\s+(?:additional\s+)?cost(?:\s+impact)?)\b/i;
const scheduleImpact = /\b(?:delay(?:ed|s)?|postpon(?:e|ed)|on hold|no schedule impact|schedule (?:impact|slippage))\b/i;

function impactSummary(key, matching) {
  if (key === 'cost') return matching.some(line => costImpact.test(line))
    ? 'Cost impact is discussed. Check whether the effect is estimated, reported, or ruled out.'
    : 'Cost impact unknown. A purchase price or contract threshold gives context only.';
  if (key === 'schedule') return matching.some(line => scheduleImpact.test(line))
    ? 'Schedule impact is discussed. Check whether the effect is estimated, reported, or ruled out.'
    : 'Schedule impact unknown. The reply deadline specifies when an answer is requested.';
  return '';
}

export function analyzeDescriptionEvidence(description) {
  const lines = sentences(typeof description === 'string' ? description : '');
  return evidenceGroups.map(group => {
    // Count amounts even when the currency symbol is the only financial wording.
    // A bare date in a drawing reference is not schedule information.
    const matches = lines.filter(line => group.mention.test(line)
      || (group.key === 'cost' && group.quantified.test(line)));
    const quantified = matches.filter(line => group.quantified?.test(line));
    const status = quantified.length ? 'quantified' : matches.length ? 'mentioned' : 'not_stated';
    const first = [...new Set([...quantified, ...matches])].slice(0, 2);
    return {
      key: group.key, label: group.label, status,
      summary: status === 'not_stated' ? group.absentLabel
        : status === 'quantified' ? group.quantifiedLabel : group.mentionedLabel,
      count: matches.length, impact: impactSummary(group.key, matches),
      excerpts: first.map(line => excerpt(line, group.quantified?.test(line) ? group.quantified : group.mention)),
    };
  });
}

export function describeEvidence(input) {
  return { factors: analyzeDescriptionEvidence(input?.description),
    submittedDate: input?.submitted_date || null, neededBy: input?.due_date || null };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);

export function renderAssessmentEvidence({ evidence } = {}, { preview = false, expanded = false } = {}) {
  if (!Array.isArray(evidence?.factors)) return '';
  const found = evidence.factors.filter(factor => factor.count > 0).length;
  const summary = `${found} of ${evidence.factors.length} topics matched in the description`;
  const rows = evidence.factors.map(factor => {
    const examples = factor.excerpts.map(quote => `<blockquote>${escapeHtml(quote)}</blockquote>`).join('');
    const count = factor.count > 0 ? ` · ${factor.count} matching ${factor.count === 1 ? 'passage' : 'passages'}` : '';
    return `<div class="rfi-evidence-row"><dt>${escapeHtml(factor.label)}</dt><dd><strong>${escapeHtml(factor.summary)}</strong>${escapeHtml(count)}${factor.impact ? `<br><small>${escapeHtml(factor.impact)}</small>` : ''}${examples}</dd></div>`;
  }).join('');
  return `<details class="rfi-evidence"${expanded ? ' open' : ''}><summary>${preview ? 'Available source evidence' : 'Description evidence'} · ${escapeHtml(summary)}</summary>
    <p>Text matching highlights up to two excerpts per topic from ${preview ? 'the current' : 'the evaluated'} description. Review the wording for estimates, uncertainty, and reported impacts.</p>
    <dl>${rows}<div class="rfi-evidence-row"><dt>Assessment dates</dt><dd>Submitted ${escapeHtml(evidence.submittedDate || '—')} · Needed by ${escapeHtml(evidence.neededBy || '—')}<br><small>These fields describe the requested turnaround. Schedule impact requires evidence in the description.</small></dd></div></dl></details>`;
}
