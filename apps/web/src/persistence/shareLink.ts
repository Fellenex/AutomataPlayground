import { Base64Url } from "./base64Url";

/**
 * Share links carry DSL source in the URL hash (`#fsm=...`), deflate-compressed
 * and base64url-encoded, so a link works without any server round-trip.
 */
export class ShareLink {
  static readonly HASH_PREFIX = "#fsm=";

  /** Encode DSL source as a URL hash fragment. */
  static async encode(source: string): Promise<string> {
    const compressed = await ShareLink.pipe(
      new TextEncoder().encode(source),
      new CompressionStream("deflate-raw"),
    );
    return ShareLink.HASH_PREFIX + Base64Url.encode(compressed);
  }

  /**
   * Decode DSL source from a URL hash fragment. Returns `null` when the hash is
   * not a share link or its payload is malformed.
   */
  static async decode(hash: string): Promise<string | null> {
    if (!hash.startsWith(ShareLink.HASH_PREFIX)) return null;
    try {
      const bytes = await ShareLink.pipe(
        Base64Url.decode(hash.slice(ShareLink.HASH_PREFIX.length)),
        new DecompressionStream("deflate-raw"),
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  /** Run `bytes` through a (de)compression stream. */
  private static async pipe(
    bytes: Uint8Array<ArrayBuffer>,
    stream: CompressionStream | DecompressionStream,
  ): Promise<Uint8Array> {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
}
