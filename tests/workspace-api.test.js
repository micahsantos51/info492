import test from "node:test";
import assert from "node:assert/strict";
import { workspaceApiOrigin } from "../js/workspace-api-core.js";

test("local pages keep using their own Node server", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    const origin = hostname === "localhost" ? "http://localhost:4922" : `http://${hostname.replace(/[\[\]]/g, "")}:4922`;
    assert.equal(workspaceApiOrigin({ hostname, origin }, "https://api.example.com"), origin);
  }
});

test("published pages use only the configured HTTPS API origin", () => {
  assert.equal(
    workspaceApiOrigin({ hostname: "micahsantos51.github.io", origin: "https://micahsantos51.github.io" }, "https://info492-demo2-uzxr.onrender.com"),
    "https://info492-demo2-uzxr.onrender.com",
  );
  assert.throws(
    () => workspaceApiOrigin({ hostname: "micahsantos51.github.io", origin: "https://micahsantos51.github.io" }, ""),
    /not configured/,
  );
  assert.throws(
    () => workspaceApiOrigin({ hostname: "micahsantos51.github.io", origin: "https://micahsantos51.github.io" }, "http://api.example.com"),
    /HTTPS/,
  );
});
