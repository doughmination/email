import { migrate, type MigrateEnv } from "./migrate";

// GET /         dry run: reports what would be copied, writes nothing
// GET /?apply=1 copies it
export default {
  async fetch(request: Request, env: MigrateEnv): Promise<Response> {
    const apply = new URL(request.url).searchParams.get("apply") === "1";
    return Response.json(await migrate(env, { apply }), { headers: { "Cache-Control": "no-store" } });
  },
};
