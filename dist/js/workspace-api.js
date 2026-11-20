import { workspaceApiOrigin } from "./workspace-api-core.js?v=20261120-api";

let apiOriginPromise;
async function apiOrigin() {
  if (!apiOriginPromise) {
    apiOriginPromise = (async () => {
      const here = { hostname: location.hostname, origin: location.origin };
      if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(here.hostname)) {
        return workspaceApiOrigin(here, "");
      }
      const configUrl = new URL("../data/workspace-config.json", import.meta.url);
      const response = await fetch(configUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("The published account API settings could not be loaded.");
      const config = await response.json();
      return workspaceApiOrigin(here, config.backend_origin);
    })();
  }
  return apiOriginPromise;
}

export async function workspaceApiUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Invalid account API path.");
  return `${await apiOrigin()}/api/workspace${path}`;
}

export async function workspaceFetch(path, options = {}) {
  return fetch(await workspaceApiUrl(path), options);
}
