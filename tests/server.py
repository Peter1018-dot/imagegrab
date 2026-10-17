"""本地 HTTPS 测试服务器：模拟 item.taobao.com 商品详情页与 img.alicdn.com 图片 CDN。"""

import http.server
import os
import ssl
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
EXT_ROOT = os.path.join(os.path.dirname(ROOT), "extension")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path)
        route = parsed.path

        if route in ("/", "/item.htm", "/item.html", "/detail.htm"):
            return os.path.join(ROOT, "mock-page.html")
        if route.startswith("/product-"):
            return os.path.join(ROOT, "mock-images", os.path.basename(route))
        if route == "/logo.png":
            return os.path.join(EXT_ROOT, "icons", "icon128.png")
        if route == "/tiny.png":
            return os.path.join(ROOT, "tiny.png")
        return os.path.join(ROOT, os.path.basename(route))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[server] " + (fmt % args), flush=True)


def main():
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(os.path.join(ROOT, "cert", "cert.pem"), os.path.join(ROOT, "cert", "key.pem"))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"[server] serving https://127.0.0.1:{PORT} (item.taobao.com / img.alicdn.com)", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
