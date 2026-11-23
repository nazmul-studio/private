// Glass-style HTML email. Table layout + inline styles only (email clients ignore <style>/classes).
// Blur is not supported by most mail apps, so the "glass" is built from a gradient backdrop, a translucent
// gradient card, a bright top gloss and a thin light border; backdrop-filter is added where clients honour it.
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderMail(subject, text, brand = "private vault") {
  const lines = String(text).split(/\r?\n/);
  const code = /\b(?:code is|code:)\s*(\d{4,8})\b/i.exec(text)?.[1] ?? null;
  let link = null;
  const body = [];
  for (const raw of lines) {
    const m = /^(https?:\/\/\S+)$/.exec(raw.trim());
    if (m) { link ??= m[1]; continue; }
    const inl = /(https?:\/\/\S+)/.exec(raw);
    if (inl) { link ??= inl[1]; body.push(raw.replace(inl[1], "").trim()); continue; }
    body.push(raw.trim());
  }
  const paras = body.join("\n").split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  const bodyHtml = paras.map((p) => `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:#e8eefc;">${esc(p)}</p>`).join("");
  const codeHtml = code
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:6px auto 20px;"><tr><td style="padding:14px 26px;border-radius:16px;border:1px solid rgba(255,255,255,0.45);background:#ffffff;background:linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.10));font:700 34px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:10px;color:#ffffff;text-align:center;">${esc(code)}</td></tr></table>`
    : "";
  const btnHtml = link
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:8px auto 6px;"><tr><td style="border-radius:14px;background:#22d3ee;background:linear-gradient(135deg,#67e8f9,#38bdf8 55%,#818cf8);"><a href="${esc(link)}" style="display:inline-block;padding:13px 28px;font:700 14px/1 ${FONT};color:#06121f;text-decoration:none;border-radius:14px;">Open link</a></td></tr></table><p style="margin:10px 0 0;font:400 11px/1.5 ${FONT};color:#9fb0d0;text-align:center;word-break:break-all;">${esc(link)}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b1026;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0b1026" style="background:#0b1026;background:linear-gradient(135deg,#1b1464 0%,#0f3a78 45%,#0b8f9c 100%);"><tr><td align="center" style="padding:40px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding:0 0 18px;font:700 12px/1 ${FONT};letter-spacing:4px;text-transform:uppercase;color:#bfe9ff;">&#9670; ${esc(brand)}</td></tr>
<tr><td style="border-radius:28px;border:1px solid rgba(255,255,255,0.38);background:#27427f;background:linear-gradient(145deg,rgba(255,255,255,0.28) 0%,rgba(255,255,255,0.10) 38%,rgba(255,255,255,0.06) 100%);box-shadow:0 24px 60px rgba(2,8,30,0.55),inset 0 1px 0 rgba(255,255,255,0.55);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="54" style="height:54px;border-radius:28px 28px 0 0;background:linear-gradient(180deg,rgba(255,255,255,0.30),rgba(255,255,255,0));font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:0 34px 34px;">
<h1 style="margin:-22px 0 18px;font:700 22px/1.3 ${FONT};color:#ffffff;text-shadow:0 1px 12px rgba(0,0,0,0.25);">${esc(subject)}</h1>
${codeHtml}${bodyHtml}${btnHtml}
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;font:400 11px/1.6 ${FONT};color:#a9bbdc;">Sent automatically by ${esc(brand)}. If you didn&#39;t expect this, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}
