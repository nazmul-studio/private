import { AwsClient } from "aws4fetch";
export type S3Env = { R2_ACCOUNT_ID: string; R2_BUCKET: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string };
const cl = (e: S3Env) => new AwsClient({ accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
const url = (e: S3Env, key: string, q: Record<string, string>) => {
  const u = new URL(`https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${e.R2_BUCKET}/${key}`);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u;
};
async function call(e: S3Env, method: string, u: URL, init: RequestInit = {}) {
  const r = await cl(e).fetch(u, { method, ...init }), t = await r.text();
  if (!r.ok || t.includes("<Error>")) throw new Error("r2_" + r.status);
  return t;
}
export async function create(e: S3Env, key: string, mime: string) {
  const id = /<UploadId>([^<]+)<\/UploadId>/.exec(await call(e, "POST", url(e, key, { uploads: "" }), { headers: { "content-type": mime } }))?.[1];
  if (!id) throw new Error("r2_no_upload_id");
  return id;
}
// Short-lived (10 min) URL that can upload exactly one part of one multipart upload.
export async function presignPart(e: S3Env, key: string, uploadId: string, n: number) {
  const u = url(e, key, { partNumber: String(n), uploadId, "X-Amz-Expires": "600" });
  return (await cl(e).sign(u, { method: "PUT", aws: { signQuery: true } })).url;
}
export async function complete(e: S3Env, key: string, uploadId: string, parts: { n: number; etag: string }[]) {
  const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  await call(e, "POST", url(e, key, { uploadId }), { body: xml, headers: { "content-type": "application/xml" } });
}
export const abort = (e: S3Env, key: string, uploadId: string) => call(e, "DELETE", url(e, key, { uploadId }));
export async function listParts(e: S3Env, key: string, uploadId: string) {
  const t = await call(e, "GET", url(e, key, { uploadId, "max-parts": "1000" }));
  return [...t.matchAll(/<Part>(.*?)<\/Part>/gs)].map((m) => ({ n: Number(/<PartNumber>(\d+)</.exec(m[1])?.[1]), etag: (/<ETag>([^<]+)</.exec(m[1])?.[1] ?? "").replace(/&quot;/g, '"'), size: Number(/<Size>(\d+)</.exec(m[1])?.[1]) }));
}
