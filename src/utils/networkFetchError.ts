// A fetch that dies at the network layer (dropped VPN path, cellular handoff,
// server unreachable) rejects with a TypeError whose message is a terse
// browser-specific string: "Load failed" (Safari), "Failed to fetch" (Chrome),
// "NetworkError when attempting to fetch resource." (Firefox). Shown raw,
// these read like an app bug rather than a connectivity problem. Matching the
// known messages — not every TypeError — keeps a genuine programming error's
// message visible instead of mislabeling it as a connection issue.
const NETWORK_FETCH_ERROR_MESSAGE = /load failed|failed to fetch|networkerror/i;

export function isNetworkFetchError(err: unknown): boolean {
  return err instanceof TypeError && NETWORK_FETCH_ERROR_MESSAGE.test(err.message);
}
