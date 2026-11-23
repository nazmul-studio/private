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
  const bodyHtml = paras.map((p) => `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:#1e293b;">${esc(p)}</p>`).join("");
  const codeHtml = code
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:6px auto 20px;"><tr><td style="padding:14px 26px;border-radius:16px;border:1px solid rgba(255,255,255,0.9);background:#ffffff;background:linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,255,255,0.6));box-shadow:0 8px 24px rgba(79,70,229,0.18);font:700 34px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:10px;color:#312e81;text-align:center;">${esc(code)}</td></tr></table>`
    : "";
  const btnHtml = link
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:8px auto 6px;"><tr><td style="border-radius:14px;background:#4f46e5;background:linear-gradient(135deg,#06b6d4,#4f46e5 60%,#7c3aed);box-shadow:0 8px 20px rgba(79,70,229,0.35);"><a href="${esc(link)}" style="display:inline-block;padding:13px 28px;font:700 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:14px;">Open secure link</a></td></tr></table>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#c7d2fe;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#c7d2fe" style="background:#c7d2fe;background:linear-gradient(135deg,#a5f3fc 0%,#c4b5fd 52%,#fbcfe8 100%);"><tr><td align="center" style="padding:40px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding:0 0 18px;font:700 12px/1 ${FONT};letter-spacing:4px;text-transform:uppercase;color:#3730a3;">&#9670; ${esc(brand)}</td></tr>
<tr><td style="border-radius:28px;border:1px solid rgba(255,255,255,0.95);background:#f4f3ff;background:linear-gradient(145deg,rgba(255,255,255,0.88) 0%,rgba(255,255,255,0.68) 45%,rgba(255,255,255,0.55) 100%);box-shadow:0 24px 60px rgba(79,70,229,0.25),inset 0 1px 0 #ffffff;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="54" style="height:54px;border-radius:28px 28px 0 0;background:linear-gradient(180deg,rgba(255,255,255,0.85),rgba(255,255,255,0));font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:0 34px 34px;">
<h1 style="margin:-22px 0 18px;font:700 22px/1.3 ${FONT};color:#0f172a;">${esc(subject)}</h1>
${codeHtml}${bodyHtml}${btnHtml}
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;font:400 11px/1.6 ${FONT};color:#475569;">Sent automatically by ${esc(brand)}. If you didn&#39;t expect this, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}
