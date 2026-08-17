import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','*')
        self.end_headers()

    def do_GET(self):
        print("GET", self.path, flush=True)
        if self.path.startswith('/api/products'):
            products = [
                {
                    "id":1,"sellingProductId":100,"title":"Test Product",
                    "description":"<script>alert(1)</script> and <img src=x onerror=alert(2)>",
                    "imageUrl":"", "sourceUrl":"javascript:alert(document.domain)",
                    "salePriceKrw":10000,"originalPriceKrw":20000,
                    "marginPct":"50","volume":0,"status":"listed","stock":10,
                    "syncedAt":"2024-01-01T00:00:00Z","createdAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z"
                },
                {
                    "id":2,"sellingProductId":101,"title":"Redirect product",
                    "description":"desc",
                    "imageUrl":"https://sepolia.basescan.org/favicon.ico",
                    "sourceUrl":"//attacker.example/steal",
                    "salePriceKrw":5000,"originalPriceKrw":6000,
                    "marginPct":"16","volume":0,"status":"listed","stock":5,
                    "syncedAt":"2024-01-01T00:00:00Z","createdAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z"
                }
            ]
            if '/api/products/' in self.path:
                pid = int(self.path.split('/')[-1])
                p = next((x for x in products if x['id']==pid), products[0])
                self._send(p)
            else:
                self._send({"products": products})
            return
        self._send({"error":"not found"}, 404)

    def log_message(self, *a):
        pass

HTTPServer(('127.0.0.1', 8095), Handler).serve_forever()
