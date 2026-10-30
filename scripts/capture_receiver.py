"""Local receiver used while paging through ExamPrepper in a real browser.

The browser (already past the site's normal browser check) POSTs each page's
embedded JSON here; this server only writes files under data/raw/examprepper.

Usage: python scripts/capture_receiver.py  (listens on 127.0.0.1:8765)
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "examprepper"
OUT.mkdir(parents=True, exist_ok=True)
ALLOWED_ORIGIN = "https://www.examprepper.co"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        name = q.get("name", [""])[0]
        if not re.fullmatch(r"[a-zA-Z0-9_.\-]+", name):
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        target = OUT / name
        if name.endswith(".json"):
            json.loads(body)  # validate
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")
        sys.stdout.write(f"saved {name} ({len(body)} bytes)\n")
        sys.stdout.flush()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
