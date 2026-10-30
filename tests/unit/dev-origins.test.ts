import type os from "node:os";
import { describe, expect, it } from "vitest";
import { devOrigins } from "@/lib/dev-origins";

const nic = (address: string, family: "IPv4" | "IPv6", internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;

describe("allowed dev origins (pages opened via the network address must hydrate under next dev)", () => {
  it("allows the machine's own external IPv4 addresses and host names", () => {
    const origins = devOrigins({ lo0: [nic("127.0.0.1", "IPv4", true)], en0: [nic("10.3.2.55", "IPv4"), nic("fe80::1", "IPv6")], en5: [nic("192.168.1.6", "IPv4")] }, "Anands-MacBook-Air.local", "");
    expect(origins).toEqual(["10.3.2.55", "192.168.1.6", "anands-macbook-air", "anands-macbook-air.local"]);
  });

  it("adds extra hosts from DEV_ALLOWED_ORIGINS and never allows everything", () => {
    const origins = devOrigins({}, "box", " dev.example.test , ,Other.Host ");
    expect(origins).toEqual(["box", "box.local", "dev.example.test", "other.host"]);
    expect(origins).not.toContain("*");
  });
});
