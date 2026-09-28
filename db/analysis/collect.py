#!/usr/bin/env python3
"""
앱이 보내는 측정값을 받아 적는다 (§13.77).

기기(=앱의 실제 코드 경로)에서 잰 값을 맥으로 가져오는 가장 짧은 길이다.
`http.server` 는 POST 를 안 받으므로 이 15줄이 필요하다.
"""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/calib.jsonl"

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        body = self.rfile.read(n).decode("utf-8")
        with open(OUT, "a") as f:
            for row in json.loads(body):
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *a): pass

if __name__ == "__main__":
    open(OUT, "w").close()
    print(f"수집 대기 :5199 → {OUT}")
    HTTPServer(("127.0.0.1", 5199), H).serve_forever()
