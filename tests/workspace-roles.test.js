import test from "node:test";
import assert from "node:assert/strict";
import { actionSnapshotMatches, allowedActions, applyAction, byPriority, currentDecision, eligibleForPlan, makeDraft, migrateRecords,
  neededBy, nextOwner, priorityReview, responseVisibility, recordAssessment, roles, visibleTo } from "../js/workspace-data.js";

const source = {
  rfi_id: "R200-123", title: "Coordination question.pdf", submitted_date: "2022-04-01", due_date: "2022-04-16",
  description: "Please clarify the finish. Estimated cost is $8,000.",
};
const alex = roles.submitter.name;
const priya = roles.responder.name;
const time = "2026-11-18T12:01:55.000Z";
const assessment = (r, id, priority, revision = r.revision) => ({ id, rfiId: r.id, revision, priority });
const initial = () => makeDraft(source.rfi_id, source);
const submit = r => applyAction(r, "submitter", "submit", {}, time);
const decide = (r, priority = "P1") => applyAction(r, "submitter", "decide", { priority, reason: "Install is due this week." }, time);
const route = r => applyAction(r, "submitter", "route", {}, time);
function assigned() {
  const r = initial(); submit(r); decide(r); route(r); return r;
}

test("exactly two role identities; only own submissions and assigned records are visible", () => {
  assert.deepEqual(Object.keys(roles), ["submitter", "responder"]);
  const r = initial();
  assert.equal(visibleTo(r, "submitter"), true);
  assert.equal(visibleTo(r, "responder"), false);
  assert.equal(visibleTo({ ...r, originator: "Someone else" }, "submitter"), false);
  for (const role of ["reader", "checker", "manager", "unknown"]) {
    assert.equal(visibleTo(r,role), false);
    assert.deepEqual(allowedActions(r,role), []);
  }
});

test("library imports preserve source text and project dates; unknown source dates stay unknown", () => {
  const r = initial();
  assert.equal(r.question, source.description);
  assert.equal(r.submittedDate, source.submitted_date);
  assert.equal(r.due, source.due_date);
  assert.equal(makeDraft("X", { rfi_id: "X" }).submittedDate, "");
  assert.equal(makeDraft("X", { rfi_id: "X" }).due, "");
});

test("legacy migration keeps files, approvals, records and original history without inventing recipients or priority decisions", () => {
  const prior = { id:"RFI-026", title: "Legacy", originator: alex, status: "answered", assignee: priya,
    files:[{ name:"drawing.pdf" }], response:"Official answer", signoff:{reviewer:"Engineer"},
    history:[{ date:"2025-09-08", actor:priya, text:"Issued" }], revisions:[{}],
    recommendation:{priority:"High", reason:"Sample"} };
  const [r] = migrateRecords([prior]);
  assert.equal(r.revision, 2); assert.equal(r.submittedDate, ""); assert.deepEqual(r.signoff, prior.signoff); assert.deepEqual(r.history, prior.history);
  assert.deepEqual(r.files,prior.files); assert.deepEqual(r.recommendation,prior.recommendation);
  assert.equal(currentDecision(r), undefined); assert.deepEqual(r.decisions, []); assert.equal(nextOwner(r), alex);
  assert.deepEqual(migrateRecords([r]),[r]); assert.equal(prior.revision,undefined);
  applyAction(r,"submitter","acknowledge",{},time); assert.equal(r.status,"acknowledged");
});

test("required fields, ownership and a revision-specific decision gate routing", () => {
  const r = initial();
  assert.throws(() => submit({ ...r, question:" " }));
  submit(r);
  assert.equal(nextOwner(r),alex);
  assert.throws(() => route(r));
  assert.throws(() => applyAction(r,"submitter","decide",{priority:"P9",reason:"test"}));
  assert.throws(() => applyAction(r,"submitter","decide",{priority:"P2",reason:" "}));
  recordAssessment(r,assessment(r,"a","P0")); recordAssessment(r,assessment(r,"b","P2"));
  assert.throws(() => route(r));
  decide(r); route(r);
  assert.equal(nextOwner(r),priya); assert.deepEqual(currentDecision(r).assessmentIds,["a","b"]);
  assert.deepEqual(allowedActions({ ...r, assignee: "Other designer" }, "responder"), []);
  assert.throws(() => applyAction(r, "responder", "decide", {priority:"P0",reason:"Urgent"}));
  assert.equal(r.history.at(-1).recipient,priya); assert.equal(r.history.at(-1).text,source.description);
});

test("clarification round trip preserves revision, message, priority history and previously established due date", () => {
  const r = assigned();
  applyAction(r, "responder", "clarify", { reason:"Which area is affected?" },time);
  assert.equal(nextOwner(r),alex); assert.equal(r.history.at(-1).recipient,alex);
  assert.throws(() => applyAction(r,"submitter","reply",{reply:""}));
  applyAction(r,"submitter","reply",{reply:"The south entrance."},time);
  assert.equal(r.revision,2); assert.equal(currentDecision(r),undefined);
  assert.equal(r.revisions[0].question,source.description);
  assert.equal(r.revisions[0].decision.priority,"P1"); assert.equal(r.due,source.due_date);
  assert.match(r.question,/Which area is affected/); assert.match(r.question,/The south entrance/);
  assert.equal(nextOwner(r),alex); assert.throws(() => route(r));
  decide(r,"P0"); route(r);
  assert.equal(r.history.at(-1).recipient,priya); assert.equal(r.history.at(-1).text,"The south entrance.");
  assert.equal(r.history.at(-1).revision,2); assert.equal(r.history.at(-1).at,time);
});

test("technical response is issued only after attestation; submitter records receipt and it leaves the daily plan", () => {
  const r = assigned();
  assert.throws(() => applyAction(r,"responder","release"));
  applyAction(r,"responder","sendResponse",{response:"Use detail A."},time);
  assert.throws(() => applyAction(r,"submitter","acknowledge"));
  assert.throws(() => applyAction(r,"responder","release",{signoff:"confirmed", reviewer:"Sam", signoffReference:" "}));
  applyAction(r,"responder","release",{signoff:"confirmed", reviewer:"Sam",signoffReference:"Review 32"},time);
  assert.equal(r.history.at(-1).text,"Use detail A."); assert.equal(r.history.at(-1).recipient,alex);
  assert.equal(nextOwner(r),alex); assert.throws(() => applyAction(r,"responder","acknowledge"));
  assert.equal(eligibleForPlan(r),true);
  applyAction(r,"submitter","acknowledge",{},time);
  assert.equal(r.history.at(-1).recipient,priya); assert.equal(nextOwner(r),""); assert.equal(eligibleForPlan(r),false);
  assert.throws(() => applyAction(r,"submitter","acknowledge"));
});

test("revised dates invalidate priority, late assessments stay on their source revision, superseded approvals remain", () => {
  const r = assigned();
  recordAssessment(r,assessment(r,"a","P1"));
  decide(r,"P0");
  applyAction(r,"submitter","revise",{revisionReason:"New date", title:r.title, question:r.question,
    requestedBy:"2022-05-15", reference:"A-111"},time);
  assert.equal(r.revision,2); assert.equal(r.revisions[0].due,source.due_date); assert.equal(r.revisions[0].decision.priority,"P0");
  assert.equal(currentDecision(r),undefined); assert.equal(eligibleForPlan(r),false);
  recordAssessment(r,assessment(r,"late","P1",1));
  assert.equal(currentDecision(r),undefined);
  recordAssessment(r,assessment(r,"b","P2")); decide(r,"P1");
  const before = structuredClone(currentDecision(r));
  recordAssessment(r,assessment(r,"late-live","P0"));
  assert.deepEqual(currentDecision(r),before); assert.deepEqual(before.assessmentIds,["b"]);
  decide(r,"P2"); assert.deepEqual(r.decisions.map(d => d.priority), ["P1","P0","P1","P2"]);
  recordAssessment(r,assessment(r,"late-live","P0")); assert.equal(r.assessments.length,4);
  assert.throws(() => recordAssessment(r,{...assessment(r,"wrong","P2"),rfiId:"other"}));
  assert.throws(() => recordAssessment(r,assessment(r,"future","P0",3)));
});

test("daily order uses confirmed priority and needed-by tie-break; a manual move leaves decisions intact", () => {
  const r1 = assigned(), r2 = assigned(), r3 = assigned(), draft = initial();
  r1.id = "A"; r2.id= "B"; r3.id="C";
  decide(r1,"P0"); decide(r2,"P1"); decide(r3,"P0"); r1.due="2022-06-30"; r3.due="2022-04-30";
  const sorted = [r1,r2,r3,draft].filter(eligibleForPlan).sort(byPriority);
  assert.deepEqual(sorted.map(r=>r.id),["C","A","B"]);
  sorted.unshift(sorted.pop()); assert.equal(currentDecision(sorted[0]).priority,"P1");
});

test("a new draft records its submission date on send; imported missing dates remain unknown", () => {
  const r = makeDraft("RFI-001");
  applyAction(r,"submitter","edit",{title:"Explicit date",question:"Ready to submit?"});
  assert.equal(r.submittedDate,"");
  const at = new Date(2026,10,20,12);
  applyAction(r,"submitter","submit",{},at.toISOString());
  assert.equal(r.submittedDate,"2026-11-20");
  const imported = makeDraft("R-1",{rfi_id:"R-1",title:"Source",description:"Old question."});
  applyAction(imported,"submitter","submit",{},at.toISOString());
  assert.equal(imported.submittedDate,"");
});

test("a waiting JEV result cannot invalidate the technical reply or be attributed to a prior human review", () => {
  const r = assigned();
  const before = assessment(r,"first","P1");
  recordAssessment(r,before);
  const opened = structuredClone(r);
  recordAssessment(r,assessment(r,"late","P0"));
  assert.equal(actionSnapshotMatches(opened,r,"decide"),true);
  applyAction(r,"submitter","decide",{priority:"P2",reason:"Access maintained",reviewedAssessmentIds:[before.id]});
  assert.deepEqual(currentDecision(r).assessmentIds,["first"]);
  assert.deepEqual(priorityReview(r).newProposals.map(a => a.id),["late"]);
  assert.equal(actionSnapshotMatches(opened,r,"sendResponse"),true);
  assert.equal(actionSnapshotMatches(opened,r,"decide"),false);
  assert.throws(() => applyAction(r,"submitter","decide",{priority:"P1",reason:"Review",reviewedAssessmentIds:["another-revision"]}));
  applyAction(r,"responder","draftResponse",{response:"A private technical draft."});
  assert.equal(actionSnapshotMatches(opened,r,"sendResponse"),false);
  const draft = structuredClone(r);
  applyAction(r,"submitter","revise",{title:r.title,question:r.question,revisionReason:"Changed work area"});
  assert.equal(actionSnapshotMatches(draft,r,"sendResponse"),false);
});

test("issued responses and private drafts retain their visibility in revision history", () => {
  const r = assigned();
  applyAction(r,"responder","sendResponse",{response:"Unreleased wording"});
  applyAction(r,"submitter","revise",{title:r.title,question:r.question,revisionReason:"Change before sign-off"});
  assert.equal(responseVisibility(r.revisions[0],"submitter"),"");
  assert.equal(responseVisibility(r.revisions[0],"responder"),"draft");
  decide(r); route(r);
  applyAction(r,"responder","sendResponse",{response:"Issued wording"});
  applyAction(r,"responder","release",{reviewer:"Sam",signoffReference:"Review #1",signoff:"confirmed"});
  applyAction(r,"submitter","revise",{title:r.title,question:r.question,revisionReason:"New field detail"});
  assert.equal(r.revisions[1].response,"Issued wording");
  for (const role of Object.keys(roles)) assert.equal(responseVisibility(r.revisions[1],role),"issued");
});

test("legacy requested-by keeps deadlines consistent across ranking and display", () => {
  const [r] = migrateRecords([{id:"L",status:"submitted",due:"",requestedBy:"2025-07-01"}]);
  const other = {...r,id:"B",due:"2025-08-01"};
  assert.equal(neededBy(r),"2025-07-01");
  assert.deepEqual([other,r].sort(byPriority).map(record => record.id),["L","B"]);
  assert.equal(neededBy({...r,due:"2025-06-01"}),"2025-06-01");
});

test("repeat simulated assessments per revision are idempotent and missing information counts as a differing outcome", () => {
  const r = assigned();
  const a = {...assessment(r,"A","P0"),simulated:true,source:"Scenario A"};
  recordAssessment(r,a);recordAssessment(r,{...a,id:"duplicate"});
  recordAssessment(r,{...a,id:"B",priority:null,source:"Scenario B"});
  assert.equal(r.assessments.length,2);
  assert.equal(priorityReview(r).disagreement,true);
  decide(r);
  assert.deepEqual(priorityReview(r).newProposals,[]);
  recordAssessment(r,{...assessment(r,"L","P2"),source:"Live JEV",simulated:false});
  assert.deepEqual(priorityReview(r).newProposals.map(a=>a.id),["L"]);
});
