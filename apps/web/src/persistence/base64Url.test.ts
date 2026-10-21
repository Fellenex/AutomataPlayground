import { describe, expect, it } from "vitest";
import { Base64Url } from "./base64Url";

describe("Base64Url", () => {
  it("round-trips bytes using the URL-safe alphabet without padding", () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x01]);
    const text = Base64Url.encode(bytes);
    expect(text).toBe("-_-_AAE");
    expect(Base64Url.decode(text)).toEqual(bytes);
  });

  it("throws on characters outside the alphabet", () => {
    expect(() => Base64Url.decode("!!!")).toThrow();
  });
});
