"""Per-page text extraction for a PDF (PyMuPDF), with OCR for scanned pages when tesseract is available.

Used by scripts/verify-exam-weights.ts to read the official exam guide.

    python scripts/pdf_extract.py <file.pdf> [--tesseract <bin>] [--max-pages N]

Prints one JSON object: {"page_count", "pages": [{"page", "text", "method", "confidence"}], "warnings", "error"?}.
The input file is only read. Pages without a text layer are rendered and OCR'd; if OCR is unavailable they are
reported as empty instead of silently skipping content.
"""

import json
import shutil
import subprocess
import sys

try:
    import pymupdf  # PyMuPDF >= 1.24
except ImportError:  # pragma: no cover - older installs
    try:
        import fitz as pymupdf  # type: ignore
    except ImportError:
        print(json.dumps({"error": "ENGINE_UNAVAILABLE", "message": "PyMuPDF is not installed for the Python interpreter the server uses. Set INGEST_PYTHON to a Python 3 interpreter that has PyMuPDF (for example a virtualenv's bin/python after pip install pymupdf), then retry."}))
        sys.exit(0)

MIN_TEXT_CHARS = 40


def ocr_page(page, tesseract):
    pix = page.get_pixmap(dpi=200)
    png = pix.tobytes("png")
    proc = subprocess.run([tesseract, "stdin", "stdout", "--psm", "4", "tsv"], input=png, capture_output=True, timeout=180)
    if proc.returncode != 0:
        return None, 0.0
    lines, confs = {}, []
    for row in proc.stdout.decode("utf8", "replace").split("\n")[1:]:
        c = row.split("\t")
        if len(c) < 12 or c[0] != "5":
            continue
        word = "\t".join(c[11:]).strip()
        if not word:
            continue
        lines.setdefault((c[1], c[2], c[3], c[4]), []).append(word)
        try:
            conf = float(c[10])
            if conf >= 0:
                confs.append(conf)
        except ValueError:
            pass
    text = "\n".join(" ".join(w) for w in lines.values())
    return text, (sum(confs) / len(confs) / 100.0) if confs else 0.0


def main():
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "INVALID_FILE", "message": "No file given."}))
        return
    path = args[0]
    tesseract = args[args.index("--tesseract") + 1] if "--tesseract" in args else "tesseract"
    max_pages = int(args[args.index("--max-pages") + 1]) if "--max-pages" in args else 2000
    tesseract_ok = shutil.which(tesseract) is not None
    try:
        doc = pymupdf.open(path)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": "INVALID_FILE", "message": f"Not a readable PDF ({type(e).__name__})."}))
        return
    if doc.needs_pass:
        print(json.dumps({"error": "INVALID_FILE", "message": "The PDF is password-protected; protected files are not processed."}))
        return
    warnings, pages = [], []
    if doc.page_count > max_pages:
        warnings.append(f"Only the first {max_pages} of {doc.page_count} pages were processed.")
    ocr_missing = []
    for i in range(min(doc.page_count, max_pages)):
        page = doc[i]
        text = page.get_text("text", sort=True) or ""
        if len(text.strip()) >= MIN_TEXT_CHARS:
            pages.append({"page": i + 1, "text": text, "method": "pdf_text", "confidence": 0.95})
            continue
        if tesseract_ok:
            try:
                otext, conf = ocr_page(page, tesseract)
            except Exception:  # noqa: BLE001
                otext, conf = None, 0.0
            if otext and otext.strip():
                pages.append({"page": i + 1, "text": otext, "method": "pdf_ocr", "confidence": round(min(conf, 0.85), 2)})
                continue
        if text.strip():
            pages.append({"page": i + 1, "text": text, "method": "pdf_text", "confidence": 0.6})
        elif page.get_images():
            ocr_missing.append(i + 1)
    if ocr_missing:
        hint = "OCR produced no text" if tesseract_ok else "tesseract is not installed, so they were not OCR'd"
        warnings.append(f"{len(ocr_missing)} page(s) look scanned ({hint}): {', '.join(map(str, ocr_missing[:40]))}.")
    print(json.dumps({"page_count": doc.page_count, "pages": pages, "warnings": warnings, "scanned_pages": ocr_missing, "ocr_available": tesseract_ok}))


if __name__ == "__main__":
    main()
