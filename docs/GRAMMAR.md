# NFA DSL — language spec

The DSL describes labeled transition systems (NFAs): nodes with typed
classifications and labeled directed edges, optionally parameterized over a
finite node count.

## Core model

- An **edge** is a triple `(src, label, tgt)`.
- Any position may be a **single element**, a **set** `{…}`, or a **range**
  `a..b`. A triple expands to the **cartesian product** `S × L × T`.
- A singleton is a 1-element set, so there is exactly one expansion rule.

```
({1,2}, a, {3,4})   → (1,a,3),(1,a,4),(2,a,3),(2,a,4)   # product over endpoints
(1, {a,b}, 2)       → (1,a,2),(1,b,2)                    # parallel edges / multi-label
(1, a, 1..5)        → (1,a,1) … (1,a,5)
```

Triple interior is whitespace-insensitive: `(i,a,j)` == `(i, a, j)`.

## Alphabets (declared, validated — strict)

Declared at the head of a graph. Two separate namespaces; identical spellings in
each never collide.

- `symbols { … }` — the **edge** alphabet. **Ordered**: label ranges (`a..c`)
  use *declaration order*, not ASCII.
- `nodeTypes [ … ]` — the **node** classification alphabet. Optional.

Every edge label and every node classification used must be a member of its
alphabet, else a parse error. Duplicate declaration → warning.

## Nodes

```
nodes [u] 1..n        # classify nodes 1..n as u
nodes [u,v] 1..n      # multiple classifications (no ranges in the [ ] list)
```

Two modes, determined solely by whether `nodeTypes` is declared:

| | Untyped mode | Typed mode |
|---|---|---|
| `nodeTypes` | omitted (≡ empty) | declared, non-empty |
| node decls | bare only: `nodes 1..n` | every decl bracketed with ≥1 type |
| `nodes [u] …` | error (`u` ∉ ∅) | valid iff `u ∈ nodeTypes` |
| label-less `nodes 1..n` | required | error (incl. empty `[]`) |

Classifications **merge** across declarations for overlapping ranges. Redundant
re-adds → warning.

## Parametric graphs

```
graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)
```

- `let x = expr` binds locals; a `let` **overrides** a parameter of the same
  name (dead-param → warning).
- Every free variable in a body must be bound by a param, `let`, or `for`
  binding, else error (catches an unbound `m`).

## Program output

A definition is only a template. The expanded graph is the **union of every
top-level instantiation** — a bare `G` (no parentheses) is a zero-argument
instantiation. Instantiations share one node-id space, so classifications merge
and identical edges dedup across them. A program with definitions but no
instantiation expands to the empty graph (with a warning).

## Comprehensions

```
(i, a, j)  for i in 1..n, j in 1..n if j > i
```

Inline sets/ranges give *unguarded* products; `for … if` gives *guarded* ones.
Guards may read classifications via set membership (node may have several):

```
if u in class(i) and e in class(j)
```

## Expressions

The arithmetic expressions used in range bounds (`n+1..m`), instantiation args,
`let` right-hand sides, and comprehension guards are parsed by a
precedence-climbing (Pratt) sub-parser.

### Precedence

From lowest to highest binding power:

```
or  <  and  <  not  <  comparison / in  <  + -  <  * %  <  unary -  <  primary
```

where `comparison` is `< <= > >= == !=`, and `primary` is a number, a variable,
`class(...)`, or a parenthesized expression.

### Associativity

All binary operators are **left-associative** — `1 - 2 - 3` parses as
`(1 - 2) - 3`, and `a and b and c` as `(a and b) and c`. Use parentheses to
override precedence or grouping (`(1 + 2) * 3`).

## Static semantics (parser contract)

1. Expand `(S, L, T)` to the product of `(src, label, tgt)` triples.
2. **Dedup** edges on `(src, label, tgt)`; **merge** node classifications.
   Redundant duplicates → hygiene warning.
3. All free variables bound, else error.
4. **Strict declared-before-use**: every edge endpoint must fall in some `nodes`
   declaration.
5. Two alphabets, validated, never collide.
6. Enforce expansion **limits** (source length, node/edge counts) — see
   `LIMITS` in `src/index.ts`.

## Rendering note (not the model)

The model is a multigraph, but the diagram **collapses co-terminal triples**:
group by `(src, tgt)`, join labels in alphabet order → one arc labeled `a,b`.
Self-loops (`src == tgt`) are kept and drawn as loops.

## Implementation approach

Hand-written recursive-descent parser for structure + a precedence-climbing
(Pratt) sub-parser for arithmetic expressions (`n+1`, `2*m`, `%`).
