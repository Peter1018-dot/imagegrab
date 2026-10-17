#!/usr/bin/env bash
# 生成本地测试用自签名证书（仅用于本地 HTTPS 服务器，不需要提交到仓库）
set -e

cd "$(dirname "$0")"
mkdir -p cert

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout cert/key.pem \
  -out cert/cert.pem \
  -days 825 \
  -subj "//CN=item.taobao.com" \
  -addext "subjectAltName=DNS:item.taobao.com,DNS:img.alicdn.com,DNS:detail.tmall.com,DNS:item.jd.com,DNS:mobile.yangkeduo.com"

echo "证书已生成：tests/cert/cert.pem"
