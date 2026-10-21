/** URL-safe base64 (RFC 4648 §5) without padding, for bytes in URLs. */
export class Base64Url {
  static encode(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Throws on characters outside the base64url alphabet. */
  static decode(text: string): Uint8Array<ArrayBuffer> {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  }
}
