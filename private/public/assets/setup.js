const $ = (id) => document.getElementById(id), err = $("err");
$("f").addEventListener("submit", async (e) => {
  e.preventDefault(); err.hidden = true;
  const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json", "x-setup-token": $("tk").value }, body: JSON.stringify({ password: $("pw").value, secret: $("sc").value }) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (r && r.ok) location.href = "/"; else { err.textContent = d.message || "Setup failed. Try again."; err.hidden = false; }
});
