import { DurableObject } from "cloudflare:workers";
import { apply, view, fresh, hit } from "./policy.js";
// "owner" instance holds lockout state; "rl:<kind>:<ip>" instances hold rate-limit windows. Single-threaded = atomic.
export class SecurityState extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url), op = u.pathname.slice(1), now = Date.now();
    if (op === "hit") {
      const r = hit(await this.ctx.storage.get<number[]>("w"), now, Number(u.searchParams.get("limit")), Number(u.searchParams.get("win")));
      await this.ctx.storage.put("w", r.w);
      return Response.json({ ok: r.ok });
    }
    const s = apply((await this.ctx.storage.get<ReturnType<typeof fresh>>("s")) ?? fresh(), op, now);
    await this.ctx.storage.put("s", s);
    return Response.json(view(s, now));
  }
}
