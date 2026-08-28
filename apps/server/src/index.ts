import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { validateProgram } from "@automata/nfa-lang";

const app = new Hono();

// Friendly root so hitting the API port directly isn't a bare 404.
// (The UI is served by Vite on :5173 in dev, not here.)
app.get("/", (c) =>
  c.json({
    service: "automata-playground-api",
    ui: "http://localhost:5173",
    endpoints: ["/api/health", "/api/validate"],
  }),
);

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "automata-playground" }),
);

// Re-validate a submitted program with the SAME parser the client uses before
// persisting. Currently returns nfa-lang's not-implemented stub result.
app.post("/api/validate", async (c) => {
  const body = await c.req.json<{ source?: string }>();
  return c.json(validateProgram(body.source ?? ""));
});

// TODO: /api/graphs CRUD — persist raw DSL text once validateProgram().ok.
// TODO (prod): serve apps/web/dist statically so this is a single deployable:
//   import { serveStatic } from "@hono/node-server/serve-static";
//   if (process.env.NODE_ENV === "production")
//     app.use("/*", serveStatic({ root: "../../apps/web/dist" }));

const port = Number(process.env.PORT ?? 3999);
serve({ fetch: app.fetch, port });
console.log(`server listening on http://localhost:${port}`);
