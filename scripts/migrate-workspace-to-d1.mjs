// One-time, resumable migration of the local Node JSON workspace to Cloudflare D1.
// Requires a Cloudflare API token with D1 Edit permission in the environment.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const sourcePath = resolve(process.env.WORKSPACE_JSON_PATH || "server-data/rfi-workspace.json");
if (!accountId || !databaseId || !apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN first.");

const source = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(source.users) || !Array.isArray(source.rfis)) throw new Error("The source file is not a valid RFI workspace store.");
const sourceUserIds = new Set(source.users.map((user) => user.id));
if (source.rfis.some((rfi) => !sourceUserIds.has(rfi.senderId))) throw new Error("A source RFI references an account that is missing from the local store.");
if (source.rfis.some((rfi) => (rfi.messages || []).some((message) => !sourceUserIds.has(message.authorId)))) throw new Error("A source response references an account that is missing from the local store.");

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
async function run(payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.errors?.length) throw new Error(`D1 migration request failed (HTTP ${response.status}). Check the API token, database ID, and applied migration.`);
  return result.result || [];
}
async function query(sql, params = []) { return (await run({ sql, params }))[0]?.results || []; }

const existingUsers = await query("SELECT id,email FROM users");
const sourceById = new Map(source.users.map((user) => [user.id, user]));
for (const existing of existingUsers) {
  const local = sourceById.get(existing.id);
  if (!local || local.email !== existing.email) throw new Error("The target database already has accounts outside this local workspace. Stop before importing so records are not combined incorrectly.");
}

const statements = [];
for (const user of source.users) statements.push({
  sql: "INSERT OR IGNORE INTO users (id,email,name,role,project_id,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?)",
  params: [user.id,user.email,user.name,user.role,user.projectId || "East Link · Station Systems",user.salt,user.passwordHash,new Date().toISOString()],
});
for (const rfi of source.rfis) statements.push({
  sql: "INSERT OR IGNORE INTO rfis (id,project_id,sender_id,sender_email,sender_name,recipient_email,title,location,reference,question,due,status,history_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  params: [rfi.id,rfi.projectId || "East Link · Station Systems",rfi.senderId,rfi.senderEmail,rfi.senderName,rfi.recipientEmail,rfi.title,rfi.location,rfi.reference,rfi.question,rfi.due,rfi.status,JSON.stringify(rfi.history || []),new Date().toISOString()],
});
for (const rfi of source.rfis) for (const [index,message] of (rfi.messages || []).entries()) statements.push({
  sql: "INSERT OR IGNORE INTO rfi_messages (id,rfi_id,author_id,author,email,at,text) VALUES (?,?,?,?,?,?,?)",
  params: [message.id || `${rfi.id}-${index}`,rfi.id,message.authorId,message.author,message.email,message.at,message.text],
});
for (const rfi of source.rfis) for (const [index,file] of (rfi.files || []).entries()) statements.push({
  sql: "INSERT OR IGNORE INTO rfi_attachments (rfi_id,file_index,name,type,bytes,data) VALUES (?,?,?,?,?,?)",
  params: [rfi.id,index,file.name,file.type,file.bytes,file.data],
});

for (let offset = 0; offset < statements.length; offset += 50) {
  await run({ batch: statements.slice(offset, offset + 50) });
}
console.log(`Imported ${source.users.length} accounts and ${source.rfis.length} RFIs, with their threads and attachments. Session tokens were not copied; sign in with each account's existing email and password to create a new session.`);
