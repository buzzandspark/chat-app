import { describe, expect, it } from "vitest";
import { decodeEntities } from "./entities";

describe("decodeEntities", () => {
  it("decodes the named references in its table and leaves unknown names as typed", () => {
    expect(decodeEntities("AT&amp;T &copy; &mdash; a&nbsp;b &lt;tag&gt;")).toBe("AT&T © — a b <tag>");
    expect(decodeEntities("&bogus; &constructor; &toString; &AMP")).toBe("&bogus; &constructor; &toString; &AMP");
  });

  it("decodes decimal and hex references, and invalid code points to U+FFFD", () => {
    expect(decodeEntities("&#169; &#xA9; &#XA9; &#128512;")).toBe("© © © 😀");
    expect(decodeEntities("&#0; &#xD800; &#x110000; &#9999999;")).toBe("� � � �");
    // Too many digits is not a reference at all.
    expect(decodeEntities("&#12345678; &#x1234567;")).toBe("&#12345678; &#x1234567;");
  });

  it("decodes once, so an escaped reference shows as typed", () => {
    expect(decodeEntities("&amp;lt; &amp;amp; &#38;copy;")).toBe("&lt; &amp; &copy;");
  });

  it("leaves a bare ampersand alone", () => {
    expect(decodeEntities("a & b && c &; &#; &#x;")).toBe("a & b && c &; &#; &#x;");
  });
});
