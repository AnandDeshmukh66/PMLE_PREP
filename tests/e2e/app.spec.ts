import fs from "node:fs";
import os from "node:os";
import { type Browser, expect, type Page, test } from "@playwright/test";

const DOMAIN = "acme-corp.com";
const C = "/c/pmle";
const ADMIN = `admin@${DOMAIN}`;
const ACCESS_CODE = "e2e-access-code-123";
/** Original source identities that must never reach a learner (names, ids, keys, asset paths, hosts). */
const LEAK = /ExamPrepper|examtopics|PDF question bank|question-assets\/examprepper|pdf:\d|"source":"pdf"|\/api\/pdf/i;
let seq = 0;
const newEmail = (name: string) => `${name}-${Date.now().toString(36)}-${++seq}@${DOMAIN}`;

async function signIn(page: Page, email: string) {
  await go(page, "/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function newUser(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = newEmail(name);
  await signIn(page, email);
  return { context, page, email };
}

/** Navigates and waits until React controls the page, so clicks are not lost on a page still loading its scripts. */
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  if (!new URL(page.url()).pathname.startsWith("/api/")) await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 });
  return res;
}

const saveIndicator = (page: Page) => page.locator("aside [data-testid='save-indicator']");

async function firstCode(page: Page, path: string) {
  await go(page, path);
  const link = page.getByTestId("question-row").first().locator("a[data-testid^='open-']");
  return (await link.getAttribute("data-testid"))!.replace("open-", "");
}

async function allSaved(page: Page) {
  await expect(saveIndicator(page)).toHaveAttribute("data-state", /saved|idle/);
}

test.describe("existing study features (signed in)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, newEmail("student"));
  });

  test("Questions & Review: flags, bookmarks and review marks from All Questions sync to their lists and persist", async ({ page }) => {
    const code = await firstCode(page, `${C}/questions`);
    for (const [kind, list, toggle] of [
      ["flag", "/flagged", "toggle-flag"],
      ["bookmark", "/bookmarks", "toggle-bookmark"],
      ["review", "/review", "toggle-review"],
    ] as const) {
      await go(page, `${C}/questions#${code}`);
      const btn = page.getByTestId(`row-${kind}-${code}`);
      await expect(btn, kind).toHaveAttribute("aria-pressed", "false");
      await btn.click();
      await expect(btn, kind).toHaveAttribute("aria-pressed", "true");
      await allSaved(page);

      await go(page, `${C}${list}`);
      await expect(page.getByTestId(`open-${code}`), list).toBeVisible();
      await page.reload();
      await expect(page.getByTestId(`open-${code}`), `${list} after reload`).toBeVisible();

      await go(page, `${C}/questions/${code}`);
      await expect(page.getByTestId(toggle), toggle).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId(toggle).click();
      await expect(page.getByTestId(toggle), toggle).toHaveAttribute("aria-pressed", "false");
      await allSaved(page);
      await go(page, `${C}${list}`);
      await expect(page.getByTestId(`open-${code}`), list).toHaveCount(0);
    }
  });

  test("Questions & Review navigation: five lists, no source views, old URLs land on All Questions", async ({ page }) => {
    await go(page, C);
    const group = page.locator("aside nav > div").filter({ hasText: "Questions & Review" });
    await expect(group.locator("li")).toHaveText(["All Questions339", "Marked for Review", "Flagged Questions", "Incorrect Questions", "Bookmarks"].map((t) => new RegExp(`^${t}`)));
    const nav = page.locator("aside nav");
    for (const gone of ["Common Questions", "PDF question bank", "ExamPrepper", "Question bank"]) await expect(nav, gone).not.toContainText(gone);
    for (const [from, to] of [
      [`${C}/common`, `${C}/questions`],
      [`${C}/sources/pdf`, `${C}/questions`],
      [`${C}/sources/examprepper?domain=2`, `${C}/questions?domain=2`],
      ["/pdf", `${C}/questions`],
      ["/examprepper", `${C}/questions`],
      ["/common", `${C}/questions`],
    ]) {
      const res = await go(page, from);
      expect(res?.status(), from).toBe(200);
      expect(new URL(page.url()).pathname + new URL(page.url()).search, from).toBe(to);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, `${C}/questions`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobile = page.getByRole("dialog");
    await expect(mobile).toContainText("Questions & Review");
    await expect(mobile).not.toContainText("Common Questions");
  });

  test("answering from an old source list link updates All questions; notes autosave and persist", async ({ page }) => {
    const code = await firstCode(page, `${C}/questions`);
    await go(page, `${C}/questions/${code}?from=pdf`);
    await expect(page.getByTestId("list-position")).toContainText("All Questions");
    await expect(page.getByTestId("feedback")).toHaveCount(0);
    await page.getByTestId("option-A").click();
    await page.getByTestId("submit-answer").click();
    await expect(page.getByTestId("feedback")).toBeVisible();
    await expect(page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("attempt-history")).toContainText("browse");

    await page.getByTestId("note-add").click();
    await page.getByTestId("note-input").fill("Vertex AI Pipelines = Kubeflow");
    await expect(page.getByTestId("note").getByTestId("field-status")).toHaveAttribute("data-state", "saved");

    await go(page, `${C}/questions`);
    const row = page.getByTestId("question-row").filter({ has: page.getByTestId(`open-${code}`) });
    await expect(row).toContainText("1 attempt");
    await go(page, `${C}/questions/${code}?from=examprepper`);
    await expect(page.getByTestId("note-input")).toHaveValue("Vertex AI Pipelines = Kubeflow");
    await expect(page.getByTestId("feedback")).toHaveCount(0);
  });

  test("mock exam survives refresh and submits with graded results", async ({ page }) => {
    await go(page, `${C}/mock`);
    await expect(page.getByTestId("allocation-table")).toBeVisible();
    await page.getByTestId("mock-count").fill("6");
    await page.getByTestId("start-mock").click();
    await expect(page.getByTestId("mock-runner")).toBeVisible();
    await expect(page.getByTestId("mock-timer")).toHaveText(/\d+:\d{2}/);
    const t1 = await page.getByTestId("mock-timer").textContent();
    await page.getByTestId("mock-option-B").click();
    await expect(page.getByTestId("mock-option-B")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("mock-mark").click();
    await page.getByTestId("mock-next").click();
    await expect(page.getByTestId("mock-position")).toContainText("Question 2 of 6");
    await allSaved(page);
    await page.waitForTimeout(1100);

    await page.reload();
    await expect(page.getByTestId("mock-runner")).toBeVisible();
    await expect(page.getByTestId("mock-position")).toContainText("Question 2 of 6");
    await page.getByTestId("mock-prev").click();
    await expect(page.getByTestId("mock-option-B")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("mock-mark")).toHaveAttribute("aria-pressed", "true");
    expect(await page.getByTestId("mock-timer").textContent()).not.toBe(t1);

    await page.getByTestId("open-submit").click();
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("mock-results")).toBeVisible();
    await expect(page.getByTestId("mock-review-row")).toHaveCount(6);
    await go(page, `${C}/mock`);
    await expect(page.getByTestId("mock-history-row").first()).toBeVisible();
  });

  test("theory checklist status and notes persist after reload", async ({ page }) => {
    await go(page, `${C}/theory`);
    await page.getByTestId("theory-search").fill("BigQuery ML");
    const card = page.getByTestId("concept-bqml-overview");
    await expect(card).toHaveAttribute("data-status", "not_started");
    await page.getByTestId("check-bqml-overview").click();
    await expect(card).toHaveAttribute("data-status", "completed");
    await page.getByTestId("notes-toggle-bqml-overview").click();
    await page.getByTestId("notes-bqml-overview").fill("CREATE MODEL ... OPTIONS(model_type='logistic_reg')");
    await expect(card.getByTestId("field-status")).toHaveAttribute("data-state", "saved");
    await page.reload();
    await page.getByTestId("theory-search").fill("BigQuery ML");
    await expect(page.getByTestId("concept-bqml-overview")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("concept-bqml-overview")).toContainText("logistic_reg");
  });

  test("every main page renders", async ({ page }) => {
    const pages = ["", "/questions", "/review", "/flagged", "/incorrect", "/bookmarks", "/practice", "/mock", "/theory", "/blueprint", "/analytics", "/plan", "/history"].map((p) => C + p);
    for (const p of ["/", ...pages, "/settings"]) {
      const res = await go(page, p);
      expect(res?.status(), p).toBe(200);
      await expect(page.locator("main"), p).toBeVisible();
    }
    await go(page, C);
    await expect(page.getByTestId("inventory-identity")).toContainText("339");
    // Exam Coverage & Quality is administrative: learners get 404 and no navigation entry.
    for (const p of [`${C}/data-quality`, `${C}/data-quality?tab=duplicates`, `${C}/data-quality?tab=imports`]) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(404);
    }
    await go(page, C);
    await expect(page.locator("aside nav")).not.toContainText("Exam Coverage");
    await expect(page.locator("aside nav")).not.toContainText("Data Quality");
  });
});

test.describe("accounts and sessions", () => {
  test("protects pages and APIs, signs in by email, restores the session and logs out", async ({ page, request }) => {
    await go(page, "/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
    expect((await request.get("/api/me/backup")).status()).toBe(401);

    await page.getByTestId("login-email").fill("someone@gmail.com");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText(`@${DOMAIN}`);

    const email = newEmail("returning");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("account-email")).toHaveText(email);
    await expect(page.getByTestId("current-user")).toContainText(email);

    const second = await page.context().newPage();
    await go(second, `${C}/plan`);
    await expect(second).toHaveURL(/\/c\/pmle\/plan$/);
    await second.close();

    await page.getByTestId("logout").click();
    await expect(page).toHaveURL(/\/login\?signedOut=1/);
    await expect(page.getByTestId("login-notice")).toContainText("signed out");
    await go(page, "/questions");
    await expect(page).toHaveURL(/\/login\?next=%2Fc%2Fpmle%2Fquestions/);

    await signIn(page, email.toUpperCase());
    await go(page, "/settings");
    await expect(page.getByTestId("account-email")).toHaveText(email);
  });

  test("two users share the question bank but keep independent progress", async ({ browser }) => {
    const a = await newUser(browser, "alice");
    const b = await newUser(browser, "bob");
    const code = await firstCode(a.page, `${C}/questions`);
    await go(a.page, `${C}/questions/${code}`);
    await a.page.getByTestId("toggle-bookmark").click();
    await a.page.getByTestId("option-A").click();
    await a.page.getByTestId("submit-answer").click();
    await expect(a.page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await allSaved(a.page);

    await go(b.page, `${C}/questions/${code}`);
    await expect(b.page.getByTestId("toggle-bookmark")).toHaveAttribute("aria-pressed", "false");
    await expect(b.page.getByTestId("attempt-history")).toContainText("Not attempted yet");
    await go(b.page, `${C}/bookmarks`);
    await expect(b.page.getByTestId(`open-${code}`)).toHaveCount(0);

    await go(a.page, `${C}/bookmarks`);
    await expect(a.page.getByTestId(`open-${code}`)).toBeVisible();
    await a.context.close();
    await b.context.close();
  });
});

test.describe("autosave and recovery", () => {
  test("changes made offline are kept and saved once the connection returns, even after closing the tab", async ({ browser }) => {
    const { context, page } = await newUser(browser, "offline");
    const code = await firstCode(page, `${C}/questions`);
    await go(page, `${C}/questions/${code}`);
    await allSaved(page);

    await context.setOffline(true);
    await page.getByTestId("toggle-bookmark").click();
    await expect(page.getByTestId("toggle-bookmark")).toHaveAttribute("aria-pressed", "true");
    await expect(saveIndicator(page)).toHaveAttribute("data-state", "offline");
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pmle-outbox:")).length)).toBe(1);

    await context.setOffline(false);
    await expect(saveIndicator(page)).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("toggle-bookmark")).toHaveAttribute("aria-pressed", "true");

    await context.setOffline(true);
    await page.getByTestId("toggle-review").click();
    await expect(saveIndicator(page)).toHaveAttribute("data-state", "offline");
    await page.close();
    await context.setOffline(false);
    const again = await context.newPage();
    await go(again, `${C}/questions/${code}`);
    await expect(saveIndicator(again)).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await again.reload();
    await expect(again.getByTestId("toggle-review")).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });

  test("other open tabs pick up saved changes", async ({ browser }) => {
    const { context, page } = await newUser(browser, "tabs");
    const code = await firstCode(page, `${C}/questions`);
    const other = await context.newPage();
    await go(other, `${C}/questions/${code}`);
    await go(page, `${C}/questions/${code}`);
    await page.getByTestId("toggle-flag").click();
    await allSaved(page);
    await expect(other.getByTestId("toggle-flag")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await context.close();
  });

  test("the dashboard offers to continue where you left off", async ({ page }) => {
    await signIn(page, newEmail("resume"));
    const code = await firstCode(page, `${C}/questions`);
    await go(page, `${C}/questions/${code}?from=all`);
    await page.waitForTimeout(2000);
    await allSaved(page);
    await go(page, C);
    await expect(page.getByTestId("resume-link")).toHaveAttribute("href", `${C}/questions/${code}?from=all`);
  });
});

function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return null;
}

async function answerFirstOption(page: Page) {
  await page.getByTestId("option-A").click();
  await expect(page.getByTestId("option-A")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("submit-answer").click();
}

test.describe("responsiveness and failure handling", () => {
  test("question controls work when the app is opened via the machine's network address", async ({ browser, baseURL }) => {
    const ip = lanAddress();
    test.skip(!ip, "no network interface");
    const lan = new URL(baseURL!);
    lan.hostname = ip!;
    const context = await browser.newContext({ baseURL: lan.origin });
    const page = await context.newPage();
    await signIn(page, newEmail("lan"));
    const code = await firstCode(page, `${C}/questions`);
    await go(page, `${C}/questions/${code}`);
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await answerFirstOption(page);
    await expect(page.getByTestId("feedback")).toBeVisible();
    await page.getByTestId("toggle-flag").click();
    await page.getByTestId("note-add").click();
    await page.getByTestId("note-input").fill("via LAN");
    await expect(page.getByTestId("note").getByTestId("field-status")).toHaveAttribute("data-state", "saved");
    await allSaved(page);
    await page.reload();
    await expect(page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("toggle-flag")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("note-input")).toHaveValue("via LAN");
    await context.close();
  });

  test("every page becomes interactive and the 'controls haven't loaded' notice stays hidden", async ({ page }) => {
    await signIn(page, newEmail("hydrate"));
    for (const p of ["/", C, `${C}/questions`, `${C}/questions/Q-0001`, `${C}/practice`, `${C}/mock`, `${C}/theory`, `${C}/plan`, "/settings"]) {
      await go(page, p);
      await expect(page.locator("html"), p).toHaveAttribute("data-hydrated", "true");
    }
    await page.waitForTimeout(8500);
    await expect(page.getByTestId("js-stalled")).toBeHidden();
  });

  test("if the page's scripts can't load, a visible notice explains why clicks do nothing", async ({ browser }) => {
    const context = await browser.newContext();
    await context.route(/\/_next\/static\/.*\.js(\?.*)?$/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("js-stalled")).toBeVisible({ timeout: 12_000 });
    await context.close();
  });

  test("an answer whose request gets no response is kept, not stuck, and saved once the server answers", async ({ browser }) => {
    const { context, page } = await newUser(browser, "hung");
    const code = await firstCode(page, `${C}/questions`);
    await go(page, `${C}/questions/${code}`);
    await allSaved(page);
    const held: import("@playwright/test").Route[] = [];
    await context.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? void held.push(route) : route.continue()));
    await answerFirstOption(page);
    await expect(page.getByTestId("submit-answer")).toHaveText("Saving…");
    await expect(page.getByTestId("submit-answer")).toHaveText("Waiting to save…", { timeout: 16_000 });
    await expect(page.getByTestId("answer-error")).toContainText("kept");
    await expect(page.getByTestId("option-A")).toHaveAttribute("aria-checked", "true");
    await context.unroute("**/*");
    for (const r of held.splice(0)) await r.abort().catch(() => {});
    await expect(page.getByTestId("feedback")).toBeVisible({ timeout: 30_000 });
    await allSaved(page);
    await page.reload();
    await expect(page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await context.close();
  });

  test("finishing a practice session waits for answers that haven't been saved yet", async ({ browser }) => {
    const { context, page } = await newUser(browser, "finish");
    page.on("dialog", (d) => d.accept());
    await go(page, `${C}/practice`);
    await page.getByTestId("count").fill("3");
    await page.getByTestId("start-practice").click();
    await page.waitForURL(/\/practice\/[^/?]+/);
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await context.setOffline(true);
    await answerFirstOption(page);
    await expect(page.getByTestId("submit-answer")).toHaveText("Waiting to save…");
    await page.getByTestId("finish-session").click();
    await expect(page.getByTestId("session-error")).toContainText("haven't reached the server", { timeout: 15_000 });
    await expect(page).not.toHaveURL(/summary=1/);
    await context.setOffline(false);
    await expect(page.getByTestId("feedback")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("finish-session").click();
    await page.waitForURL(/summary=1/);
    await go(page, `${C}/questions`);
    await expect(page.getByTestId("question-row").filter({ hasText: "1 attempt" })).toHaveCount(1);
    await context.close();
  });
});

test.describe("source abstraction", () => {
  /** A question with a locally stored exhibit, and the question that is PDF question 84. */
  const EXHIBIT = "Q-0147";
  const PDF84 = "Q-0084";
  const html = async (page: Page, path: string) => {
    expect((await go(page, path))?.status(), path).toBe(200);
    return page.content();
  };
  const codes = async (page: Page, path: string) => {
    await go(page, path);
    return page.getByTestId("question-row").locator("a[data-testid^='open-']").evaluateAll((as) => as.map((a) => a.getAttribute("data-testid")));
  };

  test("learners never receive source names, ids, keys, asset paths or source links in pages, files or APIs", async ({ page, request }) => {
    await signIn(page, newEmail("leak"));
    for (const p of [C, `${C}/questions`, `${C}/questions/${EXHIBIT}`, `${C}/questions/${PDF84}`, `${C}/practice`, `${C}/mock`, "/settings"]) expect(await html(page, p), p).not.toMatch(LEAK);

    await go(page, `${C}/questions/${EXHIBIT}`);
    const img = page.getByTestId("question-card").locator("img").first();
    await expect(img).toHaveAttribute("src", /^\/api\/exhibit\?q=\d+&i=0$/);
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await page.getByTestId("metadata-panel").locator("summary").click();
    await expect(page.getByTestId("question-sources")).toContainText(/Source( \d)? · Question \d+/);
    await expect(page.getByTestId("source-pdf-link")).toHaveCount(0);
    await go(page, `${C}/questions/${PDF84}`);
    await page.getByTestId("reveal-answer").click();
    await expect(page.getByTestId("answer-claims")).toContainText(/Source answer key \(Source \d\)/);
    expect(await page.content()).not.toMatch(LEAK);

    await go(page, `${C}/practice`);
    await expect(page.getByTestId("mode-common")).toHaveCount(0);
    await page.getByTestId("start-practice").click();
    await page.waitForURL(new RegExp(`${C}/practice/[^/]+$`));
    await expect(page.getByTestId("question-card")).toBeVisible();
    expect(await page.content()).not.toMatch(LEAK);

    await go(page, `${C}/mock`);
    await page.getByTestId("mock-count").fill("3");
    await page.getByTestId("start-mock").click();
    await expect(page.getByTestId("mock-runner")).toBeVisible();
    expect(await page.content()).not.toMatch(LEAK);

    const cookies = { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } };
    for (const f of ["json", "csv"]) {
      const res = await request.get(`/api/export/questions?format=${f}`, cookies);
      expect(res.status(), f).toBe(200);
      const body = await res.text();
      expect(body, f).not.toMatch(LEAK);
      expect(body, f).not.toMatch(/sourcePage|sourceUrl/);
    }
    expect((await request.get("/api/me/backup", cookies)).ok()).toBe(true);
    expect(await (await request.get("/api/me/backup", cookies)).text()).not.toMatch(LEAK);
    expect((await request.get("/api/pdf", cookies)).status()).toBe(404);
    expect((await request.get("/api/pdf?v=ver_pmle_2026&s=pdf", cookies)).status()).toBe(404);
    const missing = await request.get("/api/exhibit?q=999999&i=0", cookies);
    expect(missing.status()).toBe(404);

    // Source filters, sorts and searches in the URL have no effect for learners.
    const all = await codes(page, `${C}/questions`);
    expect(await codes(page, `${C}/questions?source=only%3Apdf&sort=qnum%3Apdf`)).toEqual(all);
    expect(await codes(page, `${C}/questions?q=pdf%3A84`)).toEqual([]);
    expect(await codes(page, `${C}/questions?q=examprepper`)).toEqual([]);
    await go(page, `${C}/questions`);
    await expect(page.getByTestId("search-input")).toBeVisible();
    await expect(page.getByLabel("Source", { exact: true })).toHaveCount(0);
  });

  test("administrators keep full provenance: source names, PDF links, source filters, source search and export columns", async ({ page, request }) => {
    await signIn(page, ADMIN);
    await go(page, `${C}/questions/${PDF84}`);
    await page.getByTestId("metadata-panel").locator("summary").click();
    await expect(page.getByTestId("question-sources")).toContainText("PDF question bank · Question 84");
    await expect(page.getByTestId("source-pdf-link")).toHaveAttribute("href", /^\/api\/pdf\?v=ver_pmle_2026&s=pdf#page=\d+$/);
    await page.getByTestId("reveal-answer").click();
    await expect(page.getByTestId("answer-claims")).toContainText("(PDF question bank)");

    expect(await codes(page, `${C}/questions?q=pdf%2084`)).toContain(`open-${PDF84}`);
    const ep = await codes(page, `${C}/questions?source=only%3Aexamprepper`);
    expect(ep.length).toBeGreaterThan(0);
    expect(ep.length).toBeLessThan((await codes(page, `${C}/questions`)).length);

    const cookies = { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } };
    const pdf = await request.get("/api/pdf?v=ver_pmle_2026&s=pdf", cookies);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await (await request.get("/api/export/questions?format=csv", cookies)).text()).split("\n")[0]).toContain("sources,sourcePage,sourceUrl");
  });
});

test.describe("Exam Coverage & Quality and Exam Blueprint", () => {
  test("administrators see the coverage overview: score with unique count, published weights, separate quality card, neutral sources", async ({ page }) => {
    await signIn(page, ADMIN);
    await go(page, C);
    await expect(page.locator("aside nav")).toContainText("Exam Coverage & Quality");
    await page.locator("aside nav").getByRole("link", { name: /Exam Coverage & Quality/ }).click();
    await page.waitForURL(new RegExp(`${C}/data-quality$`));
    await expect(page.getByRole("heading", { name: "Exam Coverage & Quality" })).toBeVisible();
    await expect(page.getByTestId("dq-readonly")).toBeVisible();

    const card = page.getByTestId("distribution-alignment");
    await expect(card).toHaveAttribute("data-state", "verified");
    await expect(card).toContainText("Blueprint Distribution Alignment");
    await expect(card.getByTestId("bda-score")).toHaveText(/^(\d|[1-9]\d|100) \/ 100$/);
    await expect(card).toContainText("Domain mix of 339 unique questions");
    await expect(card).toContainText("does not measure exam readiness, content completeness, answer accuracy or question quality");
    await expect(card).toContainText("Official weights verified");

    const overview = page.getByTestId("coverage-overview");
    expect(await overview.innerHTML()).not.toMatch(/ExamPrepper|examtopics|PDF question bank|ML_Engineer_Exam_Questions|https?:\/\/(?!services\.google)/i);
    await expect(page.getByTestId("scaling-note")).toContainText("total 101%");
    await expect(page.getByTestId("published-weight")).toHaveText(["13%", "16%", "21%", "20%", "18%", "13%"]);
    await expect(page.getByTestId("blueprint-share")).toContainText("Unmapped");
    const quality = page.getByTestId("question-quality");
    await expect(quality).toContainText("Found in 2+ sources");
    await expect(quality).toContainText("Exhibits without a local copy");
    await expect(quality).not.toContainText("Alignment");
    await expect(quality).not.toContainText("/ 100");
    await expect(page.getByTestId("source-summary-row").locator("td").first()).toHaveText("Source 1");
    await expect(page.getByTestId("source-summary-row")).toHaveCount(2);

    await go(page, `${C}/data-quality?tab=imports`);
    await expect(page.getByTestId("extraction-reports")).toContainText("ExamPrepper extraction");
    await expect(page.getByTestId("inventory-identity-check")).toContainText("= 339");
  });

  test("learners get the slim official Exam Blueprint without personal stats, score or source names", async ({ page }) => {
    await signIn(page, newEmail("blueprint"));
    const html = (await go(page, `${C}/blueprint`)) && (await page.content());
    expect(html).not.toMatch(LEAK);
    expect(html).not.toContain("Blueprint Distribution Alignment");
    for (const [n, w] of [[1, 13], [2, 16], [3, 21], [4, 20], [5, 18], [6, 13]]) await expect(page.getByTestId(`weight-${n}`)).toHaveText(`${w}%`);
    await expect(page.locator("#obj-1\\.1")).toHaveCount(1);
    await expect(page.locator("#dom-3")).toHaveCount(1);
    await expect(page.getByTestId("blueprint-share")).toBeVisible();
    const main = page.locator("main");
    for (const stat of ["Accuracy", "Latest accuracy", "attempted"]) await expect(main, stat).not.toContainText(stat);
    await expect(page.getByTestId("progress-link")).toHaveAttribute("href", `${C}/analytics`);
    // Theory pages link to objective anchors on the Blueprint.
    await go(page, `${C}/theory`);
    const concept = await page.locator(`main a[href^="${C}/theory/"]`).first().getAttribute("href");
    await go(page, concept!);
    const objLink = page.locator(`a[href*="/blueprint#obj-"]`).first();
    const href = (await objLink.getAttribute("href"))!;
    await go(page, href);
    await expect(page.locator(`[id="${decodeURIComponent(href.split("#")[1])}"]`)).toHaveCount(1);
  });
});

test.describe("personal backups", () => {
  test("Download My Backup saves a complete file that restores into another account", async ({ browser }) => {
    const a = await newUser(browser, "backup-owner");
    const code = await firstCode(a.page, `${C}/questions`);
    await go(a.page, `${C}/questions/${code}`);
    await a.page.getByTestId("option-B").click();
    await a.page.getByTestId("submit-answer").click();
    await expect(a.page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await a.page.getByTestId("note-add").click();
    await a.page.getByTestId("note-input").fill("backup me");
    await expect(a.page.getByTestId("note").getByTestId("field-status")).toHaveAttribute("data-state", "saved");

    await go(a.page, "/settings");
    const [download] = await Promise.all([a.page.waitForEvent("download"), a.page.getByTestId("download-backup").click()]);
    expect(download.suggestedFilename()).toMatch(/^pmle-backup-backup-owner-.*\.json$/);
    const file = await download.path();
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(data).toMatchObject({ format: "pmle-prep-progress", version: 4, account: { email: a.email } });
    expect(data.attempts[0].sourceRefs.length).toBeGreaterThan(0);
    expect(data.attempts[0]).not.toHaveProperty("sourceKeys");
    expect(fs.readFileSync(file, "utf8")).not.toMatch(LEAK);
    expect(data.versions.map((v: { id: string }) => v.id)).toContain("ver_pmle_2026");
    expect(data.attempts).toHaveLength(1);
    expect(data.notes.map((n: { content: string }) => n.content)).toEqual(["backup me"]);

    const b = await newUser(browser, "backup-restorer");
    await go(b.page, "/settings");
    await b.page.getByTestId("import-file").setInputFiles(file);
    await expect(b.page.getByTestId("restore-result")).toContainText("Restored 1 attempts");
    await go(b.page, `${C}/questions/${code}`);
    await expect(b.page.getByTestId("attempt-history").locator("li")).toHaveCount(1);
    await expect(b.page.getByTestId("note-input")).toHaveValue("backup me");

    await go(b.page, "/settings");
    await b.page.getByTestId("import-file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"other"}') });
    await expect(b.page.getByTestId("restore-result")).toContainText("Not a PMLE Prep progress export");
    await a.context.close();
    await b.context.close();
  });
});

test.describe("certification home, versions and administration", () => {
  test("lands on the certification home after sign-in and keeps old PMLE links working", async ({ page }) => {
    await signIn(page, newEmail("home"));
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("cert-card-pmle")).toContainText("2026");
    await expect(page.getByTestId("cert-card-pde")).toHaveCount(0);
    await expect(page.getByTestId("no-other-certs")).toBeVisible();
    await expect(page.getByTestId("add-certification")).toHaveCount(0);
    for (const [legacy, now] of [["/questions", `${C}/questions`], ["/pdf", `${C}/questions`], ["/theory", `${C}/theory`], ["/mock", `${C}/mock`]]) {
      await go(page, legacy);
      await expect(page, legacy).toHaveURL(new RegExp(`${now.replace(/\//g, "\\/")}$`));
    }
    for (const hidden of ["/c/pde", `${C}/data`, "/certifications/new"]) expect((await go(page, hidden))?.status(), hidden).toBe(404);
  });

  test("an administrator unlocks admin mode, adds a certification from a file, and publishes it for learners", async ({ browser }) => {
    const admin = await browser.newContext();
    const page = await admin.newPage();
    page.on("dialog", (d) => d.accept());
    await signIn(page, ADMIN);
    await go(page, "/");
    await expect(page.getByTestId("cert-card-pde")).toContainText(/no published|not published|draft/i);
    await expect(page.getByTestId("add-certification-locked")).toBeVisible();
    expect((await go(page, `${C}/data`))?.status()).toBe(200);
    await expect(page.getByTestId("data-readonly")).toBeVisible();

    await go(page, "/settings#admin-access");
    await page.getByTestId("admin-code").fill("wrong-code-000");
    await page.getByTestId("admin-elevate").click();
    await expect(page.getByText(/Incorrect access code/)).toBeVisible();
    await page.getByTestId("admin-code").fill(ACCESS_CODE);
    await page.getByTestId("admin-elevate").click();
    await expect(page.getByTestId("admin-elevated")).toBeVisible();

    const slug = `e2e${Date.now().toString(36).slice(-5)}`;
    const questions = Array.from({ length: 4 }, (_, i) => ({
      number: i + 1,
      stem: `E2E fixture question ${i + 1}: which option keeps the fixture pipeline maintainable with the least effort?`,
      options: [
        { label: "A", text: `Managed option ${i + 1}` },
        { label: "B", text: `Manual option ${i + 1}` },
      ],
      answer: ["A"],
    }));
    const file = { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "cert-prep-questions/v1", source: { name: "E2E fixture" }, questions })) };

    await go(page, "/");
    await page.getByTestId("add-certification").click();
    await page.getByTestId("cert-code").fill(slug);
    await page.getByTestId("cert-name").fill("E2E Fixture Certification");
    await page.getByTestId("cert-file").setInputFiles(file);
    await page.getByTestId("create-cert").click();
    await page.waitForURL(new RegExp(`/c/${slug}/data$`));
    const source = page.getByTestId("source-row").first();
    await expect(source).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("readiness")).toContainText(/not processed yet/);
    await page.getByTestId("start-processing").click();
    await expect(page.getByTestId("start-result")).toContainText("Started processing 1 source");
    await expect(source).toHaveAttribute("data-state", "processed", { timeout: 30_000 });
    await expect(page.getByTestId("draft-sources")).toContainText("4 extracted");
    await expect(page.getByTestId("job-row").first()).toContainText("4/4 valid");
    await expect(page.getByTestId("start-processing")).toBeDisabled();

    await go(page, `/c/${slug}/data-quality?tab=questions`);
    await expect(page.getByTestId("dq-tab-questions")).toBeVisible();
    await expect(page.getByTestId("q-card")).toHaveCount(4);
    const first = page.getByTestId("q-card").first();
    const code = await first.getAttribute("data-code");
    await first.getByTestId(`edit-${code}`).click();
    await first.getByTestId("edit-option-A").fill("Managed option, edited in review");
    await first.getByTestId("edit-save").click();
    await expect(first).toContainText("Managed option, edited in review");
    await expect(first).toContainText("edited by");
    await page.reload();
    await expect(page.locator(`[data-code="${code}"]`)).toContainText("Managed option, edited in review");
    await go(page, `/c/${slug}/data-quality`);
    await expect(page.getByTestId("dq-metrics")).toContainText("Valid");
    await expect(page.getByTestId("dq-sources")).toContainText("Source");
    await expect(page.getByTestId("dq-sources")).not.toContainText("fixture");
    await expect(page.getByTestId("dq-sources")).toContainText("processed");
    await expect(page.getByTestId("distribution-alignment")).toHaveAttribute("data-state", /unverified/);
    await expect(page.getByTestId("bda-score")).toHaveCount(0);
    await expect(page.getByTestId("distribution-alignment")).toContainText("4 unique questions");
    await go(page, `/c/${slug}/data-quality?tab=imports`);
    await expect(page.getByTestId("extraction-reports")).toContainText("fixture extraction");
    await go(page, `/c/${slug}/data`);

    const learner = await browser.newContext();
    const lp = await learner.newPage();
    await signIn(lp, newEmail("learner"));
    await expect(lp.getByTestId(`cert-card-${slug}`)).toHaveCount(0);
    expect((await go(lp, `/c/${slug}`))?.status()).toBe(404);

    await page.getByTestId(`submit-${new Date().getFullYear()}`).click();
    await expect(page.getByTestId(`publish-${new Date().getFullYear()}`)).toBeVisible();
    await page.getByTestId(`publish-${new Date().getFullYear()}`).click();
    await expect(page.getByTestId("published-summary")).toContainText("4", { timeout: 15_000 });

    await go(lp, "/");
    await expect(lp.getByTestId(`cert-card-${slug}`)).toContainText("E2E Fixture Certification");
    await go(lp, `/c/${slug}/questions`);
    await expect(lp.getByTestId("question-row")).toHaveCount(4);
    expect((await go(lp, `/c/${slug}/data`))?.status()).toBe(404);
    await admin.close();
    await learner.close();
  });
});
