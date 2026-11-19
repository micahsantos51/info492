import { readFiles, fileUrl } from "./workspace-files.js";
import { actionSnapshotMatches, allowedActions, applyAction, byPriority, currentDecision, dateIn, eligibleForPlan, makeDraft, migrateRecords, neededBy, nextOwner, priorityLabels, priorityReview, project, recordAssessment, responseVisibility, roles, statuses, visibleTo } from "./workspace-data.js?v=20261118-handoffs";
import { assessWorkspaceRfi, simulatedWorkspaceAssessments, renderAssessmentEvidence, renderSourceEvidence } from "./workspace-assessment.js?v=20261118-handoffs";
import { downloadReviewDecisions } from "./review-feedback.js?v=20261118-handoffs";

const sessionKey = "info492-role-session";
const recordsKey = "info492-role-workspace.records.v2";
const oldRecordsKey = "info492-role-workspace.records.v1";
const planKey = "info492-role-workspace.priority-plan.v1";
const $ = (id) => document.getElementById(id);
const content = $("workspace-content");
const dialog = $("workspace-dialog");
const escape = (value = "") => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const labels = {
  submit: "Submit for priority review", edit: "Edit draft", revise: "Start a revision",
  decide: "Confirm priority", route: "Route to responder", clarify: "Request clarification", reply: "Prepare clarification",
  draftResponse: "Save response draft", sendResponse: "Prepare response", release: "Record sign-off & send",
  acknowledge: "Acknowledge response", create: "Save draft",
};
const nextStep = {
  draft: "Submit question", submitted: "Confirm priority and route", returned: "Revise question",
  assigned: "Prepare technical response", clarification: "Provide clarification",
  responseReview: "Record sign-off and send answer", answered: "Acknowledge response", acknowledged: "Exchange complete",
};
function nextAction(record) {
  if (record.status === "submitted") return currentDecision(record) ? "Route to responder" : "Confirm review priority";
  return nextStep[record.status];
}
const workFilter = (r) => nextOwner(r) === roles[role].name;
const listFilters = [
  ["Needs my action", workFilter],
  ["Waiting on the other party", (r) => nextOwner(r) && !workFilter(r)],
  ["All my RFIs", () => true],
];
let role, records = [], plan = [], sourceRecords = [], sourceStatus = "Loading project RFIs…";
let selected = "", mode = "", openedRecord = null, tab = 0, query = "", timing = "all";
let fileUrls = [], saving = false, noticeTimer;
const requests = new Set();
const planEntry = (r) => r.id + "@" + r.revision;
const when = (date) => date && !isNaN(Date.parse(date)) && date.includes("T")
  ? new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : date || "Time unavailable";
const currentPriority = (r) => priorityLabels[currentDecision(r)?.priority] || "Pending confirmation";
const statusLabel = r => r.status === "submitted" && currentDecision(r) ? "Ready to route" : statuses[r.status];
const scoped = () => records.filter((r) => visibleTo(r, role));
const lock = (key, callback) => navigator.locks ? navigator.locks.request(key, callback) : callback();
const readRecords = () => migrateRecords(JSON.parse(localStorage.getItem(recordsKey) || localStorage.getItem(oldRecordsKey) || "[]"));
function readPlan() {
  const saved = JSON.parse(localStorage.getItem(planKey) || "null");
  return saved?.date === dateIn() && Array.isArray(saved.entries) ? saved.entries : [];
}
function say(text) {
  $("workspace-notice").textContent = text;
  $("workspace-notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $("workspace-notice").hidden = true; }, 6500);
}
async function mutate(update) {
  await lock(recordsKey, () => {
    const fresh = readRecords();
    update(fresh);
    const serialized = JSON.stringify(fresh);
    if (serialized.length > 3500000) throw new Error("Local workspace storage is full. Use smaller attachments or file references.");
    localStorage.setItem(recordsKey, serialized);
    records = fresh;
  });
}

async function start() {
  role = JSON.parse(sessionStorage.getItem(sessionKey) || "null")?.role;
  if (!Object.hasOwn(roles, role)) { location.replace("signin.html"); return; }
  records = readRecords();
  plan = readPlan();
  $("account").hidden = false;
  $("identity").textContent = roles[role].name + " · " + roles[role].label;
  $("switch-role").textContent = role === "submitter" ? "Switch to responder" : "Switch to submitter";
  $("switch-role").onclick = async () => {
    sessionStorage.setItem(sessionKey, JSON.stringify({ role: role === "submitter" ? "responder" : "submitter" }));
    tab = 0; query = ""; timing = "all";
    if (dialog.open) dialog.close();
    await start();
    $("role-title").focus();
  };
  $("sign-out").onclick = () => { sessionStorage.removeItem(sessionKey); location.assign("index.html"); };
  document.title = roles[role].title + " · Demo 4";
  render();
  if (role !== "submitter") return;
  try {
    const result = await fetch("data/realData/answerTest.json");
    if (!result.ok) throw new Error();
    const data = await result.json();
    sourceRecords = data.records.filter(r => r.rfi_id && r.description);
    sourceStatus = "No project RFIs available.";
  } catch { sourceStatus = "Project library unavailable. You can still create a new RFI."; }
  renderSources();
}

function renderSources() {
  if (!$("library-select")) return;
  $("library-select").innerHTML = sourceRecords.length
    ? sourceRecords.map(r => `<option value="${escape(r.rfi_id)}" ${r.rfi_id === "R200-CRE-08222" ? "selected" : ""}>${escape(r.rfi_id)} · ${escape(r.title.replace(/\.pdf$/i, ""))}</option>`).join("")
    : `<option>${escape(sourceStatus)}</option>`;
  $("library-open").disabled = !sourceRecords.length;
}

function render() {
  const persona = roles[role], all = scoped();
  const archived = all.filter(r => r.status === "acknowledged").length;
  content.innerHTML = `<div class="workspace-context"><span>${project}</span><span class="workspace-tag">Demo 4</span></div>
    <section class="workspace-heading"><div><p class="overline">${escape(persona.company)} · ${escape(persona.label)}</p>
    <h1 id="role-title" tabindex="-1">${persona.title}</h1><p>${persona.description}</p></div>
    ${role === "submitter" ? '<button class="workspace-primary" data-new>+ New RFI</button>' : ""}</section>
    <div class="workspace-metrics"><div><strong>${all.filter(workFilter).length}</strong><span>Needs my action</span></div>
    <div><strong>${all.length - all.filter(workFilter).length - archived}</strong><span>Waiting on the other party</span></div>
    <div><strong>${archived}</strong><span>Responses acknowledged</span></div></div>
    ${role === "submitter" ? `<section class="workspace-library"><label for="library-select">Start from a project RFI</label>
      <div><select id="library-select"></select><button id="library-open">Open project RFI</button></div>
      <p>The source question and project dates carry into your working copy.</p></section>` : ""}
    <section class="workspace-panel" aria-label="RFI inbox"><div class="workspace-toolbar">${listFilters.map(([name], i) =>
      `<button data-tab="${i}" aria-pressed="${i === tab}">${name}</button>`).join("")}</div>
      <div class="workspace-filters"><label>Find an RFI<input type="search" id="find-rfi" value="${escape(query)}" placeholder="Search ID, subject or drawing"></label>
      <label>Timing<select id="timing-rfi">${[["all","All dates"],["overdue","Past due"],["week","Due this week"],["missing","Missing date"]].map(([value, name]) =>
        `<option value="${value}" ${timing === value ? "selected" : ""}>${name}</option>`).join("")}</select></label></div><div id="rfi-list"></div></section>
    ${role === "submitter" ? dailyPlan(all) : ""}
    <footer class="workspace-footer"><p class="workspace-footnote">Project records and demo handoffs are stored separately. Both roles share this browser’s workspace.</p>
      ${role === "submitter" ? `<button data-export ${all.some(r => r.decisions.length) ? "" : "disabled"}>Export review decisions</button>` : ""}</footer>`;
  renderList(); renderSources();
}

function renderList() {
  const matches = scoped().filter(r => {
    const date = neededBy(r);
    const onDate = timing === "all" || (timing === "missing" ? !date : date &&
      (timing === "overdue" ? date < dateIn() : date >= dateIn() && date <= dateIn(7)));
    return onDate && listFilters[tab][1](r) && [r.id, r.title, r.reference, r.location].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  }).sort(byPriority);
  const list = $("rfi-list");
  list.innerHTML = matches.length ? `<div class="workspace-table-scroll" tabindex="0"><table class="workspace-table">
    <thead><tr><th>RFI / Subject</th><th>Next action</th><th>Next owner</th><th>Needed by</th><th>Confirmed priority</th></tr></thead>
    <tbody>${matches.map(r => `<tr><td>${recordButton(r)}</td><td>${escape(nextAction(r))}</td><td>${escape(nextOwner(r) || "Complete")}</td>
      <td>${escape(neededBy(r) || "Unknown")}</td><td>${escape(currentPriority(r))}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="workspace-empty">${role === "responder" && !scoped().length ? "Your inbox is empty. RFIs appear here when the submitter routes them to you." : "No RFIs match this view."}</p>`;
}

function recordButton(r) {
  return `<button class="workspace-record" data-record="${escape(r.id)}"><small>${escape(r.id)} · Rev ${r.revision}</small><strong>${escape(r.title)}</strong></button>`;
}

function dailyPlan(all) {
  const pending = all.filter(eligibleForPlan).sort(byPriority);
  const planned = plan.map(key => pending.find(r => planEntry(r) === key)).filter(Boolean);
  const suggestions = pending.filter(r => !plan.includes(planEntry(r)));
  const row = (r, controls) => `<div class="workspace-task"><div>${recordButton(r)}<small>${escape(currentPriority(r))} · Needed by ${escape(neededBy(r) || "unknown")}</small></div>${controls}</div>`;
  const control = (r, action, text, title, disabled = false) => `<button data-plan="${action}" data-id="${escape(planEntry(r))}" aria-label="${escape(title + " " + r.id)}" ${disabled ? "disabled" : ""}>${text}</button>`;
  return `<section class="workspace-daily"><div class="workspace-daily-heading"><div><h2 id="daily-title" tabindex="-1">Today’s review plan</h2>
    <p>Confirmed priority sets the suggested order. Move items to fit today’s work.</p></div>
    <button data-plan="generate" ${!suggestions.length || planned.length >= 5 ? "disabled" : ""}>Fill up to 5 by priority</button></div>
    <div class="workspace-lanes"><div><h3>Suggested order</h3>${suggestions.map(r => row(r, control(r, "add", "+", "Add to plan"))).join("") || "<p>No additional confirmed RFIs.</p>"}</div>
    <div><h3>My daily order</h3>${planned.map((r, i) => row(r,
      control(r, "up", "↑", "Move up", !i) + control(r, "down", "↓", "Move down", i === planned.length - 1) + control(r, "remove", "×", "Remove")
    )).join("") || "<p>Select a confirmed RFI to begin.</p>"}</div></div></section>`;
}

async function updatePlan(button) {
  await lock(planKey, () => {
    records = readRecords();
    const candidates = scoped().filter(eligibleForPlan).sort(byPriority).map(planEntry);
    const next = readPlan().filter(key => candidates.includes(key));
    const { plan: action, id } = button.dataset;
    const index = next.indexOf(id);
    if (action === "generate") next.push(...candidates.filter(key => !next.includes(key)).slice(0, Math.max(0, 5 - next.length)));
    if (action === "add" && index < 0 && candidates.includes(id)) next.push(id);
    if (action === "remove" && index >= 0) next.splice(index, 1);
    if (action === "up" || action === "down") {
      const other = index + (action === "up" ? -1 : 1);
      if (index >= 0 && other >= 0 && other < next.length) [next[index], next[other]] = [next[other], next[index]];
    }
    localStorage.setItem(planKey, JSON.stringify({ date: dateIn(), entries: next }));
    plan = next;
  });
  render(); $("daily-title").focus();
}

function field(label, name, value = "", { type = "text", required = false, multiline = false } = {}) {
  const attrs = `name="${name}" ${required ? "required" : ""}`;
  return `<label>${label}${multiline ? `<textarea ${attrs} rows="4">${escape(value)}</textarea>`
    : `<input ${attrs} type="${type}" value="${escape(value)}">`}</label>`;
}
function fact(label, value) {
  return `<div><dt>${label}</dt><dd>${escape(value || "Unknown")}</dd></div>`;
}
function attachments(files = []) {
  return files.map(file => {
    const url = fileUrl(file);
    if (!url) return "";
    fileUrls.push(url);
    return `<a class="workspace-file" href="${url}" download="${escape(file.name)}">↓ ${escape(file.name)}</a>`;
  }).join("");
}
function decisionHistory(r) {
  const current = currentDecision(r);
  if (!r.decisions.length) return "<p>No confirmed priority for this RFI.</p>";
  return r.decisions.slice().reverse().map(d => {
    const reviewed = r.assessments.filter(a => a.revision === d.revision && d.assessmentIds?.includes(a.id));
    const sources = reviewed.map(a => `${escape(a.source)} · ${escape(priorityLabels[a.priority] || "Needs information")}`).join(", ");
    return `<article class="workspace-decision"><strong>${escape(priorityLabels[d.priority])}</strong>
    <span>${d === current ? "Current" : d.revision === r.revision ? "Superseded" : "Earlier revision"} · Rev ${d.revision}</span>
    <p>${escape(d.reason)}</p><p class="workspace-secondary">${sources ? "Recommendations available at confirmation · " + sources : "Confirmed without an AI recommendation."}</p>
    <small>${escape(d.by)} · ${escape(when(d.at))}</small></article>`;
  }).join("");
}
function decisionsPanel(r) {
  const { proposals: assessments, decision, disagreement, newProposals } = priorityReview(r);
  const earlier = r.assessments.filter(a => a.revision !== r.revision);
  const canAssess = role === "submitter" && !["draft", "acknowledged", "answered", "returned"].includes(r.status);
  const isBusy = requests.has(planEntry(r));
  const card = (a) => `<article class="workspace-assessment"><header><strong>${escape(a.priority ? priorityLabels[a.priority] : "Needs information")}</strong>
    <span>${escape(a.source)}</span></header><small>Rev ${a.revision} · ${escape(when(a.evaluatedAt))}${a.simulated ? " · Simulated assessment" : ""}${newProposals.includes(a) ? " · Received after confirmation" : ""}</small>
    <p>${escape(a.explanation)}</p>${renderAssessmentEvidence(a)}</article>`;
  return `<section class="workspace-detail-section"><h3 id="priority-assessments" tabindex="-1">Priority assessments</h3>
    ${disagreement ? `<p class="workspace-conflict">${decision ? `Recommendations differ. The GC confirmed ${escape(currentPriority(r))}. See the recorded reason below.` : "Recommendations disagree. The submitter chooses the review priority and records a reason."}</p>` : ""}
    ${newProposals.length ? `<p class="workspace-assessment-update">${newProposals.length} new ${newProposals.length === 1 ? "assessment" : "assessments"} since confirmation. ${escape(currentPriority(r))} remains in effect.</p>` : ""}
    ${assessments.map(card).join("") || "<p>No assessment for this revision.</p>"}
    ${canAssess ? `<p class="workspace-secondary">Sending to JEV shares this revision’s RFI ID, question, submission date and needed-by date with the configured service.</p>
      <div class="workspace-actions"><button data-assess="live" ${isBusy ? "disabled" : ""}>${isBusy ? "Evaluating…" : assessments.some(a => !a.simulated) ? "Classify again with JEV" : "Send to JEV"}</button>
      <button data-assess="simulated" ${assessments.some(a => a.simulated) ? "disabled" : ""}>Load simulated disagreement</button></div>` : ""}
    ${earlier.length ? `<details><summary>Earlier assessments · stale (${earlier.length})</summary>${earlier.map(card).join("")}</details>` : ""}
    ${r.recommendation ? `<details><summary>Earlier demo recommendation</summary><p>${escape(r.recommendation.priority)} · ${escape(r.recommendation.reason)}</p></details>` : ""}
    </section><section class="workspace-detail-section"><h3>GC priority decision</h3>${decisionHistory(r)}</section>`;
}
function details(r) {
  const official = responseVisibility(r, role) === "issued";
  const actions = allowedActions(r, role);
  const primary = actions.includes("route") ? "route" : actions[0];
  const lastDelivery = r.history.findLast(event => event.recipient && event.recipient !== event.actor);
  return `<section class="workspace-routing"><div><span class="workspace-badge" data-status="${escape(r.status)}">${escape(statusLabel(r))}</span>
    ${currentDecision(r) ? `<span class="workspace-badge" data-priority="${escape(currentDecision(r).priority)}">${escape(currentPriority(r))} · GC confirmed</span>` : ""}
    <p><strong>${escape(nextOwner(r) || "Both parties")} · ${escape(nextAction(r))}</strong></p></div>
    ${lastDelivery ? `<p class="workspace-delivery"><small>Latest handoff</small> ${escape(lastDelivery.actor)} → ${escape(lastDelivery.recipient)} · Rev ${escape(lastDelivery.revision)}</p>` : ""}
    <div class="workspace-actions">${actions.map(action => `<button data-action="${action}" class="${action === primary ? "workspace-primary" : ""}">${labels[action]}</button>`).join("")}${actions.includes("decide") ? '<button type="button" data-view-assessments>View assessments ↓</button>' : ""}</div></section>
    ${r.reason && ["returned", "clarification"].includes(r.status) ? `<section class="workspace-source"><h3>Clarification requested</h3><p>${escape(r.reason)}</p></section>` : ""}
    ${official ? `<section class="workspace-detail-section official-response"><h3>Issued technical response</h3><p>${escape(r.response)}</p>
      <p class="workspace-secondary">${escape(when(r.responseDate))}${r.signoff ? ` · Reviewed by ${escape(r.signoff.reviewer)} · ${escape(r.signoff.reference)} · Issued by ${escape(r.signoff.issuedBy)}` : ""}</p></section>` : ""}
    <dl class="workspace-facts">${fact("Submitted by", r.originator)}${fact("Technical responder", r.assignee || "Pending routing")}
      ${fact("Submission date",r.submittedDate)}${fact("Needed by",neededBy(r))}${fact("Source",r.source)}${fact("Revision",r.revision)}
      ${r.location ? fact("Location",r.location) : ""}${r.reference ? fact("Drawing / specification",r.reference) : ""}</dl>
    <section class="workspace-detail-section"><h3>RFI question and supporting information</h3><p>${escape(r.question)}</p>
      ${r.attachments?.length ? `<p class="workspace-secondary">Attachment references · ${escape(r.attachments.join(", "))}</p>` : ""}${attachments(r.files)}</section>
    ${renderSourceEvidence(r)}
    ${decisionsPanel(r)}
    <section class="workspace-detail-section"><h3>Exchange history</h3>
      ${r.history.length ? `<ol class="exchange-list">${r.history.map(h => `<li><strong>${escape(h.actor)}${h.recipient && h.recipient !== h.actor ? ` → ${escape(h.recipient)}` : ""}</strong>
        <small>${escape(h.kind ? labels[h.kind] || h.kind : "Earlier activity")} · ${escape(when(h.at || h.date))}${h.revision ? ` · Rev ${h.revision}` : ""}</small>
        <p>${escape(h.text)}</p></li>`).join("")}</ol>` : "<p>No handoffs yet.</p>"}</section>
    ${responseVisibility(r, role) === "draft" ? `<section class="workspace-detail-section"><h3>Response draft</h3><p>${escape(r.response)}</p></section>` : ""}
    ${r.revisions?.length ? `<details class="workspace-detail-section"><summary>Previous revisions (${r.revisions.length})</summary>
      ${r.revisions.slice().reverse().map(v => `<section><h3>${escape(v.title)}</h3>
        <small>${v.revision ? "Rev " + escape(v.revision) + " · " : ""}${escape(when(v.date))} · ${escape(v.revisionReason)} · Needed by ${escape(neededBy(v) || "unknown")}</small>
        <p>${escape(v.question)}</p>${responseVisibility(v,role) ? `<p>${responseVisibility(v,role) === "issued" ? "Previously issued response" : "Earlier response draft"} · ${escape(v.response)}</p>` : ""}${attachments(v.files)}</section>`).join("")}</details>` : ""}`;
}

function actionFields(action, r) {
  if (["create", "edit", "revise"].includes(action)) {
    return field("Subject", "title", r?.title, { required: true }) +
      field("RFI question and supporting information", "question", r?.question, { required: true, multiline: true }) +
      field("Needed-by date", "requestedBy", r ? neededBy(r) : "", { type: "date" }) +
      field("Location", "location", r?.location) + field("Drawing / specification reference", "reference", r?.reference) +
      field("Attachment reference", "attachment", r?.attachments?.join(", ")) +
      '<label>Add files<input type="file" name="files" accept=".pdf,.png,.jpg,.jpeg" multiple></label><p class="workspace-secondary">PDF, PNG or JPEG · Up to 3 files, 1 MB each.</p>' +
      (action === "revise" ? field("Reason for revision", "revisionReason", "", { required: true }) +
        "<p>A new revision returns to the submitter for assessment, priority confirmation and routing.</p>" : "");
  }
  if (action === "decide") return `<p>Record the GC review priority for revision ${r.revision}.</p>${r.assessments.filter(a => a.revision === r.revision).map(a =>
      `<p>${escape(a.source)} · ${escape(priorityLabels[a.priority] || "Needs information")}${a.simulated ? " (simulated)" : ""}</p>`).join("")}
      <label>Confirmed priority<select name="priority" required><option value="">Choose priority</option>
      ${Object.entries(priorityLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>` +
    field("Decision reason", "reason", "", { required: true, multiline: true });
  if (action === "route") return `<p>Send revision ${r.revision} to <strong>${escape(roles.responder.name)}</strong> at ${escape(roles.responder.company)}.</p>
    <p>Confirmed priority · ${escape(currentPriority(r))}</p><blockquote>${escape(r.pendingReply || r.question)}</blockquote>`;
  if (action === "clarify") return field("Question for the submitter", "reason", "", { required: true, multiline: true });
  if (action === "reply") return `<blockquote>${escape(r.reason)}</blockquote>` +
    field("Additional information", "reply", "", { required: true, multiline: true }) +
    "<p>Your clarification creates a new revision. Confirm its priority and route it back to the responder.</p>";
  if (["sendResponse", "draftResponse"].includes(action)) return `<blockquote>${escape(r.question)}</blockquote>` +
    field("Technical response", "response", r.response, { required: true, multiline: true });
  if (action === "release") return `<p>Send the signed technical answer to ${escape(r.originator)}.</p><blockquote>${escape(r.response)}</blockquote>` +
    field("Technical reviewer", "reviewer", "", { required: true }) + field("Sign-off reference or note", "signoffReference", "", { required: true }) +
    '<label><input type="checkbox" name="signoff" value="confirmed" required> I confirm technical sign-off for this demo response.</label>';
  if (action === "acknowledge") return `<p>Confirm receipt from ${escape(r.assignee)}. The responder will see your acknowledgment.</p><blockquote>${escape(r.response)}</blockquote>`;
  return "<p>Move this draft into your priority review queue.</p>";
}
function showDialog(r, action = "") {
  fileUrls.forEach(u => URL.revokeObjectURL(u)); fileUrls = [];
  selected = r?.id || "";
  openedRecord = r ? structuredClone(r) : null;
  mode = action;
  dialog.innerHTML = `<header class="workspace-dialog-header"><div><p class="overline">${escape(r?.id || "New RFI")}${r ? " · Rev " + r.revision : ""}</p>
    <h2 id="dialog-title">${escape(action ? labels[action] : r.title)}</h2></div><button type="button" data-close aria-label="Close detail">✕</button></header>
    <div class="workspace-dialog-body">${action ? `<form id="rfi-action-form">${actionFields(action,r)}
      <div class="workspace-actions"><button type="button" data-back>Cancel</button><button class="workspace-primary" type="submit">${labels[action]}</button></div></form>` : details(r)}
      <p id="form-error" role="alert" hidden></p></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  (dialog.querySelector("form input, form select, form textarea") || dialog.querySelector("[data-close]"))?.focus();
}
function report(error) {
  if (!dialog.open || !$("form-error")) { say(error.message || "Unable to save this change."); return; }
  $("form-error").textContent = error.message || "Unable to save this change.";
  $("form-error").hidden = false;
  $("form-error").scrollIntoView({block:"nearest"});
}

async function saveAction(event) {
  event.preventDefault();
  if (saving) return;
  saving = true;
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const action = mode, id = selected, initial = openedRecord;
  try {
    const data = new FormData(form);
    const values = Object.fromEntries(Array.from(data).filter(([,v]) => typeof v === "string").map(([k,v]) => [k,v.trim()]));
    const files = await readFiles(Array.from(form.elements.files?.files || []));
    if (!dialog.open || mode !== action || selected !== id) return;
    let targetId;
    await mutate(fresh => {
      let r = fresh.find(x => x.id === id);
      if (action === "create" && role === "submitter") {
        const next = 1 + Math.max(0,...fresh.map(x => Number(/^RFI-(\d+)$/.exec(x.id)?.[1]) || 0));
        r = makeDraft("RFI-" + String(next).padStart(3, "0")); fresh.push(r);
      } else if (!actionSnapshotMatches(initial, r, action)) {
        throw new Error("This RFI changed in another view. Close the form and reopen the latest record.");
      }
      if (action === "decide") {
        values.reviewedAssessmentIds = initial.assessments.filter(a => a.revision === initial.revision).map(a => a.id);
      }
      if (["edit", "revise", "create"].includes(action)) {
        values.attachments = values.attachment ? [values.attachment] : [];
        values.files = [...r.files, ...files];
        if (values.files.length > 3) throw new Error("Keep up to 3 supporting files per RFI.");
      }
      applyAction(r, role, action === "create" ? "edit" : action, values);
      targetId = r.id;
    });
    const updated = records.find(r => r.id === targetId);
    render(); showDialog(updated);
    say(updated.id + " · " + statusLabel(updated));
  } catch (error) { report(error); } finally { saving = false; submit.disabled = false; }
}

async function assess(record, source) {
  if (!allowedActions(record, role).includes("decide")) return;
  const key = planEntry(record);
  if (source === "live" && requests.has(key)) return;
  if (source === "live") requests.add(key);
  const sourceRecord = structuredClone(record);
  const refresh = () => {
    const fresh = records.find(r => r.id === record.id);
    if (dialog.open && selected === record.id && !mode && fresh && visibleTo(fresh,role)) showDialog(fresh);
  };
  try {
    refresh();
    const results = source === "live" ? [await assessWorkspaceRfi(sourceRecord)] : simulatedWorkspaceAssessments(sourceRecord);
    await mutate(fresh => {
      const item = fresh.find(r => r.id === record.id);
      if (!item) throw new Error("RFI no longer exists.");
      for (const result of results) recordAssessment(item, result);
    });
    say(record.id + " · " + (source === "live" ? "JEV assessment saved." : "Simulated assessments saved."));
  } catch (e) {
    if (source === "live") requests.delete(key);
    refresh(); report(e); return;
  } finally { if (source === "live") requests.delete(key); }
  refresh();
}

content.addEventListener("click", async event => {
  const b = event.target.closest("button");
  if (!b) return;
  try {
    if (b.hasAttribute("data-tab")) { tab = Number(b.dataset.tab); render(); content.querySelector(`[data-tab="${tab}"]`).focus(); }
    if (b.dataset.plan && role === "submitter") await updatePlan(b);
    if (b.hasAttribute("data-export") && role === "submitter") downloadReviewDecisions(scoped());
    if (b.hasAttribute("data-new") && role === "submitter") showDialog(null, "create");
    if (b.id === "library-open" && role === "submitter") {
      const source = sourceRecords.find(r => r.rfi_id === $("library-select").value);
      if (!source) return;
      await mutate(fresh => {
        if (!fresh.some(r => r.id === source.rfi_id)) fresh.push(makeDraft(source.rfi_id, source));
      });
      render();
      const record = scoped().find(r => r.id === source.rfi_id);
      if (!record) throw new Error("A record with this ID already belongs to a different submitter.");
      showDialog(record);
    }
    if (b.dataset.record) {
      const r = scoped().find(item => item.id === b.dataset.record);
      if (r) showDialog(r);
    }
  } catch (e) { report(e); }
});
content.addEventListener("input", e => { if (e.target.id === "find-rfi") { query = e.target.value; renderList(); } });
content.addEventListener("change", e => { if (e.target.id === "timing-rfi") { timing = e.target.value; renderList(); } });
dialog.addEventListener("click", event => {
  const b = event.target.closest("button");
  if (!b) return;
  const r = scoped().find(item => item.id === selected);
  if (b.hasAttribute("data-close")) dialog.close();
  if (b.hasAttribute("data-view-assessments")) {
    $("priority-assessments").scrollIntoView({ block: "start" });
    $("priority-assessments").focus({ preventScroll: true });
  }
  if (b.hasAttribute("data-back")) { if (r) showDialog(r); else dialog.close(); }
  if (r && b.dataset.action && allowedActions(r,role).includes(b.dataset.action)) showDialog(r,b.dataset.action);
  if (r && b.dataset.assess) assess(r,b.dataset.assess);
});
dialog.addEventListener("submit", saveAction);
dialog.addEventListener("close", () => { fileUrls.forEach(u => URL.revokeObjectURL(u)); fileUrls = []; });
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
window.addEventListener("storage", e => {
  if (![recordsKey,planKey].includes(e.key)) return;
  try {
    records = readRecords(); plan = readPlan(); render();
    if (dialog.open && selected && !mode) {
      const r = scoped().find(item => item.id === selected);
      if (r) showDialog(r); else dialog.close();
    }
    say("Workspace updated in another view.");
  } catch (error) { report(error); }
});
start().catch(() => { content.innerHTML = '<p class="workspace-empty">The workspace could not load. Check browser storage and <a href="signin.html">return to sign in</a>.</p>'; });
