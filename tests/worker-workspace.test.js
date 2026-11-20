import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleWorkspace } from "../worker/workspace.js";

class LocalD1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  first() { return this.database.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.database.sqlite.prepare(this.sql).all(...this.params) }; }
  run() { return this.database.sqlite.prepare(this.sql).run(...this.params); }
}
class LocalD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../migrations/0001_workspace.sql", import.meta.url), "utf8"));
  }
  prepare(sql) { return new LocalD1Statement(this, sql); }
  batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const result = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const pdf = Buffer.from("%PDF-1.4\nRFI attachment\n");
const requiredRfi = { title: "Door clearance", location: "Station A", reference: "A-101", question: "Confirm the clearance dimension.", recipientEmail: "receiver@example.com", due: "2027-02-01" };

test("Cloudflare workspace endpoints preserve account scope, RFI threads, statuses and private attachments", async () => {
  const database = new LocalD1(), env = { WORKSPACE_DB: database };
  const request = async (path, { method = "GET", body, token } = {}) => {
    const response = await handleWorkspace(new Request(`https://app.example${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, json);
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    return { response, data };
  };
  const sender = (await request("/api/workspace/register", { method: "POST", body: { email: " Sender@Example.com ", password: "test", name: "Sender", role: "submitter" } })).data;
  const responder = (await request("/api/workspace/register", { method: "POST", body: { email: "receiver@example.com", password: "test", name: "Receiver", role: "responder" } })).data;
  const checker = (await request("/api/workspace/register", { method: "POST", body: { email: "checker@example.com", password: "test", name: "Checker", role: "checker" } })).data;
  const unrelated = (await request("/api/workspace/register", { method: "POST", body: { email: "other@example.com", password: "test", name: "Other", role: "checker" } })).data;
  database.sqlite.prepare("UPDATE users SET project_id = ? WHERE id = ?").run("Other project", unrelated.user.id);

  const invalid = await request("/api/workspace/rfis", { method: "POST", token: sender.token, body: { ...requiredRfi, title: "", send: true } });
  assert.equal(invalid.response.status, 400);
  const draft = await request("/api/workspace/rfis", { method: "POST", token: sender.token, body: { ...requiredRfi } });
  assert.equal(draft.response.status, 201);
  assert.equal(draft.data.rfi.status, "draft");
  assert.equal((await request("/api/workspace/rfis", { token: responder.token })).data.rfis.length, 0);
  assert.equal((await request(`/api/workspace/rfis/${draft.data.rfi.id}`, { token: responder.token })).response.status, 404);

  const sent = await request("/api/workspace/rfis", { method: "POST", token: sender.token, body: { ...requiredRfi, send: true, files: [{ name: "detail.pdf", type: "application/pdf", bytes: pdf.length, data: pdf.toString("base64") }] } });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.rfi.files[0].name, "detail.pdf");
  assert.equal("data" in sent.data.rfi.files[0], false);
  const assigned = await request("/api/workspace/rfis", { token: responder.token });
  assert.deepEqual(assigned.data.rfis.map((rfi) => rfi.id), [sent.data.rfi.id]);
  const preview = await request(`/api/workspace/rfis/${sent.data.rfi.id}/attachments/0`, { token: responder.token });
  assert.equal(preview.response.status, 200);
  assert.deepEqual(Buffer.from(await preview.response.arrayBuffer()), pdf);
  assert.equal((await request(`/api/workspace/rfis/${sent.data.rfi.id}/attachments/0`, { token: unrelated.token })).response.status, 404);

  for (const text of ["First response", "Follow-up response"]) {
    const reply = await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { method: "POST", token: responder.token, body: { message: text } });
    assert.equal(reply.response.status, 200);
  }
  await request(`/api/workspace/rfis/${sent.data.rfi.id}/status`, { method: "POST", token: responder.token, body: { status: "reviewed" } });
  const thread = await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { token: sender.token });
  assert.deepEqual(thread.data.rfi.messages.map((message) => message.text), ["First response", "Follow-up response"]);
  assert.equal(thread.data.rfi.status, "reviewed");
  await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { method: "POST", token: sender.token, body: { message: "Thanks; that resolves it." } });
  const resolved = await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { method: "POST", token: sender.token, body: { status: "resolved" } });
  assert.equal(resolved.data.rfi.status, "resolved");
  assert.equal(resolved.data.rfi.messages.length, 3);
  assert.equal((await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { token: checker.token })).response.status, 200);
  assert.equal((await request(`/api/workspace/rfis/${sent.data.rfi.id}`, { token: unrelated.token })).response.status, 404);

  await request("/api/workspace/logout", { method: "POST", token: responder.token, body: {} });
  assert.equal((await request("/api/workspace/rfis", { token: responder.token })).response.status, 401);
});
