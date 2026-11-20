import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RfiWorkspace, validateRfi } from "../server/rfi-workspace.js";
import { createServer } from "../server/index.js";

const input = (recipientEmail, extra = {}) => ({ title: "Duct conflict", location: "Grid C4", reference: "A-412", question: "Can the duct be rerouted?", recipientEmail, due: "2027-02-15", send: true, files: [], ...extra });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "rfi-workspace-"));
  const store = new RfiWorkspace(join(directory, "store.json")); await store.load();
  async function account(email, role = "submitter") {
    const result = await store.register({ email, password: "x", name: email.split("@")[0], role });
    return { user: store.data.users.find(u => u.email === email.toLowerCase()), login: result };
  }
  return { directory, store, account };
}

test("RFI required fields and optional supported attachments validate", () => {
  assert.equal(validateRfi(input("person@example.com")).length, 0);
  assert.ok(validateRfi({}).length >= 6);
  assert.ok(validateRfi(input("bad-email")).some(x => x.includes("email")));
  assert.ok(validateRfi(input("person@example.com", { due: "yesterday" })).some(x => x.includes("due date")));
  assert.ok(validateRfi(input("person@example.com", { files: [{ name: "x.exe", type: "application/octet-stream", bytes: 1, data: "eA==" }] })).some(x => x.includes("Attachments")));
});

test("recipient matching, role-scoped access and threaded persistence", async (t) => {
  const { directory, store, account } = await setup(); t.after(() => rm(directory, { recursive: true, force: true }));
  const [sender, unrelated, checker] = await Promise.all([account("Sender@Example.com"), account("other@example.com"), account("check@example.com", "checker")]);
  await assert.rejects(store.login({ email: "new@example.com", password: "x" }), { status: 404, code: "account_not_found" });
  assert.equal((await store.login({ email: "sender@example.com", password: "x" })).user.role, "submitter");
  const draft = await store.create(input("reviewer@example.com", { send: false }), sender.user);
  assert.equal(store.list(unrelated.user).length, 0, "unrelated user cannot see an unsent draft");
  const sent = await store.mutate(draft.id, { status: "submitted" }, sender.user);
  assert.equal(sent.recipientEmail, "reviewer@example.com");
  const lateRecipient = await account("reviewer@example.com", "responder");
  assert.equal(store.list(lateRecipient.user).length, 1);
  assert.equal(store.list(unrelated.user).length, 0);
  assert.equal(store.list(checker.user).length, 1);
  assert.throws(() => store.get(sent.id, unrelated.user), { status: 404 });
  await store.mutate(sent.id, { message: "Use the lower route." }, lateRecipient.user);
  await store.mutate(sent.id, { message: "Please confirm clearance." }, sender.user);
  await store.mutate(sent.id, { status: "reviewed" }, lateRecipient.user);
  assert.equal(sent.status, "submitted");
  await store.load();
  const thread = store.get(sent.id, sender.user);
  assert.deepEqual(thread.messages.map(m => m.text), ["Use the lower route.", "Please confirm clearance."]);
  assert.equal(thread.status, "reviewed");
  await assert.rejects(store.mutate(sent.id, { status: "resolved" }, lateRecipient.user), { status: 403 });
  await store.mutate(sent.id, { status: "resolved" }, sender.user);
  assert.equal(store.get(sent.id, sender.user).status, "resolved");
  const secondSender = await account("second-sender@example.com");
  const assignedToSender = await store.create(input(sender.user.email), secondSender.user);
  assert.equal(store.list(sender.user).some(r => r.id === assignedToSender.id), true, "one sender account can also receive another RFI");
  await store.mutate(assignedToSender.id, { message: "I am responding as the addressed recipient." }, sender.user);
  assert.equal(store.get(assignedToSender.id, secondSender.user).messages[0].authorId, sender.user.id);
});

test("all supported roles can create accounts with simple credentials", async (t) => {
  const { directory, store } = await setup(); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const role of ["submitter", "responder", "checker"]) {
    const result = await store.register({ email: `${role}@example.com`, password: "1", name: role, role });
    assert.ok(result.token);
    assert.equal(result.user.role, role);
  }
});

test("HTTP endpoints require sessions and enforce ownership for direct RFI requests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rfi-http-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createServer({ env: { RFI_STORE_PATH: join(directory, "store.json"), ALLOWED_ORIGINS: "http://localhost" } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sameOrigin = await fetch(`${base}/api/workspace/register`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(sameOrigin.status, 400);
  assert.equal(sameOrigin.headers.get("access-control-allow-origin"), base);
  const crossOrigin = await fetch(`${base}/api/workspace/register`, { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(crossOrigin.status, 403);
  async function post(path, body, token) { return fetch(`${base}/api/workspace${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
  const missingAccount = await post("/login", { email: "new@example.com", password: "1" });
  assert.equal(missingAccount.status, 404); assert.equal((await missingAccount.json()).code, "account_not_found");
  const registeredResponse = await post("/register", { email: "sender@example.com", password: "1", name: "Sender", role: "submitter" });
  const registered = await registeredResponse.json();
  assert.equal(registeredResponse.status, 201); assert.ok(registered.token);
  const responderSignup = await post("/register", { email: "responder@example.com", password: "2", name: "Responder", role: "responder" });
  assert.equal(responderSignup.status, 201, "responders can register without invitation codes");
  const loggedIn = await (await post("/login", { email: "SENDER@example.com", password: "1" })).json();
  const inputRfi = input("recipient@example.com", { files: [{ name: "detail.pdf", type: "application/pdf", bytes: 9, data: Buffer.from("%PDF-1234").toString("base64") }] });
  const sentResponse = await post("/rfis", inputRfi, loggedIn.token); assert.equal(sentResponse.status, 201);
  const { rfi } = await sentResponse.json();
  const statusUpdate = await post(`/rfis/${rfi.id}/status`, { status: "in_progress" }, loggedIn.token);
  assert.equal(statusUpdate.status, 200, "the explicit status route updates the RFI");
  const messageUpdate = await post(`/rfis/${rfi.id}/messages`, { message: "A route-specific reply." }, loggedIn.token);
  assert.equal(messageUpdate.status, 200, "the explicit messages route appends a reply");
  assert.equal((await fetch(`${base}/api/workspace/rfis/${rfi.id}`)).status, 401);
  const other = await (await post("/register", { email: "other@example.com", password: "3", name: "Other", role: "submitter" })).json();
  const otherToken = (await (await post("/login", { email: "other@example.com", password: "3" })).json()).token;
  assert.equal((await fetch(`${base}/api/workspace/rfis/${rfi.id}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 404);
  assert.equal((await fetch(`${base}/api/workspace/rfis/${rfi.id}/attachments/0`, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 404);
});
