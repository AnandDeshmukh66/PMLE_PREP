const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /^(?:p|div|section|article|header|footer|main|aside|li|ul|ol|tr|table|h[1-6]|br|hr|dt|dd|dl|blockquote|pre|form|fieldset|label|option|figure|figcaption|summary|details|nav)$/i;

/** Visible text of an HTML document with one line per block element. Scripts, styles and templates are dropped. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const withBreaks = body.replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (_m, tag: string) => (BLOCK.test(tag) ? "\n" : " "));
  return decodeEntities(withBreaks)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) : null;
}

export type PageSignals = { challenge: boolean; loginWall: boolean; paywall: boolean; needsJs: boolean; textLength: number };

/**
 * Signals that decide the next step. A challenge (CAPTCHA / bot check), login wall or paywall stops extraction:
 * it is never bypassed. `needsJs` suggests the content is rendered client-side and a browser render may help.
 */
export function pageSignals(html: string, text = htmlToText(html)): PageSignals {
  const lower = html.toLowerCase();
  const t = text.toLowerCase();
  const challenge =
    /\b(?:g-recaptcha|h-captcha|hcaptcha|cf-challenge|cf_chl_|turnstile|captcha-delivery|px-captcha|arkose)\b/.test(lower) ||
    /(?:verify (?:that )?you are (?:a )?human|are you a robot|checking your browser|unusual traffic from your computer|complete the security check)/.test(t);
  const passwordForm = /<input[^>]+type=["']?password/i.test(html);
  const loginWall = (passwordForm && text.length < 4_000) || /(?:sign in|log in|login) (?:to continue|to view|required)|you must be (?:logged|signed) in/.test(t);
  const paywall = /(?:subscribe to (?:continue|read|unlock)|this content is for (?:premium|paid) (?:members|subscribers)|purchase (?:access|to unlock)|unlock (?:all|full) (?:questions|access))/.test(t);
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const needsJs = text.length < 400 && (scripts > 0 || /id=["'](?:root|app|__next|__nuxt)["']\s*>\s*<\/div>/i.test(html) || /enable javascript|requires javascript/.test(t));
  return { challenge, loginWall, paywall, needsJs, textLength: text.length };
}
