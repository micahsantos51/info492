const evidenceGroups = [
  {
    key: "cost",
    label: "Cost",
    mention: /\b(costs?|pricing|prices?|budget|estimates?|dollars?|USD|expenses?)\b|[$€£]\s*\d/i,
    quantified: /[$€£]\s*\d[\d,.]*(?:\s*[kmb])?\b|\b\d[\d,.]*(?:\s*(?:USD|dollars?|euros?|pounds?))\b/i,
    quantifiedLabel: "Amount stated",
    mentionedLabel: "Mentioned; no amount detected",
    absentLabel: "No explicit cost information found",
  },
  {
    key: "schedule",
    label: "Schedule",
    mention: /\b(schedule|delays?|deadlines?|milestones?|critical path|time-sensitive|duration|hours?|days?|weeks?|months?|start date|completion date)\b/i,
    quantified: /\b\d+\s*(?:hours?|days?|weeks?|months?)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
    quantifiedLabel: "Time or date stated",
    mentionedLabel: "Mentioned; no time or date detected",
    absentLabel: "No explicit schedule information found",
  },
  {
    key: "work",
    label: "Work impact",
    mention: /\b(block(?:ed|ing)?|stopp?ed|on hold|waiting|unable to proceed|cannot proceed|can't proceed|rework|replace(?:ment)?|fabricat(?:e|ed|ing|ion)|procure(?:ment)?|crew|install(?:ation)?|pour|field work)\b/i,
    quantified: null,
    quantifiedLabel: "",
    mentionedLabel: "Work impact terms found",
    absentLabel: "No explicit work impact terms found",
  },
  {
    key: "safety",
    label: "Safety / compliance",
    mention: /\b(safety|safe|hazard|injur(?:y|ies)|compliance|regulations?|fire rating|egress|permits?|building code|OSHA)\b/i,
    quantified: null,
    quantifiedLabel: "",
    mentionedLabel: "Safety or compliance terms found",
    absentLabel: "No explicit safety or compliance terms found",
  },
];

function sentences(text) {
  return text.match(/[^.!?\n]+[.!?\n]?/g)?.map((part) => part.trim()).filter(Boolean) || [];
}

function excerptsFor(text, group) {
  const matching = sentences(text).filter((sentence) =>
    group.mention.test(sentence) || group.quantified?.test(sentence),
  );
  return matching.slice(0, 2).map((sentence) =>
    sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence,
  );
}

export function analyzeDescriptionEvidence(description) {
  const text = typeof description === "string" ? description : "";
  return evidenceGroups.map((group) => {
    const mentioned = group.mention.test(text);
    const quantified = Boolean(group.quantified?.test(text));
    const status = !mentioned ? "not_stated" : quantified ? "quantified" : "mentioned";
    return {
      key: group.key,
      label: group.label,
      status,
      summary: status === "not_stated"
        ? group.absentLabel
        : status === "quantified"
          ? group.quantifiedLabel
          : group.mentionedLabel,
      excerpts: mentioned ? excerptsFor(text, group) : [],
    };
  });
}
