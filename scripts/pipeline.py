"""PMLE ingestion pipeline (deterministic, idempotent).

Steps
  1. PDF        -> data/processed/pdf_questions.json        (scripts/extract_pdf.py)
  2. Guide      -> data/processed/taxonomy.json             (domains, objectives, considerations)
  3. Website    -> data/processed/examprepper_questions.json (from captured pages in data/raw/examprepper)
  4. Normalize, build answer claims, classify against the guide, detect legacy terms
  5. Deduplicate (exact hash -> fuzzy -> TF-IDF semantic candidates)
  6. Write data/processed/bank.json (consumed by scripts/import-db.ts) and data/reports/*

Nothing here touches user progress; the DB importer upserts content only.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pymupdf
from rapidfuzz import fuzz
from rapidfuzz.process import cdist

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
REPORTS = ROOT / "data" / "reports"
TAXO = ROOT / "data" / "taxonomy"
ASSETS = ROOT / "public" / "question-assets"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_pdf  # noqa: E402

EP_EXAM_URL = "https://www.examprepper.co/exam/14/{page}"
GUIDE_URL = "https://services.google.com/fh/files/misc/professional_machine_learning_engineer_exam_guide_english_new.pdf"


# --------------------------------------------------------------------------- utils

def nfkc(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("\u200b", "").replace("\u00a0", " ")
    s = s.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    return s


def norm_text(s: str) -> str:
    s = nfkc(s).lower()
    s = s.replace("//img//", " ")
    s = re.sub(r"\[\[img:\d+\]\]", " ", s)
    s = re.sub(r"[^a-z0-9%/+#.\- ]+", " ", s)
    s = re.sub(r"(?<!\d)\.(?!\d)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sha(s: str) -> str:
    return hashlib.sha1(s.encode()).hexdigest()


def strip_html(s: str) -> str:
    if "<" not in s:
        return html.unescape(s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s)


# --------------------------------------------------------------------------- guide

def parse_guide():
    pdf = RAW / "guide" / "pmle_exam_guide_2026-06-01.pdf"
    doc = pymupdf.open(pdf)
    text = "\n".join(p.get_text() for p in doc)
    text = re.sub(r"[ \u200b]*\u200b[ \u200b]*", " ", text)
    text = nfkc(text)
    (RAW / "guide" / "guide.txt").write_text(text)
    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln and not re.fullmatch(r"\d+", ln)]

    sec_re = re.compile(r"^Section\s+(\d):\s*(.+)$")
    obj_re = re.compile(r"^(\d)\.\s*(\d)\s+(.+)$")
    bullet_re = re.compile(r"^[●•]\s*(.*)$")

    domains, cur_dom, cur_obj, cur_bullet = [], None, None, None
    buf_title = None
    for ln in lines:
        m = sec_re.match(ln)
        if m:
            cur_dom = {"number": int(m.group(1)), "title_raw": m.group(2), "objectives": []}
            domains.append(cur_dom)
            cur_obj = cur_bullet = None
            buf_title = "dom"
            continue
        m = obj_re.match(ln)
        if m and cur_dom is not None:
            cur_obj = {"code": f"{m.group(1)}.{m.group(2)}", "title": m.group(3), "considerations": []}
            cur_dom["objectives"].append(cur_obj)
            cur_bullet = None
            buf_title = "obj"
            continue
        m = bullet_re.match(ln)
        if m and cur_obj is not None:
            cur_bullet = m.group(1)
            cur_obj["considerations"].append(cur_bullet)
            buf_title = "bullet"
            continue
        # continuation lines
        if buf_title == "dom" and cur_dom is not None and cur_obj is None:
            cur_dom["title_raw"] += " " + ln
        elif buf_title == "obj" and cur_obj is not None:
            cur_obj["title"] += " " + ln
        elif buf_title == "bullet" and cur_obj is not None and cur_obj["considerations"]:
            cur_obj["considerations"][-1] += " " + ln

    for d in domains:
        t = re.sub(r"\s+", " ", d.pop("title_raw"))
        m = re.search(r"\(~\s*(\d+)%\s*of the exam\)", t)
        d["weight_percent"] = int(m.group(1)) if m else None
        d["title"] = re.sub(r"\s*\(~.*$", "", t).strip()
        for o in d["objectives"]:
            o["title"] = re.sub(r"\s*Considerations include:?\s*$", "", re.sub(r"\s+", " ", o["title"])).strip()
            o["considerations"] = [re.sub(r"\s+", " ", c).strip() for c in o["considerations"]]
    assert len(domains) == 6, f"expected 6 guide sections, got {len(domains)}"
    total = sum(d["weight_percent"] or 0 for d in domains)
    taxonomy = {
        "source_url": GUIDE_URL,
        "guide_date": "2026-06-01",
        "weights_sum_percent": total,
        "weights_note": f"Official weights are approximate (~) and sum to {total}%. They are stored as published; mock-exam allocation scales them proportionally.",
        "domains": domains,
    }
    return taxonomy


# --------------------------------------------------------------------------- examprepper

VOTE_RE = re.compile(r"^(?:(?P<lab>[A-H]+)\s*)?\((?P<pct>\d+)%\)$|^(?P<pct2>\d+)%$|^Other$")


def parse_votes(items):
    votes = []
    for it in items or []:
        it = it.strip()
        m = re.match(r"^([A-H]+)\s*\((\d+)%\)$", it)
        if m:
            votes.append({"labels": sorted(m.group(1)), "percent": int(m.group(2))})
            continue
        m = re.match(r"^(\d+)%$", it)
        if m:
            votes.append({"labels": [], "percent": int(m.group(1))})
    return votes


def parse_examprepper():
    pages = sorted((RAW / "examprepper").glob("page-*.json"))
    records, declared, seen = [], None, set()
    page_nums = []
    for f in pages:
        d = json.loads(f.read_text())
        pp = d["pageProps"]
        declared = pp.get("exam", {}).get("numberOfQuestions", declared)
        page_nums.append(d["page"])
        for q in pp["questions"]:
            qid = int(q["question_id"])
            if qid in seen:
                continue
            seen.add(qid)
            text = strip_html(nfkc(q["question_text"]))
            images = list(q.get("question_images") or [])
            n_img = 0

            def repl(_m):
                nonlocal n_img
                n_img += 1
                return f"\n[[img:{n_img - 1}]]\n"

            stem = re.sub(r"//IMG//", repl, text)
            # images not referenced inline are appended after the stem
            for k in range(n_img, len(images)):
                stem += f"\n[[img:{k}]]"
            stem = re.sub(r"\n{3,}", "\n\n", stem).strip()
            opts = [{"label": k, "text": strip_html(nfkc(v)).strip()} for k, v in sorted(q["choices"].items())]
            issues = []
            if len(opts) < 2:
                issues.append("missing_options")
            ans = sorted(re.sub(r"[^A-H]", "", q.get("answer") or ""))
            ans_et = sorted(re.sub(r"[^A-H]", "", q.get("answer_ET") or ""))
            labels = {o["label"] for o in opts}
            if not ans and not ans_et:
                issues.append("missing_answer")
            if any(a not in labels for a in ans + ans_et):
                issues.append("answer_not_in_options")
            disc = sorted(q.get("discussion") or [], key=lambda c: -int(c.get("upvote_count") or 0))[:3]
            records.append({
                "source": "examprepper",
                "source_key": f"examprepper:{qid}",
                "source_qnum": qid,
                "page": d["page"],
                "url": EP_EXAM_URL.format(page=d["page"]),
                "origin_url": q.get("url"),
                "topic_label": f"Topic {q.get('topic')}",
                "stem": stem,
                "options": opts,
                "answer_site": ans,
                "answer_examtopics": ans_et,
                "votes": parse_votes(q.get("answers_community")),
                "explanation": strip_html(nfkc(q.get("answer_description") or "")).strip() or None,
                "discussion": [{"upvotes": int(c.get("upvote_count") or 0),
                                "content": strip_html(nfkc(c.get("content") or ""))[:1500]} for c in disc],
                "remote_images": images,
                "raw": {"question_text": q["question_text"], "choices": q["choices"], "answer": q.get("answer"),
                        "answer_ET": q.get("answer_ET"), "answers_community": q.get("answers_community"),
                        "timestamp": q.get("timestamp")},
                "issues": issues,
                "extraction_confidence": 1.0 if not issues else 0.5,
            })
    expected_pages = (declared + 4) // 5 if declared else None
    missing_pages = sorted(set(range(1, expected_pages + 1)) - set(page_nums)) if expected_pages else []
    return {
        "declared_count": declared,
        "expected_pages": expected_pages,
        "captured_pages": sorted(page_nums),
        "missing_pages": missing_pages,
        "questions": sorted(records, key=lambda r: r["source_qnum"]),
    }


def localize_images(ep):
    """Download exhibit images once into public/question-assets/examprepper (skips existing)."""
    import requests

    out = ASSETS / "examprepper"
    out.mkdir(parents=True, exist_ok=True)
    failures = []
    for r in ep["questions"]:
        local = []
        for i, url in enumerate(r["remote_images"]):
            ext = Path(url.split("?")[0]).suffix or ".png"
            name = f"ep-{r['source_qnum']:03d}-{i}{ext}"
            target = out / name
            if not target.exists():
                try:
                    resp = requests.get(url, timeout=20, headers={"User-Agent": "pmle-prep-local-study/1.0"})
                    resp.raise_for_status()
                    target.write_bytes(resp.content)
                except Exception as e:  # noqa: BLE001
                    failures.append({"source_key": r["source_key"], "url": url, "error": str(e)[:200]})
                    local.append({"remote": url, "local": None})
                    continue
            local.append({"remote": url, "local": f"/question-assets/examprepper/{name}"})
        r["images"] = local
        if any(img["local"] is None for img in local):
            r["issues"].append("image_unresolved")
    return failures


# --------------------------------------------------------------------------- classification

GUIDE_TERMS = {
    # explicit phrases taken from the official guide's considerations, per objective
    "1.1": [r"bigquery ml|bqml", r"automl", r"classification", r"regression", r"forecast", r"cluster", r"feature (engineering|selection)", r"ml\.predict|predictions? (using|with|in) bigquery", r"fine-?tun\w* gemini|gemini .*bigquery"],
    "1.2": [r"model garden", r"document ai", r"vision api|cloud vision", r"translat\w* api|cloud translation", r"gemini", r"imagen", r"\bveo\b", r"models as a service", r"(cost|latency|availability)"],
    "2.1": [r"tabular|text|images?", r"bigquery|dataflow|spark|dataproc|pandas", r"feature store", r"pii|personally identifiable|sensitive|privacy", r"preprocess\w*"],
    "2.2": [r"workbench|notebook", r"colab", r"pytorch|sklearn|scikit|jax", r"model garden", r"collaborat\w*|security"],
    "2.3": [r"experiments?", r"pipelines?", r"kubeflow", r"evaluat\w*|metric", r"llm-as-a-judge|autorater", r"lineage|metadata|artifact|version"],
    "3.1": [r"arima|dnn|llm|neural network", r"automl|bigquery ml|pipelines", r"deploy\w*", r"interpretab\w*|explainab\w*"],
    "3.2": [r"training data|cloud storage|bigquery", r"structured|unstructured", r"custom training|kubeflow|gke|automl|tabular workflows?|sdk", r"troubleshoot\w*|fail\w*|error", r"hyperparameter", r"fine-?tun\w*|tuning"],
    "3.3": [r"\bcpu|\bgpu|\btpu|accelerator", r"distributed", r"data parallel\w*|model parallel\w*"],
    "4.1": [r"batch|online", r"cloud run|gke|model garden", r"pytorch|xgboost|container", r"model registry|version", r"a/b|canary|rollout|traffic split", r"preprocess\w*|postprocess\w*"],
    "4.2": [r"feature store", r"public endpoint|private endpoint|endpoint", r"\bcpu|\bgpu|\btpu|edge", r"scal\w*|throughput|latency", r"production"],
    "5.1": [r"validat\w*", r"pipelines?|airflow|composer|\bray\b|kubeflow", r"template", r"consistent|training-serving|skew"],
    "5.2": [r"retrain\w*", r"ci/cd|continuous (integration|delivery|deployment|training)|cloud build"],
    "6.1": [r"exfiltrat\w*|leak", r"prompt|malicious", r"regex|safety filter|model armor", r"bias|fair\w*|responsible", r"explain\w*|attribution"],
    "6.2": [r"model monitoring|monitor\w*", r"skew|drift", r"evaluat\w*|test\w*", r"gen ai|generative|llm"],
}
STATUS_FACTOR = {"explicit": 1.0, "prerequisite": 0.8, "supplementary": 0.5}
FIELD_W = {"stem": 1.0, "correct": 0.6, "other": 0.25}


def compile_concepts(concepts):
    out = []
    for c in concepts:
        kws = []
        for k in c["keywords"]:
            pat, w = k, 1.0
            m = re.match(r"^(.*):(\d+(?:\.\d+)?)$", k)
            if m:
                pat, w = m.group(1), float(m.group(2))
            kws.append((re.compile(r"(?<![a-z0-9])(?:" + pat + r")(?![a-z0-9])", re.I), float(w), pat))
        out.append((c, kws))
    return out


def classify(rec, compiled, objectives_by_code, legacy_hits):
    stem = nfkc(rec["stem"]).lower()
    correct = set(rec.get("answer_primary") or [])
    corr_txt = " ".join(o["text"] for o in rec["options"] if o["label"] in correct).lower()
    other_txt = " ".join(o["text"] for o in rec["options"] if o["label"] not in correct).lower()
    fields = {"stem": stem, "correct": corr_txt, "other": other_txt}

    concept_scores = {}
    concept_terms = {}
    for c, kws in compiled:
        s, terms = 0.0, []
        for rx, w, pat in kws:
            best = 0.0
            for fname, txt in fields.items():
                if txt and rx.search(txt):
                    best = max(best, FIELD_W[fname])
            if best:
                s += w * best
                terms.append(pat.split("|")[0].replace("\\b", "").replace("\\", ""))
        if s:
            concept_scores[c["id"]] = s
            concept_terms[c["id"]] = terms

    concepts_by_id = {c["id"]: c for c, _ in compiled}
    obj_scores = defaultdict(float)
    obj_explicit = defaultdict(float)
    obj_prereq = defaultdict(float)
    for cid, s in concept_scores.items():
        c = concepts_by_id[cid]
        f = STATUS_FACTOR[c["guideStatus"]]
        obj_scores[c["objective"]] += s * f
        if c["guideStatus"] == "explicit":
            obj_explicit[c["objective"]] += s
        else:
            obj_prereq[c["objective"]] += s
        for sec in c.get("secondaryObjectives", []):
            obj_scores[sec] += s * f * 0.4

    ranked = sorted(obj_scores.items(), key=lambda kv: (-kv[1], kv[0]))
    if not ranked:
        return {
            "status": "unmapped", "primary_objective": None, "secondary_objectives": [], "topic": None,
            "subtopic": None, "concepts": [], "alignment": 0.05, "alignment_band": band(0.05),
            "confidence": "low", "confidence_value": 0.0,
            "explanation": "No guide concept keywords matched this question; needs manual classification.",
            "evidence": None, "needs_review": True,
        }
    top_code, top = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = (top - second) / top if top else 0
    conf_val = round(min(1.0, top / 6) * 0.5 + margin * 0.5, 2)
    confidence = "high" if (top >= 4 and margin >= 0.35) else "medium" if (top >= 2 and margin >= 0.15) else "low"
    secondary = [code for code, s in ranked[1:4] if s >= 0.5 * top][:2]

    in_primary = sorted(((cid, s) for cid, s in concept_scores.items()
                         if concepts_by_id[cid]["objective"] == top_code), key=lambda kv: -kv[1])
    best_cid = in_primary[0][0] if in_primary else max(concept_scores, key=concept_scores.get)
    linked = [cid for cid, s in sorted(concept_scores.items(), key=lambda kv: -kv[1]) if s >= 1.5][:5]
    if best_cid not in linked:
        linked = [best_cid] + linked[:4]

    # guide-term evidence (literal phrases from the official considerations)
    full = stem + " " + corr_txt
    hits = []
    obj = objectives_by_code[top_code]
    for pat in GUIDE_TERMS.get(top_code, []):
        m = re.search(pat, full)
        if m:
            hits.append(m.group(0))
    evidence_bullet = None
    for cons in obj["considerations"]:
        cl = cons.lower()
        if any(h.lower() in cl for h in hits):
            evidence_bullet = cons
            break
    E, P = obj_explicit.get(top_code, 0.0), obj_prereq.get(top_code, 0.0)
    alignment = 0.15 + 0.45 * min(1.0, E / 6) + 0.25 * min(1.0, len(set(hits)) / 3) + 0.15 * min(1.0, P / 4)
    sev = max([h["severity"] for h in legacy_hits], default=0)
    penalty = 0.15 if sev >= 2 else 0.05 if sev == 1 else 0.0
    alignment = round(max(0.0, min(1.0, alignment - penalty)), 2)

    parts = [f"Primary objective {top_code} ({obj['title']}) scored {top:.1f}"]
    if second:
        parts.append(f"next best {ranked[1][0]} scored {second:.1f}")
    parts.append("concepts: " + ", ".join(concepts_by_id[c]["name"] for c in linked[:3]))
    if hits:
        parts.append("guide terms: " + ", ".join(sorted(set(hits))[:6]))
    if penalty:
        parts.append(f"legacy penalty -{penalty:.2f}")
    return {
        "status": "mapped",
        "primary_objective": top_code,
        "secondary_objectives": secondary,
        "topic": concepts_by_id[best_cid]["category"],
        "subtopic": concepts_by_id[best_cid]["name"],
        "concepts": linked,
        "matched_terms": {cid: concept_terms[cid][:6] for cid in linked},
        "alignment": alignment,
        "alignment_band": band(alignment),
        "confidence": confidence,
        "confidence_value": conf_val,
        "explanation": "; ".join(parts) + ".",
        "evidence": evidence_bullet or (obj["considerations"][0] if obj["considerations"] else obj["title"]),
        "needs_review": confidence == "low",
    }


def band(a):
    if a >= 0.9:
        return "direct"
    if a >= 0.75:
        return "strong"
    if a >= 0.5:
        return "moderate"
    if a >= 0.25:
        return "indirect"
    return "weak"


def detect_legacy(rec, rules):
    txt = nfkc(rec["stem"] + " " + " ".join(o["text"] for o in rec["options"])).lower()
    hits = []
    for r in rules:
        if re.search(r["pattern"], txt, re.I):
            hits.append({"rule": r["id"], "kind": r["kind"], "severity": r["severity"], "term": r["term"], "modern": r["modern"]})
    # "ai platform" also matches inside "vertex ai platform" contexts; drop if only vertex wording present
    status = "current"
    kinds = {(h["kind"], h["severity"]) for h in hits}
    if any(k == "deprecated" for k, _ in kinds):
        status = "deprecated_feature"
    elif any(k == "possibly_outdated" for k, _ in kinds):
        status = "possibly_outdated"
    elif any(k == "renamed" and s >= 1 for k, s in kinds):
        status = "renamed_service"
    elif hits:
        status = "renamed_terminology"
    return status, hits


# --------------------------------------------------------------------------- answers

def answer_claims(rec):
    """Return (claims, primary_answer, status, note) for a single source record."""
    claims = []
    if rec["source"] == "pdf":
        if rec["answer"]:
            claim = {"kind": "pdf_key", "labels": rec["answer"], "weight": 1.0}
            if "multi_select_incomplete" in rec["issues"]:
                claim["incomplete"] = True
            claims.append(claim)
    else:
        if rec["answer_site"]:
            claims.append({"kind": "examprepper_answer", "labels": rec["answer_site"], "weight": 1.0})
        if rec["answer_examtopics"] and rec["answer_examtopics"] != rec["answer_site"]:
            claims.append({"kind": "examtopics_key", "labels": rec["answer_examtopics"], "weight": 0.6})
        labeled = [v for v in rec["votes"] if v["labels"]]
        if labeled:
            top = max(labeled, key=lambda v: v["percent"])
            claims.append({"kind": "community_vote", "labels": top["labels"], "weight": 0.5,
                           "percent": top["percent"],
                           "distribution": rec["votes"]})
    primary = claims[0]["labels"] if claims else []
    return claims, primary


# --------------------------------------------------------------------------- dedup

def option_similarity(a, b):
    """Mean best-match similarity between two option lists (order-insensitive)."""
    if not a or not b:
        return 0.0
    na = [norm_text(o["text"]) for o in a]
    nb = [norm_text(o["text"]) for o in b]
    m = cdist(na, nb, scorer=fuzz.ratio)
    s1 = sum(max(row) for row in m) / len(na)
    s2 = sum(max(m[i][j] for i in range(len(na))) for j in range(len(nb))) / len(nb)
    return round(float(min(s1, s2)), 1)


def dedupe(records):
    keys = [r["source_key"] for r in records]
    stems = [norm_text(r["stem"]) for r in records]
    full = [stems[i] + " || " + " | ".join(sorted(norm_text(o["text"]) for o in r["options"])) for i, r in enumerate(records)]
    exact_hash = [sha(f) for f in full]
    stem_hash = [sha(s) for s in stems]
    for r, h, sh in zip(records, exact_hash, stem_hash):
        r["content_hash"] = h
        r["stem_hash"] = sh

    pairs = {}

    def add(i, j, **kw):
        a, b = sorted((i, j))
        k = (keys[a], keys[b])
        if k not in pairs or kw.get("score", 0) > pairs[k]["score"]:
            pairs[k] = {"a": keys[a], "b": keys[b], **kw}

    # Stage 1: exact
    by_hash = defaultdict(list)
    for i, h in enumerate(exact_hash):
        by_hash[h].append(i)
    for idx in by_hash.values():
        for x in range(len(idx)):
            for y in range(x + 1, len(idx)):
                add(idx[x], idx[y], stage="exact", score=100.0, stem_ratio=100.0, option_sim=100.0,
                    decision="auto_confirmed", reason="Identical normalized stem and option set")

    # Stage 2: fuzzy (stem Levenshtein ratio + option similarity)
    ratio = cdist(stems, stems, scorer=fuzz.ratio, workers=-1)
    tset = cdist(stems, stems, scorer=fuzz.token_set_ratio, workers=-1)
    n = len(records)
    for i in range(n):
        for j in range(i + 1, n):
            r, t = float(ratio[i][j]), float(tset[i][j])
            if max(r, t) < 75:
                continue
            if (keys[i], keys[j]) in pairs and pairs[(keys[i], keys[j])]["stage"] == "exact":
                continue
            osim = option_similarity(records[i]["options"], records[j]["options"])
            score = round(0.6 * r + 0.4 * osim, 1)
            if r >= 90 and osim >= 85:
                add(i, j, stage="fuzzy", score=score, stem_ratio=round(r, 1), option_sim=osim,
                    decision="auto_confirmed", reason=f"Stem ratio {r:.0f} and option similarity {osim:.0f} above auto-merge thresholds (90/85)")
            elif (r >= 80 and osim >= 70) or (t >= 92 and osim >= 85):
                add(i, j, stage="fuzzy", score=score, stem_ratio=round(r, 1), option_sim=osim,
                    decision="pending", reason=f"Near match (stem {r:.0f}, token-set {t:.0f}, options {osim:.0f}); wording or options differ - review")

    # Stage 3: semantic candidates (TF-IDF cosine on stem + options)
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True, stop_words="english")
    X = vec.fit_transform(full)
    sim = cosine_similarity(X)
    for i in range(n):
        for j in range(i + 1, n):
            c = float(sim[i][j])
            if c < 0.55:
                continue
            k = (keys[i], keys[j])
            if k in pairs:
                pairs[k]["cosine"] = round(c, 3)
                continue
            osim = option_similarity(records[i]["options"], records[j]["options"])
            if osim < 55 and c < 0.7:
                continue
            add(i, j, stage="semantic", score=round(c * 100, 1), stem_ratio=round(float(ratio[i][j]), 1),
                option_sim=osim, cosine=round(c, 3), decision="pending",
                reason=f"Similar scenario (TF-IDF cosine {c:.2f}, options {osim:.0f}); not auto-merged - confirm same scenario and answer")
    idx = {k: i for i, k in enumerate(keys)}
    for p in pairs.values():
        p.setdefault("cosine", round(float(sim[idx[p["a"]]][idx[p["b"]]]), 3))

    # Decision refinement: one-to-one cross-source matching, numeric guard, answer guard,
    # and same-source variants are never auto-merged.
    def numbers(r):
        txt = nfkc(r["stem"] + " " + " ".join(o["text"] for o in r["options"])).lower()
        return set(re.findall(r"\d+", re.sub(r"\[\[img:\d+\]\]", " ", txt)))

    nums = {k: numbers(records[idx[k]]) for k in keys}
    matched = set()
    ordered = sorted(pairs.values(), key=lambda p: (p["stage"] != "exact", -p["stem_ratio"], -p["option_sim"], p["a"], p["b"]))
    for p in ordered:
        ra, rb = records[idx[p["a"]]], records[idx[p["b"]]]
        same_source = ra["source"] == rb["source"]
        num_diff = sorted(nums[p["a"]] ^ nums[p["b"]])
        p["number_mismatch"] = num_diff[:10]
        ans_a = mapped_answer_texts(ra)
        ans_b = mapped_answer_texts(rb)
        partial = "multi_select_incomplete" in ra["issues"] or "multi_select_incomplete" in rb["issues"]
        p["answers_agree"] = bool(ans_a and ans_b and answer_sets_match(ans_a, ans_b, subset_ok=partial))
        if same_source:
            if p["stage"] == "exact":
                p["decision"] = "pending"
                p["reason"] = "Identical text appears twice in the same source - confirm it is a true duplicate"
            else:
                p["decision"] = "auto_rejected"
                p["reason"] = f"Same-source variant: distinct question numbers in one bank ({p['reason']})"
            continue
        if p["decision"] != "auto_confirmed":
            continue
        if p["a"] in matched or p["b"] in matched:
            p["decision"] = "auto_rejected"
            p["reason"] = "Each record already has a closer cross-source counterpart; this is likely a variant question"
            continue
        if p["stage"] != "exact" and num_diff:
            p["decision"] = "pending"
            p["reason"] = f"Wording nearly identical but numbers differ ({', '.join(num_diff[:5])}) - review"
            continue
        if p["stage"] != "exact" and ans_a and ans_b and not p["answers_agree"]:
            p["decision"] = "pending"
            p["reason"] = "Near match whose answer keys disagree - may be a variant question; review"
            continue
        matched.update((p["a"], p["b"]))
    for p in pairs.values():
        cross = records[idx[p["a"]]]["source"] != records[idx[p["b"]]]["source"]
        if cross and p["decision"] == "pending" and (p["a"] in matched or p["b"] in matched):
            p["decision"] = "auto_rejected"
            p["reason"] = "One side already has a confirmed cross-source counterpart; likely a variant question (" + p["reason"] + ")"
    return sorted(pairs.values(), key=lambda p: (-p["score"], p["a"], p["b"]))


def mapped_answer_texts(r):
    labs = set(r.get("answer_primary") or [])
    return [norm_text(o["text"]) for o in r["options"] if o["label"] in labs]


def answer_sets_match(a, b, subset_ok=False):
    def covered(xs, ys):
        return all(max(fuzz.ratio(x, y) for y in ys) >= 85 for x in xs)

    if len(a) == len(b):
        return covered(a, b)
    if subset_ok:
        small, big = (a, b) if len(a) < len(b) else (b, a)
        return covered(small, big)
    return False


def clusters_from(pairs, keys):
    parent = {k: k for k in keys}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in pairs:
        if p["decision"] == "auto_confirmed":
            ra, rb = find(p["a"]), find(p["b"])
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    groups = defaultdict(list)
    for k in keys:
        groups[find(k)].append(k)
    return list(groups.values())


# --------------------------------------------------------------------------- main

def main():
    PROC.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)

    extract_pdf.main()
    pdf = json.loads((PROC / "pdf_questions.json").read_text())
    taxonomy = parse_guide()
    concepts = json.loads((TAXO / "theory_concepts.json").read_text())["concepts"]
    rules = json.loads((TAXO / "legacy_rules.json").read_text())["rules"]
    objectives_by_code = {o["code"]: o for d in taxonomy["domains"] for o in d["objectives"]}
    for c in concepts:
        assert c["objective"] in objectives_by_code, c["id"]
    taxonomy["concept_count"] = len(concepts)
    (PROC / "taxonomy.json").write_text(json.dumps(taxonomy, indent=1, ensure_ascii=False))

    ep = parse_examprepper()
    img_failures = localize_images(ep)
    (PROC / "examprepper_questions.json").write_text(json.dumps(ep, indent=1, ensure_ascii=False))

    records = []
    for q in pdf["questions"]:
        r = dict(q)
        r["source_key"] = f"pdf:{q['source_qnum']}"
        r["url"] = None
        r["page"] = q["page_start"]
        r["topic_label"] = q["pdf_topic"]
        r["images"] = []
        r["discussion"] = []
        r["issues"] = list(q["issues"])
        if re.search(r"\b(exhibit|diagram|shown (below|above|in the)|following (image|diagram|table|code|figure)|see the)\b", q["stem"], re.I):
            r["issues"].append("references_missing_exhibit")
        records.append(r)
    records += ep["questions"]

    compiled = compile_concepts(concepts)
    for r in records:
        claims, primary = answer_claims(r)
        r["claims"] = claims
        r["answer_primary"] = primary
        r["multi_select"] = len(primary) > 1
        status, hits = detect_legacy(r, rules)
        r["legacy_status"] = status
        r["legacy_hits"] = hits
        r["classification"] = classify(r, compiled, objectives_by_code, hits)

    pairs = dedupe(records)
    keys = [r["source_key"] for r in records]
    groups = clusters_from(pairs, keys)
    src_of = {r["source_key"]: r["source"] for r in records}
    cross = [g for g in groups if {src_of[k] for k in g} == {"pdf", "examprepper"}]
    intra = [g for g in groups if len(g) > 1 and len({src_of[k] for k in g}) == 1]

    # Concept -> question coverage for report
    concept_cov = Counter(cid for r in records for cid in r["classification"]["concepts"])

    def cnt(src, pred):
        return sum(1 for r in records if r["source"] == src and pred(r))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "pdf": {
                "file": pdf["source_file"], "pages": pdf["page_count"], "declared_count": pdf["declared_count"],
                "extracted": cnt("pdf", lambda r: True),
                "failed": len(pdf["missing_question_numbers"]),
                "missing_question_numbers": pdf["missing_question_numbers"],
                "missing_answer": cnt("pdf", lambda r: "missing_answer" in r["issues"]),
                "missing_options": cnt("pdf", lambda r: "missing_options" in r["issues"]),
                "with_images": cnt("pdf", lambda r: bool(r["images"])),
                "references_missing_exhibit": cnt("pdf", lambda r: "references_missing_exhibit" in r["issues"]),
                "multi_select_incomplete": cnt("pdf", lambda r: "multi_select_incomplete" in r["issues"]),
                "explanations": cnt("pdf", lambda r: bool(r.get("explanation"))),
            },
            "examprepper": {
                "url": EP_EXAM_URL.format(page=1), "declared_count": ep["declared_count"],
                "expected_pages": ep["expected_pages"], "captured_pages": len(ep["captured_pages"]),
                "missing_pages": ep["missing_pages"],
                "extracted": cnt("examprepper", lambda r: True),
                "failed": (ep["declared_count"] or 0) - cnt("examprepper", lambda r: True),
                "missing_answer": cnt("examprepper", lambda r: "missing_answer" in r["issues"]),
                "missing_options": cnt("examprepper", lambda r: "missing_options" in r["issues"]),
                "with_images": cnt("examprepper", lambda r: bool(r["images"])),
                "image_failures": img_failures,
                "multi_select": cnt("examprepper", lambda r: r["multi_select"]),
                "site_vs_examtopics_key_differs": cnt("examprepper", lambda r: r["answer_examtopics"] and r["answer_examtopics"] != r["answer_site"]),
                "explanations": cnt("examprepper", lambda r: bool(r.get("explanation"))),
                "access_notes": "Pages captured from a normal browser session at a throttled rate; the site returned HTTP 429 when requested faster, after which capture slowed to one page per ~12 s. No robots.txt is published (404).",
            },
            "guide": {"url": GUIDE_URL, "domains": len(taxonomy["domains"]),
                      "objectives": len(objectives_by_code),
                      "considerations": sum(len(o["considerations"]) for o in objectives_by_code.values()),
                      "weights": {d["number"]: d["weight_percent"] for d in taxonomy["domains"]},
                      "weights_sum": taxonomy["weights_sum_percent"]},
        },
        "dedup": {
            "pairs_total": len(pairs),
            "auto_confirmed_pairs": sum(p["decision"] == "auto_confirmed" for p in pairs),
            "pending_review_pairs": sum(p["decision"] == "pending" for p in pairs),
            "by_stage": dict(Counter(p["stage"] for p in pairs)),
            "cross_source_clusters": len(cross),
            "intra_source_duplicate_clusters": len(intra),
            "canonical_estimate": len(groups),
            "note": "Final counts are computed by the DB importer, which also applies user-approved/rejected merges.",
        },
        "classification": {
            "mapped": sum(r["classification"]["status"] == "mapped" for r in records),
            "unmapped": sum(r["classification"]["status"] == "unmapped" for r in records),
            "low_confidence": sum(r["classification"]["confidence"] == "low" for r in records),
            "by_objective": dict(sorted(Counter(r["classification"]["primary_objective"] or "unmapped" for r in records).items())),
            "alignment_bands": dict(Counter(r["classification"]["alignment_band"] for r in records)),
            "concepts_without_questions": [c["id"] for c in concepts if concept_cov[c["id"]] == 0],
        },
        "legacy": dict(Counter(r["legacy_status"] for r in records)),
    }

    bank = {
        "generated_at": report["generated_at"],
        "taxonomy": taxonomy,
        "concepts": concepts,
        "legacy_rules": rules,
        "sources": [{k: r.get(k) for k in (
            "source", "source_key", "source_qnum", "page", "page_start", "page_end", "url", "origin_url",
            "topic_label", "stem", "options", "claims", "answer_primary", "multi_select", "explanation",
            "discussion", "images", "raw_text", "raw", "issues", "extraction_confidence", "content_hash",
            "stem_hash", "legacy_status", "legacy_hits", "classification")} for r in records],
        "duplicate_pairs": pairs,
        "report": report,
    }
    (PROC / "bank.json").write_text(json.dumps(bank, indent=1, ensure_ascii=False))
    (REPORTS / "import_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({k: report[k] for k in ("dedup", "classification", "legacy")}, indent=1))
    print("pdf", report["sources"]["pdf"]["extracted"], "examprepper", report["sources"]["examprepper"]["extracted"],
          "missing_pages", ep["missing_pages"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
