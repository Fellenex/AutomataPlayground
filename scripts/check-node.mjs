// Verify the running Node version matches .nvmrc (major version).
// Shell-agnostic: `node scripts/check-node.mjs` behaves the same from git bash,
// WSL, PowerShell, or cmd.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const want = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
const have = process.versions.node;

if (want.split(".")[0] !== have.split(".")[0]) {
  console.error(
    `node:check - Node major mismatch: want ${want} (.nvmrc), have v${have}. Run 'nvm use'.`,
  );
  process.exit(1);
}
console.log(`node:check - OK (want ${want}, have v${have})`);
