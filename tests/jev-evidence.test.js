import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDescriptionEvidence } from "../js/jev-evidence.js";

test("reports explicit cost and schedule detail with source excerpts", () => {
  const evidence = analyzeDescriptionEvidence(
    "The change adds an estimated cost of $12,500. The crew is delayed by 3 days.",
  );
  assert.deepEqual(
    evidence.map(({ key, status }) => [key, status]),
    [
      ["cost", "quantified"],
      ["schedule", "quantified"],
      ["work", "mentioned"],
      ["safety", "not_stated"],
    ],
  );
  assert.deepEqual(evidence[0].excerpts, ["The change adds an estimated cost of $12,500."]);
  assert.deepEqual(evidence[1].excerpts, ["The crew is delayed by 3 days."]);
});

test("distinguishes a mention without detected quantities from absent evidence", () => {
  const evidence = analyzeDescriptionEvidence("No cost impact is expected; the schedule may be affected.");
  assert.equal(evidence[0].status, "mentioned");
  assert.equal(evidence[0].excerpts[0], "No cost impact is expected; the schedule may be affected.");
  assert.equal(evidence[1].status, "mentioned");
  assert.equal(evidence[1].summary, "Mentioned; no time or date detected");
  assert.equal(evidence[2].status, "not_stated");
});

test("examines only the description and handles missing descriptions", () => {
  const evidence = analyzeDescriptionEvidence(null);
  assert.equal(evidence.length, 4);
  assert.ok(evidence.every(({ status, excerpts }) => status === "not_stated" && excerpts.length === 0));
});
