"""Serve the fictional reference on loopback only; no cloud actions or file uploads."""
import argparse,json,subprocess
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/': data=(ROOT/'preview/index.html').read_bytes();kind='text/html; charset=utf-8'
        elif self.path=='/data.json':
            run=subprocess.run(['node','--experimental-strip-types','scripts/demo.mjs'],cwd=ROOT,capture_output=True,text=True,check=True)
            data=json.dumps(json.loads(run.stdout)).encode();kind='application/json'
        else: self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(data)
    def log_message(self,*args): pass
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=8141);a=p.parse_args()
    print(f'Local reference: http://127.0.0.1:{a.port}',flush=True)
    HTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
