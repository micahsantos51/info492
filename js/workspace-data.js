export const project = "East Link · RFI exchange";
export const contractor = "Meridian Constructors";
export const designer = "Northline Design";
export const roles = {
  submitter: {
    name: "Alex Rivera", company: contractor, label: "RFI submitter · GC coordinator",
    title: "My RFIs", description: "Confirm review priority, route questions, and acknowledge the design team’s answers.",
  },
  responder: {
    name: "Priya Shah", company: designer, label: "Technical responder",
    title: "Assigned to Me", description: "Clarify assigned questions and send signed technical responses back to the submitter.",
  },
};

export const statuses = {
  draft: "Draft", submitted: "Ready for priority review", returned: "Revision requested",
  assigned: "Awaiting technical response", clarification: "Clarification requested",
  responseReview: "Awaiting response sign-off", answered: "Awaiting acknowledgment",
  acknowledged: "Acknowledged",
};
export const priorityLabels = { P0: "P0 · High", P1: "P1 · Medium", P2: "P2 · Low" };

export function dateIn(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

export function makeDraft(id, source = {}) {
  return {
    id, status: "draft", revision: 1, originator: roles.submitter.name, originCompany: contractor,
    responsibleCompany: contractor, assignee: "", title: (source.title || "").replace(/\.pdf$/i, ""),
    question: source.description || "", location: "", reference: "", requestedBy: source.due_date || "",
    submittedDate: source.rfi_id ? (source.submitted_date || "") : dateIn(), source: source.rfi_id ? "Project RFI library" : "Workspace entry",
    due: source.due_date || "", response: "", reason: "", attachments: [], files: [],
    history: [], revisions: [], assessments: [], decisions: [],
  };
}

// Import earlier local work without inventing missing recipients, approvals, or timestamps.
export function migrateRecords(records) {
  if (!Array.isArray(records)) throw new Error("Saved RFI records could not be read.");
  return records.map((record) => ({
    ...makeDraft(record.id), ...record, revision: record.revision || (record.revisions?.length || 0) + 1,
    source: record.source || "Earlier demo workspace",
    submittedDate: record.submittedDate ?? "",
    assessments: record.assessments || [], decisions: record.decisions || [],
  }));
}

export function visibleTo(record, role) {
  if (role === "submitter") return record.originator === roles.submitter.name;
  return role === "responder" && record.assignee === roles.responder.name;
}

export function nextOwner(record) {
  if (record.status === "acknowledged") return "";
  if (["assigned", "responseReview"].includes(record.status)) return record.assignee;
  return record.originator;
}

export function currentDecision(record) {
  return record.decisions.findLast((entry) => entry.revision === record.revision);
}

export function allowedActions(record, role) {
  if (!visibleTo(record, role)) return [];
  if (role === "responder") {
    if (record.status === "assigned") return ["sendResponse", "clarify", "draftResponse"];
    if (record.status === "responseReview") return ["release", "draftResponse"];
    return [];
  }
  const actions = [];
  if (record.status === "draft" || record.status === "returned") return ["submit", "edit"];
  if (record.status === "clarification") actions.push("reply");
  if (["submitted", "assigned", "responseReview", "clarification"].includes(record.status)) actions.push("decide");
  if (record.status === "submitted" && currentDecision(record)) actions.push("route");
  if (record.status === "answered") actions.push("acknowledge");
  if (["submitted", "assigned", "responseReview", "answered", "acknowledged"].includes(record.status)) actions.push("revise");
  return actions;
}

function log(record, actor, recipient, text, kind, now) {
  record.history.push({ actor, recipient, text, kind, revision: record.revision, at: now });
}

export function recordAssessment(record, assessment) {
  if (assessment.rfiId !== record.id || !Number.isInteger(assessment.revision) ||
      assessment.revision < 1 || assessment.revision > record.revision) throw new Error("Assessment source does not match this RFI revision.");
  if (!record.assessments.some((item) => item.id === assessment.id)) record.assessments.push(assessment);
}

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(label);
  return text;
}

function archiveRevision(record, reason, actor, date) {
  const snapshot = { ...record };
  for (const key of ["revisions", "history", "assessments", "decisions"]) delete snapshot[key];
  record.revisions.push(structuredClone({ ...snapshot, actor, date, revisionReason: reason, decision: currentDecision(record) }));
  record.revision++;
  record.status = "submitted";
  record.assignee = "";
  record.responsibleCompany = record.originCompany;
  record.response = "";
  record.responseDate = "";
  record.signoff = null;
  record.reason = "";
  record.pendingReply = "";
  record.recommendation = null;
}

// Caller commits only a successful transition. Every new handoff records its addressed payload.
export function applyAction(record, role, action, values = {}, now = new Date().toISOString()) {
  if (!allowedActions(record, role).includes(action)) throw new Error("This action is unavailable. Reopen the RFI to see its current owner.");
  const actor = roles[role].name;
  const recipient = roles.responder.name;
  switch (action) {
    case "edit":
    case "revise": {
      const title = required(values.title, "Enter a subject.");
      const question = required(values.question, "Enter the RFI question.");
      const reason = action === "revise" ? required(values.revisionReason, "Explain the revision.") : "Edited draft";
      if (action === "revise") archiveRevision(record, reason, actor, now);
      Object.assign(record, { title, question, location: values.location || "", reference: values.reference || "",
        requestedBy: values.requestedBy || "", due: values.requestedBy || "", attachments: values.attachments || [], files: values.files || [] });
      log(record, actor, actor, reason, action, now);
      break;
    }
    case "submit":
      required(record.title, "Enter a subject before submitting.");
      required(record.question, "Enter the question before submitting.");
      record.status = "submitted";
      log(record, actor, actor, "Submitted for priority review and routing.", action, now);
      break;
    case "decide": {
      if (!Object.hasOwn(priorityLabels, values.priority)) throw new Error("Choose a priority.");
      const reason = required(values.reason, "Explain your priority decision.");
      const assessmentIds = record.assessments.filter((a) => a.revision === record.revision).map((a) => a.id);
      record.decisions.push({ priority: values.priority, reason, by: actor, at: now, revision: record.revision, assessmentIds });
      log(record, actor, actor, `Confirmed ${priorityLabels[values.priority]}. ${reason}`, action, now);
      break;
    }
    case "route":
      record.status = "assigned";
      record.assignee = recipient;
      record.responsibleCompany = designer;
      log(record, actor, recipient, record.pendingReply || record.question, action, now);
      record.pendingReply = "";
      break;
    case "clarify": {
      const reason = required(values.reason, "Enter a specific clarification question.");
      record.status = "clarification";
      record.reason = reason;
      log(record, actor, record.originator, reason, action, now);
      break;
    }
    case "reply": {
      const reply = required(values.reply, "Enter the requested information.");
      const question = record.reason;
      archiveRevision(record, "Clarification added", actor, now);
      record.question += `\n\nClarification requested: ${question}\nSubmitter’s clarification: ${reply}`;
      record.pendingReply = reply;
      log(record, actor, actor, `Prepared clarification for routing. ${reply}`, action, now);
      break;
    }
    case "draftResponse":
    case "sendResponse": {
      const text = required(values.response, "Enter the technical response.");
      record.response = text;
      record.status = action === "sendResponse" ? "responseReview" : "assigned";
      log(record, actor, actor, action === "sendResponse" ? "Prepared response for technical sign-off." : "Saved technical draft.", action, now);
      break;
    }
    case "release": {
      required(record.response, "Prepare a response before issuing it.");
      const reviewer = required(values.reviewer, "Identify the reviewer.");
      const reference = required(values.signoffReference, "Record a sign-off reference or note.");
      if (values.signoff !== "confirmed") throw new Error("Confirm the technical sign-off before issuing.");
      record.signoff = { reviewer, reference, issuedBy: actor };
      record.status = "answered";
      record.responseDate = now;
      record.responsibleCompany = record.originCompany;
      log(record, actor, record.originator, record.response, action, now);
      break;
    }
    case "acknowledge":
      record.status = "acknowledged";
      log(record, actor, record.assignee || recipient, "Acknowledged receipt of the issued technical response.", action, now);
      break;
  }
}

export function eligibleForPlan(record) {
  return Boolean(currentDecision(record)) && !["draft", "acknowledged"].includes(record.status);
}
export function byPriority(a, b) {
  const pa = currentDecision(a)?.priority || "Z";
  const pb = currentDecision(b)?.priority || "Z";
  return pa.localeCompare(pb) || (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id);
}
