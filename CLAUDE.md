# Guidelines

- Pull requests should use conventional commit titles (e.g. `feat:`, `fix:`, `docs:`).
- Do not include issue numbers in code comments.
- Avoid monolithic files. Give each domain its own subfolder (e.g.
  `apps/web/src/persistence/`) with one class or concern per file and an
  `index.ts` barrel. Keep data types and stores separate from I/O helpers (file,
  URL, network), and don't collect unrelated utility functions in one file.
  Co-locate tests per module (`foo.ts` → `foo.test.ts`).
