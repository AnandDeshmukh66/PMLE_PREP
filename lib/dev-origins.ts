import os from "node:os";

/**
 * Hosts `next dev` may serve its scripts and live-reload socket to, besides localhost. Without this,
 * opening the dev server via the machine's network address (the "Network:" URL it prints) renders
 * pages that never hydrate: everything is visible but no button responds.
 */
export function devOrigins(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(), hostname = os.hostname(), extra = process.env.DEV_ALLOWED_ORIGINS): string[] {
  const own = Object.values(interfaces)
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && !i.internal && i.family === "IPv4")
    .map((i) => i.address);
  const host = hostname.toLowerCase().replace(/\.local$/, "");
  const names = host ? [host, `${host}.local`] : [];
  const configured = (extra ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...own, ...names, ...configured])];
}
