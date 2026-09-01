# Automata Playground

A web app for authoring NFAs from a compact DSL, with live validation and an
interactive diagram.

## Layout

```
apps/
  web/        Vite + React + CodeMirror (editor) + Cytoscape (diagram)
  server/     Hono API — re-validates via nfa-lang before persisting
packages/
  nfa-lang/   shared TS parser + expander (no DOM, no Node APIs) — grammar TBD
```

Both `web` and `server` import `@automata/nfa-lang`, so the grammar is written
once and used on both sides (no client/server drift).

## Develop

```bash
task setup     # verifies Node matches .nvmrc, then npm install
task up        # runs the full dev stack (Vite :5173 + API :3999) via npm run dev
```

- web: http://localhost:5173 (Vite, HMR)
- server: http://localhost:3999 (Hono)

Node is pinned via [.nvmrc](.nvmrc) + `engines` in package.json, and
`engine-strict` in [.npmrc](.npmrc) makes `npm install` fail on a mismatch.
`task node:check` verifies the running version on demand.

In dev, Vite proxies `/api/*` to the server, so the browser only talks to
`:5173`. In prod, `npm run build` emits `apps/web/dist`, which the server
serves alongside the API (see the TODO in `apps/server/src/index.ts`).

## Server task runner

Manage the API server (with orphaned-process safeguards) via
[go-task](https://taskfile.dev):

```bash
task server:up       # start (background); cleans orphans + checks port first
task server:status   # is the port bound, and by what
task server:down     # stop + sweep orphaned tsx procs + free the port
task server:restart
```

## Deployment (Cloudflare Pages)

Deploys as its **own Cloudflare Pages project** on its **own subdomain** (e.g.
`automata.example.com`), routed at the DNS level. Implications:

- Served at the **root** of its subdomain → Vite `base` stays `/` (no subpath
  asset rewrites).
- `/api/*` is **same-origin**, so no CORS. In prod the Hono routes run as
  **Cloudflare Pages Functions** (via `hono/cloudflare-pages`), *not* the Node
  server — `@hono/node-server` is dev-only. Same app + shared `nfa-lang`,
  different entry adapter.
- Local dev is unchanged: Vite (`:5173`) proxies `/api` → local Hono (`:3999`).

### Backend: deferred (client-only v1 recommended)

`nfa-lang` runs identically in the browser, so v1 needs **no server**: parse,
validate, expand, and render entirely client-side; persist via localStorage +
text-file import/export (a `.nfa` file *is* the shareable creation). Add Pages
Functions (Hono) + Cloudflare KV/D1/R2 later for server-side re-validation and
hosted saves — the shared-package design makes that a bolt-on, not a rewrite.
Until then `apps/server` is a dev-only convenience.

## Writing Grammars

See [docs/GRAMMAR.md](docs/GRAMMAR.md) for the full language spec. The arithmetic
expressions used in range bounds (`n+1..m`), instantiation args, `let` right-hand
sides, and comprehension guards are parsed by a precedence-climbing (Pratt)
sub-parser.

### Precedence

From lowest to highest binding power:

```
or  <  and  <  not  <  comparison / in  <  + -  <  * %  <  unary -  <  primary
```

where `comparison` is `< <= > >= == !=`, and `primary` is a number, a variable,
`class(...)`, or a parenthesized expression.

All binary operators are **left-associative** — `1 - 2 - 3` parses as `(1 - 2) - 3`,
and `a and b and c` as `(a and b) and c`. Use parentheses to override precedence
or grouping (`(1 + 2) * 3`).

## Status

Scaffold only. `nfa-lang` is a shell — see [docs/GRAMMAR.md](docs/GRAMMAR.md)
for the language spec to implement.

## Roadmap

**Language core (prerequisite for everything).** Implement the `nfa-lang` parser
+ expander per [docs/GRAMMAR.md](docs/GRAMMAR.md). The client and server both
already call `validateProgram`, so this lights up the whole app.

**Backend — promote the API to Cloudflare Pages Functions.** Deferred; add when
client-only v1 (localStorage + `.nfa` export) outgrows its limits — i.e. you want
accounts, hosted saves, or share-by-link:

- **Functions entry.** Add `functions/api/[[route]].ts` mounting the Hono app via
  the `hono/cloudflare-pages` adapter. Same app + shared `nfa-lang` as
  `apps/server`; only the entry adapter differs.
- **Prod-parity dev.** Run Functions on the real Workers runtime with
  `wrangler pages dev` (Miniflare/workerd) — the accuracy `task up`'s Node server
  can't provide. Evaluate `@cloudflare/vite-plugin` to get Vite HMR + the Workers
  runtime in one dev server (potentially replacing the Node server).
- **Persistence.** Store validated DSL source in Cloudflare KV / D1 / R2 (via
  `env` bindings). Build out `/api/graphs` CRUD — persist raw text once
  `validateProgram().ok`.
- **Trust boundary.** Always re-validate submitted programs server-side with the
  shared parser before persisting, enforcing the `LIMITS` expansion ceilings.
- `apps/server` (`@hono/node-server`) stays a dev convenience; `wrangler pages
  dev` becomes the prod-truth check.

**Sharing.** A `.nfa` text file *is* a portable creation (works client-only once
the parser lands); upgrade to share-by-link once hosted saves exist.
