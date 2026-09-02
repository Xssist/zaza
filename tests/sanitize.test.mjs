import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "js", "app.js"), "utf8");

/** Extract a named function's source from app.js and evaluate it in a sandbox. */
function loadFn(name, sandboxExtras = {}) {
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n}`, "m");
  const match = source.match(re);
  if (!match) throw new Error(`Could not extract ${name} from app.js`);
  const sandbox = {
    URL,
    window: { location: { href: "https://zade.example.com/page" } },
    ...sandboxExtras,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(match[0], ctx);
  return ctx[name];
}

const normalizeAssetPath = () => loadFn("normalizeAssetPath");
const safeExternalUrl = () => loadFn("safeExternalUrl");
const safeIconClass = () => loadFn("safeIconClass");

describe("normalizeAssetPath", () => {
  it("returns empty for falsy / non-string input", () => {
    const fn = normalizeAssetPath();
    expect(fn("")).toBe("");
    expect(fn(null)).toBe("");
    expect(fn(undefined)).toBe("");
    expect(fn(123)).toBe("");
  });

  it("allows https:// URLs", () => {
    const fn = normalizeAssetPath();
    expect(fn("https://cdn.discordapp.com/attachments/x.png")).toBe(
      "https://cdn.discordapp.com/attachments/x.png",
    );
  });

  it("rejects javascript:, file:, data:, blob: and http: schemes", () => {
    const fn = normalizeAssetPath();
    for (const bad of [
      "javascript:alert(1)",
      "file:///C:/Windows/system32/config.sys",
      "data:text/html,<script>",
      "blob:https://example.com/uuid",
      "http://insecure.example.com/x.png",
    ]) {
      expect(fn(bad)).toBe("");
    }
  });

  it("extracts web-relative assets/ paths from local Windows paths", () => {
    const fn = normalizeAssetPath();
    expect(
      fn("C:\\Users\\PC\\Documents\\zaza\\assets\\images\\avatar.png"),
    ).toBe("assets/images/avatar.png");
    expect(fn("/assets/images/avatar.png")).toBe("assets/images/avatar.png");
    expect(fn("assets/images/avatar.png?v=2")).toBe(
      "assets/images/avatar.png?v=2",
    );
  });

  it("passes long strings through without crashing (length is capped upstream in _validateConfig)", () => {
    const fn = normalizeAssetPath();
    expect(fn("a".repeat(3000))).toBe("a".repeat(3000));
  });
});

describe("safeExternalUrl", () => {
  it("allows http(s) URLs and resolves relative ones", () => {
    const fn = safeExternalUrl();
    expect(fn("https://github.com/zade")).toBe("https://github.com/zade");
    expect(fn("http://example.com")).toBe("http://example.com/");
    expect(fn("/about")).toBe("https://zade.example.com/about");
  });

  it("rejects javascript:, data:, file: and other schemes", () => {
    const fn = safeExternalUrl();
    for (const bad of [
      "javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(fn(bad)).toBe("");
    }
  });

  it("returns empty for non-strings and whitespace", () => {
    const fn = safeExternalUrl();
    expect(fn(null)).toBe("");
    expect(fn("   ")).toBe("");
    expect(fn({})).toBe("");
  });
});

describe("safeIconClass", () => {
  it("accepts valid FontAwesome class patterns", () => {
    const fn = safeIconClass();
    expect(fn("fas fa-code")).toBe("fas fa-code");
    expect(fn("fab fa-github")).toBe("fab fa-github");
    expect(fn("far fa-heart")).toBe("far fa-heart");
  });

  it("rejects arbitrary class injection", () => {
    const fn = safeIconClass();
    expect(fn("alert(1)")).toBe("");
    expect(fn('fas fa-code"><script>')).toBe("");
    expect(fn("my-own-class")).toBe("");
    expect(fn("fas")).toBe("");
  });

  it("returns the fallback for non-strings", () => {
    const fn = safeIconClass();
    expect(fn(null, "fas fa-link")).toBe("fas fa-link");
    expect(fn(42, "fas fa-link")).toBe("fas fa-link");
    expect(fn(undefined)).toBe("");
  });
});
