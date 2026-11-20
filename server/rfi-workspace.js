import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateRfi } from "./rfi-validation.js";
export { validateRfi } from "./rfi-validation.js";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const id = () => randomBytes(16).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");

export class RfiWorkspace {
  constructor(path) { this.path = resolve(path); this.data = { users: [], sessions: [], rfis: [] }; this.writeChain = Promise.resolve(); }
  async load() {
    try { this.data = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 }); await rename(temporary, this.path);
    });
    return this.writeChain;
  }
  async register({ email, password, name, role }) {
    email = normalizeEmail(email);
    if (!validEmail(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
    if (typeof password !== "string" || !password.length) throw Object.assign(new Error("Enter a password."), { status: 400 });
    if (!String(name || "").trim()) throw Object.assign(new Error("Enter your name."), { status: 400 });
    if (!["submitter", "responder", "checker"].includes(role)) throw Object.assign(new Error("Choose a supported workspace role."), { status: 400 });
    if (this.data.users.some((u) => u.email === email)) throw Object.assign(new Error("An account already exists for this email."), { status: 409 });
    const salt = randomBytes(16).toString("hex");
    const user = { id: id(), email, name: String(name).trim(), role, projectId: "East Link · Station Systems", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
    this.data.users.push(user);
    const token = randomBytes(32).toString("hex");
    this.data.sessions.push({ tokenHash: hash(token), userId: user.id }); await this.save();
    return { token, user: this.publicUser(user) };
  }
  publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role }; }
  async login({ email, password }) {
    const user = this.data.users.find((u) => u.email === normalizeEmail(email));
    if (!user) throw Object.assign(new Error("No account uses that email yet."), { status: 404, code: "account_not_found" });
    const candidate = scryptSync(String(password || ""), user?.salt || "unknown", 64);
    if (!timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"))) throw Object.assign(new Error("Password is incorrect."), { status: 401 });
    const token = randomBytes(32).toString("hex"); this.data.sessions.push({ tokenHash: hash(token), userId: user.id }); await this.save();
    return { token, user: this.publicUser(user) };
  }
  async logout(token) { this.data.sessions = this.data.sessions.filter((s) => s.tokenHash !== hash(token || "")); await this.save(); }
  userForToken(token) { const session = this.data.sessions.find((s) => s.tokenHash === hash(token || "")); return this.data.users.find((u) => u.id === session?.userId) || null; }
  require(token) { const user = this.userForToken(token); if (!user) throw Object.assign(new Error("Sign in to continue."), { status: 401 }); return user; }
  canSee(rfi, user) { return rfi.senderId === user.id || (rfi.status !== "draft" && rfi.recipientEmail === user.email) || (user.role === "checker" && rfi.status !== "draft" && rfi.projectId === user.projectId); }
  list(user) { return this.data.rfis.filter((r) => this.canSee(r, user)).map((r) => structuredClone(r)); }
  get(rfiId, user) { const rfi = this.data.rfis.find((r) => r.id === rfiId); if (!rfi || !this.canSee(rfi, user)) throw Object.assign(new Error("RFI not found."), { status: 404 }); return rfi; }
  async create(input, user) {
    if (user.role !== "submitter") throw Object.assign(new Error("Only senders can create RFIs."), { status: 403 });
    const errors = validateRfi(input);
    if (errors.length) throw Object.assign(new Error(errors.join(" ")), { status: 400 });
    const rfi = { id: id(), projectId: user.projectId || "East Link · Station Systems", senderId: user.id, senderEmail: user.email, senderName: user.name, recipientEmail: normalizeEmail(input.recipientEmail), title: input.title.trim(), location: input.location.trim(), reference: input.reference.trim(), question: input.question.trim(), due: input.due, files: input.files || [], status: input.send ? "submitted" : "draft", messages: [], history: [{ author: user.name, at: new Date().toISOString(), text: input.send ? "RFI sent." : "Draft created." }] };
    this.data.rfis.push(rfi); await this.save(); return structuredClone(rfi);
  }
  async mutate(rfiId, input, user) {
    const rfi = this.get(rfiId, user), sender = rfi.senderId === user.id, recipient = rfi.recipientEmail === user.email;
    if (input.message !== undefined) {
      if (!(sender || recipient)) throw Object.assign(new Error("You must be an RFI participant to respond."), { status: 403 });
      if (!String(input.message).trim() || String(input.message).trim().length > 5000) throw Object.assign(new Error("Enter a response of 1 to 5,000 characters."), { status: 400 });
      rfi.messages.push({ id: id(), authorId: user.id, author: user.name, email: user.email, at: new Date().toISOString(), text: String(input.message).trim() });
    }
    if (input.status !== undefined) {
      const valid = (sender && ["submitted", "in_progress", "resolved"].includes(input.status)) || (recipient && ["in_progress", "reviewed"].includes(input.status)) || (user.role === "checker" && rfi.projectId === user.projectId && ["in_progress", "reviewed"].includes(input.status));
      if (!valid) throw Object.assign(new Error("You cannot set this RFI status."), { status: 403 });
      rfi.status = input.status;
    }
    await this.save(); return structuredClone(rfi);
  }
}
