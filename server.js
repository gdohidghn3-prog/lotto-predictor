const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'lotto-data.json');

// --- 데이터 캐시 ---
let lottoCache = [];

// 파일에서 로드
function loadCache() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      lottoCache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`[데이터] ${lottoCache.length}회차 로드 (최신: ${lottoCache[lottoCache.length - 1]?.round}회)`);
    }
  } catch (e) {
    console.log('[데이터] 로드 실패:', e.message);
  }
}

function saveCache() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(lottoCache));
}

function calcLatestRound() {
  const start = new Date('2002-12-07');
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function calcDate(round) {
  const start = new Date('2002-12-07');
  start.setDate(start.getDate() + (round - 1) * 7);
  return start.toISOString().split('T')[0];
}

// superkts.com에서 개별 회차 수집
// HTML 구조: <span class="n1">번호</span> (n1~n5 = 번호 구간 색상)
function fetchFromSuperkts(round) {
  return new Promise((resolve) => {
    https.get(`https://superkts.com/lotto/${round}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => {
        try {
          // <span class="n1">숫자</span> 패턴 (n1~n5 클래스)
          const pattern = /<span class="n[1-5]">(\d+)<\/span>/g;
          const nums = [];
          let m;
          while ((m = pattern.exec(html)) !== null) nums.push(parseInt(m[1]));
          if (nums.length >= 7) {
            resolve({
              round,
              numbers: nums.slice(0, 6).sort((a, b) => a - b),
              bonus: nums[6],
              date: calcDate(round)
            });
          } else {
            console.log(`[경고] ${round}회 파싱 실패 (n[1-5] 매치: ${nums.length}개)`);
            resolve(null);
          }
        } catch { resolve(null); }
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// 새 회차 업데이트
async function updateData() {
  const latest = calcLatestRound();
  const cachedRounds = new Set(lottoCache.map(d => d.round));
  const missing = [];

  for (let i = 1; i <= latest; i++) {
    if (!cachedRounds.has(i)) missing.push(i);
  }

  if (missing.length === 0) {
    console.log('[업데이트] 최신 상태');
    return 0;
  }

  console.log(`[업데이트] ${missing.length}회차 수집 중...`);
  let count = 0;

  for (let i = 0; i < missing.length; i += 5) {
    const batch = missing.slice(i, i + 5);
    const results = await Promise.all(batch.map(r => fetchFromSuperkts(r)));
    for (const r of results) {
      if (r) { lottoCache.push(r); count++; }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (count > 0) {
    lottoCache.sort((a, b) => a.round - b.round);
    saveCache();
    console.log(`[업데이트] ${count}회차 추가 완료`);
  }

  return count;
}

// --- 분석/예측 엔진: lib/engine.js 사용 ---
const { analyze, predict } = require('./lib/engine');

// --- (아래 인라인 analyze/predict는 더 이상 사용되지 않음) ---
function _analyze_legacy(data) {
  if (!data.length) return null;

  const totalRounds = data.length;

  // 1) 번호별 출현 빈도
  const freq = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) freq[n]++;

  // 2) 최근 20회 핫넘버
  const recentN = Math.min(20, totalRounds);
  const recent = data.slice(-recentN);
  const recentFreq = Array(46).fill(0);
  for (const d of recent) for (const n of d.numbers) recentFreq[n]++;

  // 3) 미출현 간격
  const lastSeen = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
  const latestRound = data[data.length - 1].round;
  const gap = Array(46).fill(0);
  for (let i = 1; i <= 45; i++) gap[i] = latestRound - lastSeen[i];

  // 4) 구간 분포
  const ranges = [0, 0, 0, 0, 0];
  for (const d of data) {
    for (const n of d.numbers) {
      if (n <= 10) ranges[0]++;
      else if (n <= 20) ranges[1]++;
      else if (n <= 30) ranges[2]++;
      else if (n <= 40) ranges[3]++;
      else ranges[4]++;
    }
  }

  // 5) 홀짝 비율
  const oddCounts = Array(7).fill(0);
  for (const d of data) {
    const odds = d.numbers.filter(n => n % 2 === 1).length;
    oddCounts[odds]++;
  }

  // 6) 합계 분포
  const sums = data.map(d => d.numbers.reduce((a, b) => a + b, 0));
  const avgSum = Math.round(sums.reduce((a, b) => a + b, 0) / sums.length);

  // 7) 연속번호 출현율
  let consecutiveCount = 0;
  for (const d of data) {
    for (let i = 0; i < d.numbers.length - 1; i++) {
      if (d.numbers[i + 1] - d.numbers[i] === 1) { consecutiveCount++; break; }
    }
  }

  // 8) 끝수 분석
  const lastDigit = Array(10).fill(0);
  for (const d of data) for (const n of d.numbers) lastDigit[n % 10]++;

  // 9) 동반 출현 쌍
  const pairs = {};
  for (const d of data) {
    for (let i = 0; i < d.numbers.length; i++) {
      for (let j = i + 1; j < d.numbers.length; j++) {
        const key = `${d.numbers[i]}-${d.numbers[j]}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
  const topPairs = Object.entries(pairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, v]) => ({ pair: k, count: v }));

  return {
    totalRounds,
    latestRound,
    latestDate: data[data.length - 1].date,
    frequency: freq.slice(1).map((f, i) => ({ number: i + 1, count: f, rate: +(f / totalRounds * 100).toFixed(1) })),
    recentHot: recentFreq.slice(1)
      .map((f, i) => ({ number: i + 1, count: f }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    coldNumbers: gap.slice(1)
      .map((g, i) => ({ number: i + 1, gap: g }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 15),
    ranges: ranges.map((r, i) => ({
      label: ['1-10', '11-20', '21-30', '31-40', '41-45'][i],
      count: r,
      rate: +(r / (totalRounds * 6) * 100).toFixed(1)
    })),
    oddEven: oddCounts.map((c, i) => ({ odd: i, even: 6 - i, count: c, rate: +(c / totalRounds * 100).toFixed(1) })),
    sumStats: { avg: avgSum, min: Math.min(...sums), max: Math.max(...sums) },
    consecutiveRate: +(consecutiveCount / totalRounds * 100).toFixed(1),
    lastDigit: lastDigit.map((c, i) => ({ digit: i, count: c })),
    topPairs,
    recentDraws: data.slice(-10).reverse()
  };
}

// --- (legacy) 패턴 분석 엔진 ---
function _discoverPatterns_legacy(data) {
  const patterns = [];
  const totalRounds = data.length;
  const latestRound = data[data.length - 1].round;

  // 1) 번호 후속 패턴: 직전 회차에 X가 나왔을 때, 다음 회차에 Y가 나올 확률
  const followMap = {}; // { X: { Y: count } }
  for (let i = 0; i < data.length - 1; i++) {
    for (const prev of data[i].numbers) {
      if (!followMap[prev]) followMap[prev] = {};
      for (const next of data[i + 1].numbers) {
        followMap[prev][next] = (followMap[prev][next] || 0) + 1;
      }
    }
  }

  // 2) 주기 패턴: 각 번호의 평균 출현 주기
  const appearances = {};
  for (const d of data) {
    for (const n of d.numbers) {
      if (!appearances[n]) appearances[n] = [];
      appearances[n].push(d.round);
    }
  }
  const cycles = {};
  for (let n = 1; n <= 45; n++) {
    const app = appearances[n] || [];
    if (app.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < app.length; i++) gaps.push(app[i] - app[i - 1]);
    cycles[n] = {
      avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1),
      last: latestRound - app[app.length - 1],
      count: app.length
    };
  }

  // 주기 도래 번호: 평균 주기에 가까워진 번호
  const dueCycle = [];
  for (let n = 1; n <= 45; n++) {
    if (!cycles[n]) continue;
    const ratio = cycles[n].last / cycles[n].avg; // 1.0 = 정확히 주기 도래
    if (ratio >= 0.8) {
      dueCycle.push({ number: n, avgCycle: cycles[n].avg, sinceLastDraw: cycles[n].last, dueRatio: +ratio.toFixed(2) });
    }
  }
  dueCycle.sort((a, b) => b.dueRatio - a.dueRatio);

  // 3) 합계 구간 패턴: 가장 많이 당첨된 합계 범위
  const sumBuckets = {};
  for (const d of data) {
    const s = d.numbers.reduce((a, b) => a + b, 0);
    const bucket = Math.floor(s / 20) * 20; // 20 단위
    const key = `${bucket}-${bucket + 19}`;
    sumBuckets[key] = (sumBuckets[key] || 0) + 1;
  }
  const bestSumRange = Object.entries(sumBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => ({ range: k, count: v, rate: +(v / totalRounds * 100).toFixed(1) }));

  // 4) 홀짝 최적 비율
  const oddEvenCounts = Array(7).fill(0);
  for (const d of data) {
    const odds = d.numbers.filter(n => n % 2 === 1).length;
    oddEvenCounts[odds]++;
  }
  const bestOddEven = oddEvenCounts
    .map((c, i) => ({ odd: i, even: 6 - i, count: c, rate: +(c / totalRounds * 100).toFixed(1) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // 5) 연속번호 쌍 패턴
  const consecPairs = {};
  for (const d of data) {
    for (let i = 0; i < d.numbers.length - 1; i++) {
      if (d.numbers[i + 1] - d.numbers[i] === 1) {
        const key = `${d.numbers[i]}-${d.numbers[i + 1]}`;
        consecPairs[key] = (consecPairs[key] || 0) + 1;
      }
    }
  }
  const topConsecPairs = Object.entries(consecPairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => ({ pair: k, count: v }));

  // 6) 끝수 동반 패턴: 같은 끝수 2개 이상 포함 비율
  let sameEndCount = 0;
  for (const d of data) {
    const ends = d.numbers.map(n => n % 10);
    const endSet = new Set(ends);
    if (endSet.size < 6) sameEndCount++; // 끝수 겹침 있음
  }

  // 7) AC값 분석 (Arithmetic Complexity - 번호 간 차이의 고유값 수)
  const acValues = [];
  for (const d of data) {
    const diffs = new Set();
    for (let i = 0; i < d.numbers.length; i++) {
      for (let j = i + 1; j < d.numbers.length; j++) {
        diffs.add(d.numbers[j] - d.numbers[i]);
      }
    }
    acValues.push(diffs.size);
  }
  const avgAC = +(acValues.reduce((a, b) => a + b, 0) / acValues.length).toFixed(1);
  const acDistrib = {};
  for (const ac of acValues) acDistrib[ac] = (acDistrib[ac] || 0) + 1;
  const bestAC = Object.entries(acDistrib)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => ({ ac: +k, count: v, rate: +(v / totalRounds * 100).toFixed(1) }));

  return {
    followMap,
    cycles,
    dueCycle: dueCycle.slice(0, 15),
    bestSumRange,
    bestOddEven,
    topConsecPairs,
    sameEndDigitRate: +(sameEndCount / totalRounds * 100).toFixed(1),
    acStats: { avg: avgAC, best: bestAC }
  };
}

// --- 예측 엔진 ---
// 5가지 완전히 다른 분석 방법 → 중복 최소화
function _predict_legacy(data) {
  if (!data.length) return [];

  const totalRounds = data.length;
  const latestRound = data[data.length - 1].round;
  const lastDraw = data[data.length - 1].numbers;
  const patterns = discoverPatterns(data);

  // 공통 유틸
  function makeResult(numbers, strategy, reason) {
    numbers.sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const odds = numbers.filter(n => n % 2 === 1).length;
    return { numbers, strategy, reason, sum, oddEven: `${odds}:${6 - odds}` };
  }

  const sets = [];

  // ============================================
  // A) 최근 급상승: 최근 10회 출현율이 전체 평균 대비 높은 번호
  // ============================================
  {
    const recentN = 10;
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const recentFreq = Array(46).fill(0);
    for (const d of data.slice(-recentN)) for (const n of d.numbers) recentFreq[n]++;

    const ranked = [];
    for (let i = 1; i <= 45; i++) {
      const avgRate = freq[i] / totalRounds;
      const recentRate = recentFreq[i] / recentN;
      const surge = avgRate > 0 ? +(recentRate / avgRate).toFixed(2) : 0;
      ranked.push({ n: i, recent: recentFreq[i], avg: freq[i], surge });
    }
    ranked.sort((a, b) => b.surge - a.surge || b.recent - a.recent);

    const top6 = ranked.filter(r => r.recent > 0).slice(0, 6);
    sets.push(makeResult(
      top6.map(r => r.n),
      `최근 급상승 (최근 ${recentN}회 vs 전체 평균)`,
      top6.map(r => `${r.n}번(최근${r.recent}회, ${r.surge}배)`).join(', ')
    ));
  }

  // ============================================
  // B) 주기 도래: 평균 출현 주기가 도래한 번호
  // ============================================
  {
    const due = patterns.dueCycle.slice(0, 6);
    if (due.length >= 6) {
      sets.push(makeResult(
        due.map(d => d.number),
        '주기 도래 (평균 출현 주기 도달)',
        due.map(d => `${d.number}번(주기${d.avgCycle}회, ${d.sinceLastDraw}회 경과, ${(d.dueRatio * 100).toFixed(0)}%)`).join(', ')
      ));
    } else {
      // 부족하면 미출현 큰 순으로 보충
      const lastSeen = Array(46).fill(0);
      for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
      const gaps = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, gap: latestRound - lastSeen[i + 1] }))
        .sort((a, b) => b.gap - a.gap);
      const used = new Set(due.map(d => d.number));
      const extra = gaps.filter(g => !used.has(g.n)).slice(0, 6 - due.length);
      sets.push(makeResult(
        [...due.map(d => d.number), ...extra.map(e => e.n)],
        '주기 도래 + 미출현 보정',
        '평균 주기 도래 번호 + 장기 미출현 번호 조합'
      ));
    }
  }

  // ============================================
  // C) 후속 번호: 직전 당첨번호 이후 가장 많이 나온 번호
  // ============================================
  {
    const followScore = Array(46).fill(0);
    for (const prev of lastDraw) {
      if (patterns.followMap[prev]) {
        for (const [next, count] of Object.entries(patterns.followMap[prev])) {
          followScore[+next] += count;
        }
      }
    }
    // 직전에 나온 번호 자체는 제외 (연속 출현은 드묾)
    for (const n of lastDraw) followScore[n] *= 0.3;

    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: followScore[i + 1] }))
      .sort((a, b) => b.s - a.s);
    sets.push(makeResult(
      ranked.slice(0, 6).map(r => r.n),
      `후속 번호 (${lastDraw.join(',')} 이후 통계)`,
      ranked.slice(0, 6).map(r => `${r.n}번(후속${r.s}회)`).join(', ')
    ));
  }

  // ============================================
  // D) 동반 출현 체인: 가장 강한 번호 쌍을 연결
  // ============================================
  {
    const pairCount = {};
    for (const d of data) {
      for (let i = 0; i < d.numbers.length; i++) {
        for (let j = i + 1; j < d.numbers.length; j++) {
          const key = `${d.numbers[i]}-${d.numbers[j]}`;
          pairCount[key] = (pairCount[key] || 0) + 1;
        }
      }
    }

    const sortedPairs = Object.entries(pairCount).sort((a, b) => b[1] - a[1]);
    const selected = new Set();
    const reasons = [];

    for (const [pair, count] of sortedPairs) {
      if (selected.size >= 6) break;
      const [a, b] = pair.split('-').map(Number);
      const added = [];
      if (!selected.has(a) && selected.size < 6) { selected.add(a); added.push(a); }
      if (!selected.has(b) && selected.size < 6) { selected.add(b); added.push(b); }
      if (added.length > 0) reasons.push(`${pair}(${count}회)`);
    }

    sets.push(makeResult(
      [...selected],
      '동반 출현 체인 (강한 쌍 연결)',
      reasons.slice(0, 4).join(', ')
    ));
  }

  // ============================================
  // E) 패턴 필터 조합: 빈도+주기 기반, 기존 세트 중복 감점, 합계+홀짝+구간 필터
  // ============================================
  {
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const maxF = Math.max(...freq.slice(1));
    const lastSeen = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
    const maxGap = Math.max(...Array.from({ length: 45 }, (_, i) => latestRound - lastSeen[i + 1])) || 1;
    const scores = Array(46).fill(0);
    for (let i = 1; i <= 45; i++) {
      scores[i] = (freq[i] / maxF) * 60 + ((latestRound - lastSeen[i]) / maxGap) * 40;
    }

    // 이미 A~D에 포함된 번호 감점 (중복 방지)
    const usedCount = Array(46).fill(0);
    for (const s of sets) for (const n of s.numbers) usedCount[n]++;
    for (let i = 1; i <= 45; i++) scores[i] *= Math.max(0.1, 1 - usedCount[i] * 0.35);

    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: scores[i + 1] }))
      .sort((a, b) => b.s - a.s);

    // 패턴 기준
    const targetSumMin = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[0] : 100;
    const targetSumMax = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[1] : 179;
    const targetOdd = patterns.bestOddEven[0]?.odd ?? 3;
    const targetAC = patterns.acStats.best[0]?.ac ?? 10;

    // 상위 18개 중에서 패턴 조건에 맞는 6개 조합 찾기
    const pool = ranked.slice(0, 18).map(r => r.n);

    // 점수 순으로 하나씩 추가하면서 필터 적용
    const selected = [];
    const rangeCounts = [0, 0, 0, 0, 0]; // 구간 균형

    for (const n of pool) {
      if (selected.length >= 6) break;

      const rangeIdx = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4;
      if (rangeCounts[rangeIdx] >= 2) continue; // 구간 쏠림 방지

      // 임시 추가 후 조건 검사
      const trial = [...selected, n].sort((a, b) => a - b);
      if (trial.length === 6) {
        const sum = trial.reduce((a, b) => a + b, 0);
        if (sum < targetSumMin - 20 || sum > targetSumMax + 20) continue;
        const odds = trial.filter(x => x % 2 === 1).length;
        if (Math.abs(odds - targetOdd) > 1) continue;
      }

      selected.push(n);
      rangeCounts[rangeIdx]++;
    }

    // 부족하면 pool에서 채움
    for (const n of pool) {
      if (selected.length >= 6) break;
      if (!selected.includes(n)) selected.push(n);
    }

    const sum = selected.sort((a, b) => a - b).reduce((a, b) => a + b, 0);
    const odds = selected.filter(n => n % 2 === 1).length;
    sets.push(makeResult(
      selected.slice(0, 6),
      '패턴 필터 (합계+홀짝+구간+AC 최적화)',
      `합계 ${targetSumMin}-${targetSumMax} 범위, 홀${targetOdd}:짝${6 - targetOdd} 타겟, 구간 균형`
    ));
  }

  // === 전체 종합 점수 (UI 표시용) ===
  const allScores = Array(46).fill(0);
  for (const s of sets) {
    for (const n of s.numbers) allScores[n] += 1;
  }
  // 빈도 기반 기본 점수도 추가
  const freq = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) freq[n]++;
  const maxF = Math.max(...freq.slice(1));
  for (let i = 1; i <= 45; i++) {
    allScores[i] = +(allScores[i] * 20 + (freq[i] / maxF) * 30).toFixed(1);
  }
  const ranked = Array.from({ length: 45 }, (_, i) => ({
    number: i + 1,
    score: allScores[i + 1],
    sets: sets.filter(s => s.numbers.includes(i + 1)).length
  })).sort((a, b) => b.score - a.score);

  return {
    ranked: ranked.slice(0, 20),
    sets,
    patterns: {
      dueCycle: patterns.dueCycle.slice(0, 10),
      bestSumRange: patterns.bestSumRange,
      bestOddEven: patterns.bestOddEven,
      topConsecPairs: patterns.topConsecPairs.slice(0, 8),
      sameEndDigitRate: patterns.sameEndDigitRate,
      acStats: patterns.acStats
    }
  };
}

// --- API ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({ cached: lottoCache.length, lastRound: lottoCache[lottoCache.length - 1]?.round || 0 });
});

app.get('/api/data', (req, res) => {
  if (!lottoCache.length) return res.status(503).json({ error: 'node fetch-data.js 를 먼저 실행하세요' });
  res.json(analyze(lottoCache));
});

app.get('/api/predict', (req, res) => {
  if (!lottoCache.length) return res.status(503).json({ error: '데이터 없음' });
  res.json(predict(lottoCache));
});

app.get('/api/refresh', async (req, res) => {
  const added = await updateData();
  res.json({ ok: true, cached: lottoCache.length, added });
});

// --- 서버 시작 ---
app.listen(PORT, () => {
  console.log(`[로또예측기] http://localhost:${PORT}`);
  loadCache();
  if (lottoCache.length === 0) {
    console.log('[로또예측기] 데이터 파일이 없습니다. "node fetch-data.js" 를 먼저 실행하세요.');
  } else {
    // 백그라운드 업데이트 시도
    updateData().catch(() => {});
  }
});
