"""Extract questions from the local PMLE question-bank PDF.

Output: data/processed/pdf_questions.json
Each record preserves the raw block text alongside parsed fields, the PDF
question number, the PDF topic label, and the start/end page numbers.
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "data" / "raw" / "pdf" / "ML_Engineer_Exam_Questions.pdf"
OUT = ROOT / "data" / "processed" / "pdf_questions.json"

HEADER_RE = re.compile(
    r"^Question #(?P<num>\d+)\s*•\s*Topic (?P<tnum>\d+):\s*(?P<tname>.+?)\s*•\s*Question (?P<i>\d+) of (?P<k>\d+)\s*$"
)
TOPIC_LINE_RE = re.compile(r"^Topic \d+: \d+: .+$")
TITLE_LINES = {
    "Google Professional Machine Learning Engineer",
}
TITLE_PREFIX = "Exam Questions - "
OPTION_RE = re.compile(r"^(?P<letter>[A-H])\.\s+(?P<text>.*)$")
ANSWER_RE = re.compile(r"^Answer:\s*(?P<ans>[A-H](?:\s*[,&]?\s*[A-H])*)\s*$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\u200b]")
CODE_RE = re.compile(r"^(\s{4,}\S|SELECT\b|FROM\b|WHERE\b|CREATE\b|OPTIONS\(|import |def |gcloud |bq |\}|\{)")


def clean(line: str) -> str:
    return CONTROL_RE.sub("", line).rstrip()


def join_lines(lines):
    """Join hard-wrapped PDF lines. Lines that look like code keep their breaks."""
    parts = []
    prev_code = False
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        code_like = bool(CODE_RE.match(ln))
        if not parts:
            parts.append(s)
        elif code_like or prev_code:
            parts.append("\n" + s)
        else:
            parts.append(" " + s)
        prev_code = code_like
    return "".join(parts).strip()


def split_numbered_steps(text: str) -> str:
    """Options written as '1. Do X.2. Do Y.3. Do Z' lose their line breaks in the PDF; restore them."""
    if not re.match(r"^1\.\s", text):
        return text
    for k in range(2, 10):
        text, n = re.subn(rf"(?<=\.)\s*{k}\.\s+(?=[A-Z])", f"\n{k}. ", text, count=1)
        if not n:
            break
    return text


def main():
    doc = pymupdf.open(PDF)
    stream = []  # (page_no, line)
    for pno, page in enumerate(doc, start=1):
        for raw in page.get_text().split("\n"):
            line = clean(raw)
            if not line.strip():
                continue
            if line.strip() in TITLE_LINES or line.startswith(TITLE_PREFIX) or TOPIC_LINE_RE.match(line.strip()):
                continue
            stream.append((pno, line))

    blocks = []
    cur = None
    for pno, line in stream:
        m = HEADER_RE.match(line.strip())
        if m:
            if cur:
                blocks.append(cur)
            cur = {"header": m.groupdict(), "page_start": pno, "page_end": pno, "lines": []}
            continue
        if cur is None:
            continue
        cur["lines"].append(line)
        cur["page_end"] = pno
    if cur:
        blocks.append(cur)

    records, failures = [], []
    for b in blocks:
        h = b["header"]
        stem_lines, options, answer, cur_opt = [], {}, None, None
        for line in b["lines"]:
            s = line.strip()
            am = ANSWER_RE.match(s)
            if am:
                answer = re.sub(r"[^A-H]", "", am.group("ans"))
                cur_opt = None
                continue
            om = OPTION_RE.match(s)
            if om and (cur_opt is not None or om.group("letter") == "A") and answer is None:
                cur_opt = om.group("letter")
                options[cur_opt] = [om.group("text")]
                continue
            if cur_opt is not None and answer is None:
                options[cur_opt].append(line)
            elif answer is None:
                stem_lines.append(line)
        stem = join_lines(stem_lines)
        stem = re.sub(r"\s*---\s*$", "", stem).strip()
        parsed_options = [{"label": k, "text": split_numbered_steps(join_lines(v))} for k, v in sorted(options.items())]
        issues = []
        m_choose = re.search(r"\(choose (two|three|2|3)\.?\)", stem, re.I)
        if m_choose:
            need = {"two": 2, "2": 2, "three": 3, "3": 3}[m_choose.group(1).lower()]
            if not answer or len(answer) < need:
                issues.append("multi_select_incomplete")
        if len(parsed_options) < 2:
            issues.append("missing_options")
        if not answer:
            issues.append("missing_answer")
        elif any(a not in options for a in answer):
            issues.append("answer_not_in_options")
        if len(stem) < 30:
            issues.append("short_stem")
        rec = {
            "source": "pdf",
            "source_qnum": int(h["num"]),
            "pdf_topic_num": int(h["tnum"]),
            "pdf_topic": h["tname"].strip(),
            "topic_index": f'{h["i"]} of {h["k"]}',
            "page_start": b["page_start"],
            "page_end": b["page_end"],
            "stem": stem,
            "options": parsed_options,
            "answer": list(answer) if answer else [],
            "multi_select": bool(answer and len(answer) > 1),
            "explanation": None,
            "images": [],
            "raw_text": "\n".join(b["lines"]),
            "issues": issues,
            "extraction_confidence": 1.0 if not issues else 0.5,
        }
        records.append(rec)
        if issues:
            failures.append({"qnum": rec["source_qnum"], "issues": issues})

    nums = [r["source_qnum"] for r in records]
    missing_nums = sorted(set(range(1, max(nums) + 1)) - set(nums)) if nums else []
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source_file": PDF.name, "page_count": doc.page_count,
                               "declared_count": 338, "questions": records,
                               "missing_question_numbers": missing_nums}, indent=1, ensure_ascii=False))
    print(f"pdf: pages={doc.page_count} blocks={len(blocks)} records={len(records)} "
          f"with_issues={len(failures)} missing_nums={missing_nums[:10]}")
    for f in failures[:20]:
        print("  issue", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
