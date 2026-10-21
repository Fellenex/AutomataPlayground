// Client-only persistence for DSL source: no backend involved.
//
// - Data: `Creation` records, kept by `CreationStore` in browser storage.
// - Files: `CreationFile` imports/exports plain-text `.txt` files.
// - Links: `ShareLink` encodes source into the URL hash.

export type { Creation } from "./creation";
export { CreationStore } from "./creationStore";
export { MemoryStorage, browserStorage } from "./storage";
export type { StorageLike } from "./storage";
export { CreationFile } from "./creationFile";
export type { FileContents } from "./creationFile";
export { ShareLink } from "./shareLink";
