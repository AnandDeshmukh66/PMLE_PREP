"use client";

import { createContext, useContext } from "react";
import { inCert } from "@/lib/cert-rules";

export type CertInfo = {
  slug: string;
  /** URL prefix of every study page of this certification, e.g. "/c/pmle". */
  base: string;
  code: string;
  name: string;
  versionId: string | null;
  versionLabel: string | null;
  /** Domain number -> title of the published version's exam guide. */
  domains: Record<number, string>;
  /** Question sources of the published version, in display order. */
  sources: { id: string; name: string; kind: string; short: string }[];
};

const CertContext = createContext<CertInfo | null>(null);

export function CertProvider({ cert, children }: { cert: CertInfo; children: React.ReactNode }) {
  return <CertContext.Provider value={cert}>{children}</CertContext.Provider>;
}

/** The certification whose pages are being shown. Only valid below /c/[cert]. */
export function useCert(): CertInfo {
  const c = useContext(CertContext);
  if (!c) throw new Error("useCert() must be used inside a certification page.");
  return c;
}

export function useOptionalCert(): CertInfo | null {
  return useContext(CertContext);
}

export function useDomainTitle(): (n: number | null | undefined) => string {
  const domains = useOptionalCert()?.domains ?? {};
  return (n) => (n ? (domains[n] ?? `Domain ${n}`) : "Unmapped");
}

export function useSources() {
  return useOptionalCert()?.sources ?? [];
}

/** Builds links to pages of the current certification: L("/questions") -> "/c/pmle/questions". */
export function useCertHref(): (href: string) => string {
  const base = useCert().base;
  return (href: string) => inCert(base, href);
}
