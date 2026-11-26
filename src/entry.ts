// New Worker entry point (wrangler.jsonc "main"). It wraps the existing Worker without changing it:
//  - every /api/ response that is a sign-in, a failed attempt or a blocked request is written to the append-only access_logs table
//  - GET /api/security/access-log returns the records, but only for a valid signed-in session
import worker from "./index";
import { classify, record, list } from "./accesslog";
export { SecurityState } from "./security";

type Env = Parameters<typeof worker.fetch>[1];
const JSON_H = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export default {
  scheduled: worker.scheduled,
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url), p = url.pathname, m = req.method;
    if (p === "/api/security/access-log" && m === "GET") {
      // Reuse the main Worker's own session check: /api/auth/me answers 200 only for a valid session that is not locked down.
      const me = await worker.fetch(new Request(url.origin + "/api/auth/me", { headers: { Cookie: req.headers.get("Cookie") ?? "" } }), env, ctx);
      if (me.status !== 200) return me;
      const info = (await me.json().catch(() => ({}))) as { csrf?: string; held?: boolean };
      if (!info.csrf || info.held) return new Response(JSON.stringify({ error: info.held ? "maintenance" : "unauthorized" }), { status: info.held ? 503 : 401, headers: JSON_H });
      try { return new Response(JSON.stringify(await list(env, Math.min(500, Number(url.searchParams.get("limit")) || 200), Math.max(0, Number(url.searchParams.get("offset")) || 0))), { headers: JSON_H }); }
      catch (e) { console.error("access_log_read_failed", (e as Error).message); return new Response(JSON.stringify({ error: "not_ready" }), { headers: JSON_H }); } // 200 on purpose: the app treats 503 as "maintenance"
    }
    const res = await worker.fetch(req, env, ctx);
    if (p.startsWith("/api/")) {
      const copy = res.status >= 400 && (res.headers.get("Content-Type") ?? "").includes("json") ? res.clone() : null; // cloned now, read later, so the visitor's response is never delayed
      ctx.waitUntil((async () => {
        try {
          const code = copy ? (((await copy.json().catch(() => ({}))) as { error?: string }).error ?? "") : "", ev = classify(m, p, res.status, code);
          if (ev) await record(env, req, ev, res.status, p);
        } catch (e) { console.error("access_log_failed", (e as Error).message); } // logging must never break the vault
      })());
    }
    return res;
  },
};
