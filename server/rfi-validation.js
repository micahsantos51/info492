import { Buffer } from "node:buffer";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function validateRfi(input = {}) {
  const errors = [];
  for (const [key, label] of [["title", "Subject"], ["location", "Location"], ["reference", "Drawing/specification reference"], ["question", "Question text"]]) if (!String(input[key] || "").trim()) errors.push(`${label} is required.`);
  if (!validEmail(normalizeEmail(input.recipientEmail))) errors.push("Enter a valid recipient email address.");
  const dueTime = Date.parse(`${input.due}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due || "") || Number.isNaN(dueTime) || new Date(dueTime).toISOString().slice(0, 10) !== input.due) errors.push("Enter a valid due date.");
  const validFile = (f) => {
    if (!f || !["application/pdf", "image/png", "image/jpeg"].includes(f.type) || !Number.isInteger(f.bytes) || f.bytes < 0 || f.bytes > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data || "")) return false;
    const data = Buffer.from(f.data, "base64");
    if (data.length !== f.bytes) return false;
    return f.type === "application/pdf" ? data.subarray(0, 5).toString() === "%PDF-" : f.type === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  };
  if (input.files && (!Array.isArray(input.files) || input.files.length > 3 || input.files.some((f) => !validFile(f)))) errors.push("Attachments must be valid PDF, PNG or JPEG files, up to 3 files and 1 MB each.");
  return errors;
}
