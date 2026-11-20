import { Buffer } from "node:buffer";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { validateRfi } from "../server/rfi-validation.js";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const id = () => randomBytes(16).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    recipientEmail: row.recipient_email,
    title: row.title,
    location: row.location,
    reference: row.reference,
    question: row.question,
    due: row.due,
    status: row.status,
    files: JSON.parse(row.files_json || "[]"),
    messages: JSON.parse(row.messages_json || "[]"),
    history: JSON.parse(row.history_json || "[]"),
  };
}

const RFI_SELECT = `SELECT r.*,
  (SELECT json_group_array(json(file_json)) FROM (SELECT json_object('name', f.name, 'type', f.type, 'bytes', f.bytes) AS file_json FROM rfi_attachments f WHERE f.rfi_id = r.id ORDER BY f.file_index)) AS files_json,
  (SELECT json_group_array(json(message_json)) FROM (SELECT json_object('id', m.id, 'authorId', m.author_id, 'author', m.author, 'email', m.email, 'at', m.at, 'text', m.text) AS message_json FROM rfi_messages m WHERE m.rfi_id = r.id ORDER BY m.sequence)) AS messages_json
  FROM rfis r`;

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) throw fail(415, "Use application/json.");
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 5_000_000) { await reader.cancel().catch(() => {}); throw fail(413, "Request exceeds 5 MB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw fail(400, "Invalid JSON request."); }
}

async function requireUser(request, env) {
  const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw fail(401, "Sign in to continue.");
  const user = await env.WORKSPACE_DB.prepare(`SELECT u.id, u.email, u.name, u.role, u.project_id
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(hash(token)).first();
  if (!user) throw fail(401, "Sign in to continue.");
  return { id: user.id, email: user.email, name: user.name, role: user.role, projectId: user.project_id };
}

function publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role }; }
function canSee(rfi, user) {
  return rfi.senderId === user.id || (rfi.status !== "draft" && rfi.recipientEmail === user.email) || (user.role === "checker" && rfi.status !== "draft" && rfi.projectId === user.projectId);
}
async function getRfi(rfiId, user, env) {
  const row = await env.WORKSPACE_DB.prepare(`${RFI_SELECT} WHERE r.id = ?`).bind(rfiId).first();
  const rfi = fromRow(row);
  if (!rfi || !canSee(rfi, user)) throw fail(404, "RFI not found.");
  return rfi;
}
async function getRows(env, sql, ...params) {
  const result = await env.WORKSPACE_DB.prepare(sql).bind(...params).all();
  return result.results || [];
}
function blobBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw fail(500, "Stored attachment data is unreadable.");
}

async function register(input, env) {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) throw fail(400, "Enter a valid email address.");
  if (typeof input.password !== "string" || !input.password.length) throw fail(400, "Enter a password.");
  if (!String(input.name || "").trim()) throw fail(400, "Enter your name.");
  if (!["submitter", "responder", "checker"].includes(input.role)) throw fail(400, "Choose a supported workspace role.");
  const existing = await env.WORKSPACE_DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw fail(409, "An account already exists for this email.");
  const user = { id:id(), email, name:String(input.name).trim(), role:input.role, projectId:"East Link · Station Systems", salt:randomBytes(16).toString("hex"), createdAt:new Date().toISOString() };
  user.passwordHash = scryptSync(input.password,user.salt,64).toString("hex");
  const token = randomBytes(32).toString("hex");
  try {
    await env.WORKSPACE_DB.batch([
      env.WORKSPACE_DB.prepare("INSERT INTO users (id,email,name,role,project_id,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(user.id,user.email,user.name,user.role,user.projectId,user.salt,user.passwordHash,user.createdAt),
      env.WORKSPACE_DB.prepare("INSERT INTO sessions (token_hash,user_id,created_at) VALUES (?,?,?)").bind(hash(token),user.id,new Date().toISOString()),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed: users\.email/i.test(error.message || "")) throw fail(409, "An account already exists for this email.");
    throw error;
  }
  return { token, user: publicUser(user) };
}

async function login(input, env) {
  const email = normalizeEmail(input.email);
  const user = await env.WORKSPACE_DB.prepare("SELECT id,email,name,role,project_id,salt,password_hash FROM users WHERE email = ?").bind(email).first();
  if (!user) throw fail(404, "No account uses that email yet.", "account_not_found");
  const candidate = scryptSync(String(input.password || ""), user.salt, 64);
  if (!timingSafeEqual(candidate, Buffer.from(user.password_hash, "hex"))) throw fail(401, "Password is incorrect.");
  const token = randomBytes(32).toString("hex");
  await env.WORKSPACE_DB.prepare("INSERT INTO sessions (token_hash,user_id,created_at) VALUES (?,?,?)").bind(hash(token),user.id,new Date().toISOString()).run();
  return { token, user: publicUser({ id:user.id,email:user.email,name:user.name,role:user.role }) };
}

async function createRfi(input, user, env) {
  if (user.role !== "submitter") throw fail(403, "Only senders can create RFIs.");
  const errors = validateRfi(input);
  if (errors.length) throw fail(400, errors.join(" "));
  const rfi = { id:id(), projectId:user.projectId || "East Link · Station Systems", senderId:user.id, senderEmail:user.email, senderName:user.name, recipientEmail:normalizeEmail(input.recipientEmail), title:input.title.trim(), location:input.location.trim(), reference:input.reference.trim(), question:input.question.trim(), due:input.due, status:input.send ? "submitted" : "draft", history:[{author:user.name,at:new Date().toISOString(),text:input.send ? "RFI sent." : "Draft created."}] };
  const statements = [env.WORKSPACE_DB.prepare(`INSERT INTO rfis (id,project_id,sender_id,sender_email,sender_name,recipient_email,title,location,reference,question,due,status,history_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rfi.id,rfi.projectId,rfi.senderId,rfi.senderEmail,rfi.senderName,rfi.recipientEmail,rfi.title,rfi.location,rfi.reference,rfi.question,rfi.due,rfi.status,JSON.stringify(rfi.history),new Date().toISOString())];
  for (const [index,file] of (input.files || []).entries()) {
    statements.push(env.WORKSPACE_DB.prepare("INSERT INTO rfi_attachments (rfi_id,file_index,name,type,bytes,data) VALUES (?,?,?,?,?,?)").bind(rfi.id,index,file.name,file.type,file.bytes,file.data));
  }
  await env.WORKSPACE_DB.batch(statements);
  return getRfi(rfi.id,user,env);
}

async function mutateRfi(rfiId, input, user, env) {
  const rfi = await getRfi(rfiId,user,env);
  const sender = rfi.senderId === user.id;
  const recipient = rfi.recipientEmail === user.email;
  const statements = [];
  if (input.message !== undefined) {
    if (!(sender || recipient)) throw fail(403, "You must be an RFI participant to respond.");
    const text = String(input.message).trim();
    if (!text || text.length > 5000) throw fail(400, "Enter a response of 1 to 5,000 characters.");
    statements.push(env.WORKSPACE_DB.prepare("INSERT INTO rfi_messages (id,rfi_id,author_id,author,email,at,text) VALUES (?,?,?,?,?,?,?)").bind(id(),rfi.id,user.id,user.name,user.email,new Date().toISOString(),text));
  }
  if (input.status !== undefined) {
    const valid = (sender && ["submitted","in_progress","resolved"].includes(input.status)) || (recipient && ["in_progress","reviewed"].includes(input.status)) || (user.role === "checker" && rfi.projectId === user.projectId && ["in_progress","reviewed"].includes(input.status));
    if (!valid) throw fail(403, "You cannot set this RFI status.");
    statements.push(env.WORKSPACE_DB.prepare("UPDATE rfis SET status = ?, updated_at = ? WHERE id = ?").bind(input.status,new Date().toISOString(),rfi.id));
  }
  if (!statements.length) throw fail(400, "Enter a response or choose a status change.");
  await env.WORKSPACE_DB.batch(statements);
  return getRfi(rfi.id,user,env);
}

export async function handleWorkspace(request, env, json) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/workspace/")) return null;
  if (!env.WORKSPACE_DB) return json(503,{error:"Cloudflare account storage is not configured."});
  try {
    const method = request.method;
    const match = path.match(/^\/api\/workspace\/rfis\/([a-f0-9]+)(?:\/(messages|status|attachments\/\d+))?$/);
    if (path === "/api/workspace/register" && method === "POST") return json(201,await register(await readJson(request),env));
    if (path === "/api/workspace/login" && method === "POST") return json(200,await login(await readJson(request),env));
    if (path === "/api/workspace/logout" && method === "POST") {
      const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (token) await env.WORKSPACE_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash(token)).run();
      return json(200,{ok:true});
    }
    const user = await requireUser(request,env);
    if (path === "/api/workspace/me" && method === "GET") return json(200,{user:publicUser(user)});
    if (path === "/api/workspace/rfis" && method === "GET") {
      const rows = await getRows(env,`${RFI_SELECT} ORDER BY r.created_at DESC`);
      return json(200,{rfis:rows.map(fromRow).filter((rfi)=>canSee(rfi,user))});
    }
    if (path === "/api/workspace/rfis" && method === "POST") return json(201,{rfi:await createRfi(await readJson(request),user,env)});
    if (match && method === "GET") {
      const rfi = await getRfi(match[1],user,env);
      if (match[2]?.startsWith("attachments/")) {
        const index = Number(match[2].split("/")[1]);
        const file = await env.WORKSPACE_DB.prepare("SELECT name,type,data FROM rfi_attachments WHERE rfi_id = ? AND file_index = ?").bind(rfi.id,index).first();
        if (!file) return json(404,{error:"Attachment not found."});
        const headers = new Headers({"Content-Type":file.type,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
        return new Response(blobBytes(file.data),{status:200,headers});
      }
      return json(200,{rfi});
    }
    if (match && method === "POST" && (!match[2] || match[2] === "status")) return json(200,{rfi:await mutateRfi(match[1],await readJson(request),user,env)});
    return json(404,{error:"Unknown workspace route."});
  } catch (error) {
    return json(error.status || 500,{error:error.status ? error.message : "Workspace request failed.",...(error.code ? {code:error.code} : {})});
  }
}
