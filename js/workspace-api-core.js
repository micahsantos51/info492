const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function workspaceApiOrigin({ hostname, origin }, configuredOrigin) {
  if (localHosts.has(hostname)) return origin;
  let configured;
  try {
    configured = new URL(configuredOrigin);
  } catch {
    throw new Error("The published account API is not configured.");
  }
  if (configured.protocol !== "https:" || configured.origin !== configuredOrigin) {
    throw new Error("The published account API must use a secure HTTPS origin.");
  }
  return configured.origin;
}
