// Shared by the Worker and the browser. Single source of truth for upload rules.
export const LIMITS = { image: 52428800, video: 367001600 }; // 50 MB / 350 MB
export const PART = 16 * 1024 * 1024; // R2 multipart: every part except the last must be >= 5 MiB
const IMG = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "pdf"]), VID = new Set(["mp4", "mov"]);
export const ext = (n) => (String(n).split(".").pop() || "").toLowerCase();
export const categoryOfName = (n) => (IMG.has(ext(n)) ? "image" : VID.has(ext(n)) ? "video" : null);
export const sizeMessage = (name, size, cat) => `${name} is ${(size / 1048576).toFixed(1)} MB. ${cat === "video" ? "Videos" : "Images"} can be up to ${LIMITS[cat] / 1048576} MB.`;
export const planParts = (size) => Array.from({ length: Math.ceil(size / PART) }, (_, i) => ({ n: i + 1, start: i * PART, end: Math.min(size, (i + 1) * PART) }));
// Keep only parts R2 reports that are fully uploaded at the planned size (used when resuming).
export const validParts = (listed, size) => { const plan = planParts(size); return listed.filter((p) => plan[p.n - 1] && p.size === plan[p.n - 1].end - plan[p.n - 1].start); };
// File/collection name sanitiser shared by Worker and browser. Keeps letters/digits of any script (e.g. Bangla); everything else becomes "_".
export const cleanName = (s) => String(s).replace(/[^\p{L}\p{M}\p{N}_.\- ]/gu, "_").slice(0, 120);
