import path from "node:path";
import { describe, expect, it } from "vitest";
import { exhibitUrl, learnerImages, resolveExhibitPath } from "@/lib/exhibits";
import { VERIFICATION_HELP } from "@/lib/verification";

const PUBLIC = path.resolve(__dirname, "../../public");

describe("resolveExhibitPath", () => {
  it("accepts images stored under public/question-assets/", () => {
    expect(resolveExhibitPath("/question-assets/examprepper/ep-024-0.png", PUBLIC)).toBe(path.join(PUBLIC, "question-assets/examprepper/ep-024-0.png"));
    expect(resolveExhibitPath("/question-assets/a/b.JPG", PUBLIC)).toBe(path.join(PUBLIC, "question-assets/a/b.JPG"));
  });

  it("rejects traversal, other folders, other file types and non-strings", () => {
    for (const bad of [
      "/question-assets/../../.env",
      "/question-assets/../secret.png",
      "/question-assets/x/../../../etc/passwd.png",
      "/etc/passwd.png",
      "question-assets/a.png",
      "/favicon.png",
      "/question-assets/a.svg",
      "/question-assets/a.html",
      "/question-assets/a",
      "/question-assets/a\0.png",
      "/question-assets\\..\\a.png",
      "https://www.examtopics.com/assets/media/exam-media/04223/0001.png",
      null,
      undefined,
      42,
    ]) {
      expect(resolveExhibitPath(bad, PUBLIC), String(bad)).toBeNull();
    }
  });
});

describe("learnerImages", () => {
  it("replaces stored paths and remote hosts with neutral URLs, and drops exhibits without a local copy", () => {
    const out = learnerImages(7, [
      { remote: "https://www.examtopics.com/x.png", local: "/question-assets/examprepper/ep-1-0.png" },
      { remote: "https://www.examtopics.com/y.png", local: null },
      { remote: "https://www.examtopics.com/z.png", local: "/question-assets/../../.env" },
    ]);
    expect(out).toEqual([{ remote: exhibitUrl(7, 0), local: exhibitUrl(7, 0) }, null, null]);
    expect(JSON.stringify(out)).not.toMatch(/examtopics|examprepper|question-assets/);
    expect(exhibitUrl(7, 0)).toBe("/api/exhibit?q=7&i=0");
  });
});

describe("verification help", () => {
  it("names no source", () => {
    expect(Object.values(VERIFICATION_HELP).join(" ")).not.toMatch(/examtopics|examprepper|pdf/i);
  });
});
