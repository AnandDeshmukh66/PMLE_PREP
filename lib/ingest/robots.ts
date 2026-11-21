/** robots.txt evaluation following RFC 9309 (longest match wins; Allow wins ties; `*` and `$` wildcards). */

export const USER_AGENT_TOKEN = "CertPrepIngest";
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+self-hosted certification study tool; respects robots.txt)`;

type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };

export function parseRobots(txt: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], crawlDelay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (key === "disallow" && value === "") continue;
      cur.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.crawlDelay = n;
    }
  }
  return groups;
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

export type RobotsVerdict = { allowed: boolean; crawlDelayMs: number; rule: string | null };

export function evaluateRobots(txt: string, url: URL, agent = USER_AGENT_TOKEN): RobotsVerdict {
  const groups = parseRobots(txt);
  const ua = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // keep the encoded form
  }
  const path = pathname + url.search;
  let best: Rule | null = null;
  for (const r of rules) {
    if (!ruleMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  const delay = Math.max(0, ...applicable.map((g) => g.crawlDelay ?? 0));
  return { allowed: !best || best.allow, crawlDelayMs: Math.min(delay, 30) * 1000, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : null };
}
