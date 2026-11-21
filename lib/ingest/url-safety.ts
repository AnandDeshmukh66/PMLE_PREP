import dns from "node:dns/promises";
import net from "node:net";
import { IngestError } from "./types";

const privateHostsAllowed = () => process.env.INGEST_ALLOW_PRIVATE_HOSTS === "1" && process.env.NODE_ENV !== "production";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** Parses and checks a user-submitted URL (shape only; no network). */
export function parsePublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new IngestError("UNSAFE_URL", "That is not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new IngestError("UNSAFE_URL", "Only http and https URLs are allowed.");
  if (u.username || u.password) throw new IngestError("UNSAFE_URL", "URLs with embedded credentials are not allowed.");
  if (u.port && !["80", "443"].includes(u.port) && !privateHostsAllowed()) throw new IngestError("UNSAFE_URL", "Only the standard web ports are allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!privateHostsAllowed() && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || (net.isIP(host) && isPrivateIp(host)))) {
    throw new IngestError("UNSAFE_URL", "Private, local and internal addresses are not allowed.");
  }
  if (raw.length > 2_000) throw new IngestError("UNSAFE_URL", "The URL is too long.");
  u.hash = "";
  return u;
}

/** Resolves the host and refuses private addresses, so a public name cannot point the server at its own network. */
export async function assertPublicHost(u: URL): Promise<void> {
  if (privateHostsAllowed()) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : await dns.lookup(host, { all: true }).then((r) => r.map((a) => a.address), () => {
    throw new IngestError("NETWORK", `The host ${host} could not be resolved.`);
  });
  if (!addrs.length || addrs.some(isPrivateIp)) throw new IngestError("UNSAFE_URL", "The URL resolves to a private or internal address.");
}
