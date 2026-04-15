#!/bin/bash
cd "$(dirname "$0")"

echo "========================================="
echo "  로또 예측기 기동"
echo "========================================="

# 1) 데이터 최신화
echo ""
echo "[1/2] 데이터 업데이트..."
node fetch-data.js
if [ $? -ne 0 ]; then
  echo "[오류] 데이터 수집 실패"
  exit 1
fi

# 2) 서버 기동
echo ""
echo "[2/2] 서버 시작..."
node server.js
