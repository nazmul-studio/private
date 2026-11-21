// Shared by the Worker and the browser. Single source of truth for upload rules.
export const LIMITS = { image: 52428800, video: 367001600, file: 52428800 }; // 50 MB images/PDF, 350 MB video, 50 MB archives & documents
export const PART = 16 * 1024 * 1024; // R2 multipart: every part except the last must be >= 5 MiB
const IMG = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "pdf"]), VID = new Set(["mp4", "mov"]);
export const ext = (n) => (String(n).split(".").pop() || "").toLowerCase();
// Archives and documents. Stored with these fixed types and always served as downloads, never rendered in the browser.
export const FILE_MIME = { zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed", tar: "application/x-tar", gz: "application/gzip", bz2: "application/x-bzip2", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", rtf: "application/rtf", odt: "application/vnd.oasis.opendocument.text", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", json: "application/json", md: "text/markdown" };
export const categoryOfName = (n) => (IMG.has(ext(n)) ? "image" : VID.has(ext(n)) ? "video" : Object.hasOwn(FILE_MIME, ext(n)) ? "file" : null);
// Content check for archives/documents: the bytes must match the extension (first 512 bytes are enough).
export function sniffFile(name, b) {
  const e = ext(name), str = (o, t) => [...t].every((c, i) => b[o + i] === c.charCodeAt(0)), eq = (o, a) => a.every((v, i) => b[o + i] === v);
  if (["zip", "docx", "xlsx", "odt"].includes(e)) return str(0, "PK") && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
  if (e === "rar") return str(0, "Rar!");
  if (e === "7z") return eq(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  if (e === "gz") return b[0] === 0x1f && b[1] === 0x8b;
  if (e === "bz2") return str(0, "BZh");
  if (e === "tar") return str(257, "ustar");
  if (e === "doc" || e === "xls") return eq(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (e === "rtf") return str(0, "{\\rtf");
  if (["txt", "csv", "json", "md"].includes(e)) {
    const h = b.slice(0, 512); if (!h.length || h.includes(0)) return false;
    if (e !== "json") return true;
    const t = new TextDecoder().decode(h).replace(/^\uFEFF/, "").trimStart(); return /^(?:[\[{"\-0-9]|true\b|false\b|null\b)/.test(t);
  }
  return false;
}
export const sizeMessage = (name, size, cat) => `${name} is ${(size / 1048576).toFixed(1)} MB. ${cat === "video" ? "Videos" : cat === "file" ? "Files" : "Images"} can be up to ${LIMITS[cat] / 1048576} MB.`;
export const planParts = (size) => Array.from({ length: Math.ceil(size / PART) }, (_, i) => ({ n: i + 1, start: i * PART, end: Math.min(size, (i + 1) * PART) }));
// Keep only parts R2 reports that are fully uploaded at the planned size (used when resuming).
export const validParts = (listed, size) => { const plan = planParts(size); return listed.filter((p) => plan[p.n - 1] && p.size === plan[p.n - 1].end - plan[p.n - 1].start); };
// File/collection name sanitiser shared by Worker and browser. Keeps letters/digits of any script (e.g. Bangla); everything else becomes "_".
export const cleanName = (s) => String(s).replace(/[^\p{L}\p{M}\p{N}_.\- ]/gu, "_").slice(0, 120);
