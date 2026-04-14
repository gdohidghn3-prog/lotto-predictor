/**
 * 로또 데이터 수집 스크립트
 * 1) GitHub CSV (1~913회)
 * 2) superkts.com 개별 페이지 (914~최신)
 * 결과: lotto-data.json
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'lotto-data.json');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// GitHub CSV 파싱 (1~913회, 최신→과거 순)
async function fetchFromGitHub() {
  console.log('[1단계] GitHub CSV 다운로드...');
  const csv = await httpGet('https://raw.githubusercontent.com/ioahKwon/Korean-Lottery-games-Analysis/master/data/lotto.csv');
  const lines = csv.trim().split('\n');
  const results = [];

  // CSV는 최신→과거 순, BOM 제거
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    const nums = line.split(',').map(Number);
    if (nums.length < 7 || nums.some(isNaN)) continue;

    const round = lines.length - i; // 1회차 = 마지막 줄
    results.push({
      round,
      numbers: nums.slice(0, 6).sort((a, b) => a - b),
      bonus: nums[6],
      date: '' // CSV에 날짜 없음
    });
  }

  results.sort((a, b) => a.round - b.round);
  console.log(`[1단계] ${results.length}회차 파싱 완료 (${results[0]?.round}~${results[results.length - 1]?.round}회)`);
  return results;
}

// superkts.com에서 개별 회차 HTML 파싱
async function fetchFromSuperkts(round) {
  try {
    const html = await httpGet(`https://superkts.com/lotto/${round}`);

    // HTML 구조: <span class="n1">숫자</span> (n1~n5 = 번호 구간 색상)
    const numPattern = /<span class="n[1-5]">(\d+)<\/span>/g;
    const nums = [];
    let m;
    while ((m = numPattern.exec(html)) !== null) {
      nums.push(parseInt(m[1]));
    }

    if (nums.length >= 7) {
      return {
        round,
        numbers: nums.slice(0, 6).sort((a, b) => a - b),
        bonus: nums[6],
        date: ''
      };
    }

    console.log(`  [경고] ${round}회 파싱 실패 (n[1-5] 매치: ${nums.length}개)`);
    return null;
  } catch (e) {
    console.log(`  [에러] ${round}회: ${e.message}`);
    return null;
  }
}

// 날짜 계산 (1회차: 2002-12-07, 매주 토요일)
function calcDate(round) {
  const start = new Date('2002-12-07');
  start.setDate(start.getDate() + (round - 1) * 7);
  return start.toISOString().split('T')[0];
}

function calcLatestRound() {
  const start = new Date('2002-12-07');
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

async function main() {
  const latest = calcLatestRound();
  console.log(`\n=== 로또 데이터 수집기 ===`);
  console.log(`예상 최신 회차: ${latest}회\n`);

  // 기존 캐시 로드
  let existing = [];
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`기존 캐시: ${existing.length}회차\n`);
  }

  const existingRounds = new Set(existing.map(e => e.round));

  // 1단계: GitHub CSV
  let data = [];
  if (existing.length === 0) {
    data = await fetchFromGitHub();
  } else {
    data = [...existing];
    console.log('[1단계] 기존 캐시 사용\n');
  }

  const dataRounds = new Set(data.map(d => d.round));

  // 2단계: 빠진 회차 수집 (superkts)
  const missing = [];
  for (let i = 1; i <= latest; i++) {
    if (!dataRounds.has(i)) missing.push(i);
  }

  if (missing.length > 0) {
    console.log(`[2단계] superkts.com에서 ${missing.length}회차 추가 수집...`);

    const batchSize = 5;
    let fetched = 0;
    let failed = 0;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(r => fetchFromSuperkts(r)));

      for (const r of results) {
        if (r) {
          data.push(r);
          fetched++;
        } else {
          failed++;
        }
      }

      if ((i + batchSize) % 50 === 0 || i + batchSize >= missing.length) {
        console.log(`  진행: ${Math.min(i + batchSize, missing.length)}/${missing.length} (성공: ${fetched}, 실패: ${failed})`);
      }

      // 서버 부하 방지
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[2단계] 완료 (성공: ${fetched}, 실패: ${failed})\n`);
  } else {
    console.log('[2단계] 추가 수집 불필요\n');
  }

  // 날짜 보충
  for (const d of data) {
    if (!d.date) d.date = calcDate(d.round);
  }

  // 정렬 및 저장
  data.sort((a, b) => a.round - b.round);

  // 유효성 검증
  const valid = data.filter(d =>
    d.numbers && d.numbers.length === 6 &&
    d.numbers.every(n => n >= 1 && n <= 45) &&
    d.bonus >= 1 && d.bonus <= 45
  );

  console.log(`총 ${valid.length}회차 유효 데이터`);
  console.log(`범위: ${valid[0]?.round}회 ~ ${valid[valid.length - 1]?.round}회`);

  fs.writeFileSync(DATA_FILE, JSON.stringify(valid, null, 0));
  console.log(`\n저장 완료: ${DATA_FILE}`);
  console.log(`파일 크기: ${(fs.statSync(DATA_FILE).size / 1024).toFixed(1)} KB`);
}

main().catch(e => {
  console.error('에러:', e);
  process.exit(1);
});
