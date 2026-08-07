/**
 * CORS origin resolution for the indexer's REST/GraphQL server (F5).
 *
 * Previously the server sent `Access-Control-Allow-Origin: *` unconditionally.
 * `ALLOWED_ORIGINS` (comma-separated) scopes it to known origins; when the
 * request's Origin is allowed it is reflected back. Left unset, the server
 * keeps the permissive `*` default (the endpoints are read-only public data),
 * so existing deployments are unaffected.
 */
export function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  allowedOriginsEnv: string | undefined
): string | null {
  const list = (allowedOriginsEnv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length === 0 || list.includes("*")) return "*";
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return null;
}
