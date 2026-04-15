const fs = require('fs');
const path = require('path');

// Vercel 서버리스: process.cwd()가 프로젝트 루트를 가리킴
const DATA_FILE = path.resolve(__dirname, '..', 'lotto-data.json');

let _cache = null;

function loadData() {
  if (_cache) return _cache;
  // 여러 경로 시도 (로컬 / Vercel)
  const candidates = [
    DATA_FILE,
    path.join(process.cwd(), 'lotto-data.json'),
    path.join(__dirname, 'lotto-data.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _cache = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return _cache;
      }
    } catch {}
  }
  throw new Error('lotto-data.json not found. Tried: ' + candidates.join(', '));
}

function analyze(data) {
  if (!data.length) return null;
  const totalRounds = data.length;

  const freq = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) freq[n]++;

  const recentN = Math.min(20, totalRounds);
  const recentFreq = Array(46).fill(0);
  for (const d of data.slice(-recentN)) for (const n of d.numbers) recentFreq[n]++;

  const lastSeen = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
  const latestRound = data[data.length - 1].round;
  const gap = Array(46).fill(0);
  for (let i = 1; i <= 45; i++) gap[i] = latestRound - lastSeen[i];

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

  const oddCounts = Array(7).fill(0);
  for (const d of data) { oddCounts[d.numbers.filter(n => n % 2 === 1).length]++; }

  const sums = data.map(d => d.numbers.reduce((a, b) => a + b, 0));
  const avgSum = Math.round(sums.reduce((a, b) => a + b, 0) / sums.length);

  let consecutiveCount = 0;
  for (const d of data) {
    for (let i = 0; i < d.numbers.length - 1; i++) {
      if (d.numbers[i + 1] - d.numbers[i] === 1) { consecutiveCount++; break; }
    }
  }

  const lastDigit = Array(10).fill(0);
  for (const d of data) for (const n of d.numbers) lastDigit[n % 10]++;

  const pairs = {};
  for (const d of data) {
    for (let i = 0; i < d.numbers.length; i++) {
      for (let j = i + 1; j < d.numbers.length; j++) {
        const key = `${d.numbers[i]}-${d.numbers[j]}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
  const topPairs = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([k, v]) => ({ pair: k, count: v }));

  return {
    totalRounds, latestRound, latestDate: data[data.length - 1].date,
    frequency: freq.slice(1).map((f, i) => ({ number: i + 1, count: f, rate: +(f / totalRounds * 100).toFixed(1) })),
    recentHot: recentFreq.slice(1).map((f, i) => ({ number: i + 1, count: f })).sort((a, b) => b.count - a.count).slice(0, 15),
    coldNumbers: gap.slice(1).map((g, i) => ({ number: i + 1, gap: g })).sort((a, b) => b.gap - a.gap).slice(0, 15),
    ranges: ranges.map((r, i) => ({ label: ['1-10', '11-20', '21-30', '31-40', '41-45'][i], count: r, rate: +(r / (totalRounds * 6) * 100).toFixed(1) })),
    oddEven: oddCounts.map((c, i) => ({ odd: i, even: 6 - i, count: c, rate: +(c / totalRounds * 100).toFixed(1) })),
    sumStats: { avg: avgSum, min: Math.min(...sums), max: Math.max(...sums) },
    consecutiveRate: +(consecutiveCount / totalRounds * 100).toFixed(1),
    lastDigit: lastDigit.map((c, i) => ({ digit: i, count: c })),
    topPairs,
    recentDraws: data.slice(-10).reverse()
  };
}

function discoverPatterns(data) {
  const totalRounds = data.length;
  const latestRound = data[data.length - 1].round;

  const followMap = {};
  for (let i = 0; i < data.length - 1; i++) {
    for (const prev of data[i].numbers) {
      if (!followMap[prev]) followMap[prev] = {};
      for (const next of data[i + 1].numbers) {
        followMap[prev][next] = (followMap[prev][next] || 0) + 1;
      }
    }
  }

  const appearances = {};
  for (const d of data) for (const n of d.numbers) { if (!appearances[n]) appearances[n] = []; appearances[n].push(d.round); }
  const cycles = {};
  for (let n = 1; n <= 45; n++) {
    const app = appearances[n] || [];
    if (app.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < app.length; i++) gaps.push(app[i] - app[i - 1]);
    cycles[n] = { avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), last: latestRound - app[app.length - 1], count: app.length };
  }
  const dueCycle = [];
  for (let n = 1; n <= 45; n++) {
    if (!cycles[n]) continue;
    const ratio = cycles[n].last / cycles[n].avg;
    if (ratio >= 0.8) dueCycle.push({ number: n, avgCycle: cycles[n].avg, sinceLastDraw: cycles[n].last, dueRatio: +ratio.toFixed(2) });
  }
  dueCycle.sort((a, b) => b.dueRatio - a.dueRatio);

  const sumBuckets = {};
  for (const d of data) { const s = d.numbers.reduce((a, b) => a + b, 0); const bucket = Math.floor(s / 20) * 20; sumBuckets[`${bucket}-${bucket + 19}`] = (sumBuckets[`${bucket}-${bucket + 19}`] || 0) + 1; }
  const bestSumRange = Object.entries(sumBuckets).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ range: k, count: v, rate: +(v / totalRounds * 100).toFixed(1) }));

  const oddEvenCounts = Array(7).fill(0);
  for (const d of data) oddEvenCounts[d.numbers.filter(n => n % 2 === 1).length]++;
  const bestOddEven = oddEvenCounts.map((c, i) => ({ odd: i, even: 6 - i, count: c, rate: +(c / totalRounds * 100).toFixed(1) })).sort((a, b) => b.count - a.count).slice(0, 3);

  const consecPairs = {};
  for (const d of data) for (let i = 0; i < d.numbers.length - 1; i++) {
    if (d.numbers[i + 1] - d.numbers[i] === 1) { const key = `${d.numbers[i]}-${d.numbers[i + 1]}`; consecPairs[key] = (consecPairs[key] || 0) + 1; }
  }
  const topConsecPairs = Object.entries(consecPairs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ pair: k, count: v }));

  let sameEndCount = 0;
  for (const d of data) { if (new Set(d.numbers.map(n => n % 10)).size < 6) sameEndCount++; }

  const acValues = [];
  for (const d of data) { const diffs = new Set(); for (let i = 0; i < d.numbers.length; i++) for (let j = i + 1; j < d.numbers.length; j++) diffs.add(d.numbers[j] - d.numbers[i]); acValues.push(diffs.size); }
  const avgAC = +(acValues.reduce((a, b) => a + b, 0) / acValues.length).toFixed(1);
  const acDistrib = {};
  for (const ac of acValues) acDistrib[ac] = (acDistrib[ac] || 0) + 1;
  const bestAC = Object.entries(acDistrib).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ ac: +k, count: v, rate: +(v / totalRounds * 100).toFixed(1) }));

  return { followMap, cycles, dueCycle: dueCycle.slice(0, 15), bestSumRange, bestOddEven, topConsecPairs, sameEndDigitRate: +(sameEndCount / totalRounds * 100).toFixed(1), acStats: { avg: avgAC, best: bestAC } };
}

function predict(data) {
  if (!data.length) return [];
  const totalRounds = data.length;
  const latestRound = data[data.length - 1].round;
  const lastDraw = data[data.length - 1].numbers;
  const patterns = discoverPatterns(data);

  function makeResult(numbers, strategy, reason) {
    numbers.sort((a, b) => a - b);
    return { numbers, strategy, reason, sum: numbers.reduce((a, b) => a + b, 0), oddEven: `${numbers.filter(n => n % 2 === 1).length}:${numbers.filter(n => n % 2 === 0).length}` };
  }

  const sets = [];

  // A) 최근 급상승: 최근 10회 출현율이 전체 평균 대비 얼마나 높은지
  {
    const recentN = 10;
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const recentFreq = Array(46).fill(0);
    for (const d of data.slice(-recentN)) for (const n of d.numbers) recentFreq[n]++;

    // 전체 평균 출현율 vs 최근 출현율 → 상승 배율
    const ranked = [];
    for (let i = 1; i <= 45; i++) {
      const avgRate = freq[i] / totalRounds;         // 전체 평균 (회당 출현 확률)
      const recentRate = recentFreq[i] / recentN;    // 최근 10회 출현 확률
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

  // B) 주기 도래
  {
    const due = patterns.dueCycle.slice(0, 6);
    if (due.length >= 6) {
      sets.push(makeResult(due.map(d => d.number), '주기 도래 (평균 출현 주기 도달)', due.map(d => `${d.number}번(주기${d.avgCycle}회, ${d.sinceLastDraw}회 경과, ${(d.dueRatio * 100).toFixed(0)}%)`).join(', ')));
    } else {
      const lastSeen = Array(46).fill(0);
      for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
      const gaps = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, gap: latestRound - lastSeen[i + 1] })).sort((a, b) => b.gap - a.gap);
      const used = new Set(due.map(d => d.number));
      const extra = gaps.filter(g => !used.has(g.n)).slice(0, 6 - due.length);
      sets.push(makeResult([...due.map(d => d.number), ...extra.map(e => e.n)], '주기 도래 + 미출현 보정', '평균 주기 도래 번호 + 장기 미출현 번호 조합'));
    }
  }

  // C) 후속 번호
  {
    const followScore = Array(46).fill(0);
    for (const prev of lastDraw) {
      if (patterns.followMap[prev]) for (const [next, count] of Object.entries(patterns.followMap[prev])) followScore[+next] += count;
    }
    for (const n of lastDraw) followScore[n] *= 0.3;
    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: followScore[i + 1] })).sort((a, b) => b.s - a.s);
    sets.push(makeResult(ranked.slice(0, 6).map(r => r.n), `후속 번호 (${lastDraw.join(',')} 이후 통계)`, ranked.slice(0, 6).map(r => `${r.n}번(후속${r.s}회)`).join(', ')));
  }

  // D) 동반 출현 체인
  {
    const pairCount = {};
    for (const d of data) for (let i = 0; i < d.numbers.length; i++) for (let j = i + 1; j < d.numbers.length; j++) { const key = `${d.numbers[i]}-${d.numbers[j]}`; pairCount[key] = (pairCount[key] || 0) + 1; }
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
    sets.push(makeResult([...selected], '동반 출현 체인 (강한 쌍 연결)', reasons.slice(0, 4).join(', ')));
  }

  // E) 패턴 필터 조합: 빈도+주기 기반, 기존 세트 중복 감점, 합계+홀짝+구간 필터
  {
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const maxF = Math.max(...freq.slice(1));
    const lastSeen = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) lastSeen[n] = d.round;
    const maxGap = Math.max(...Array.from({ length: 45 }, (_, i) => latestRound - lastSeen[i + 1])) || 1;
    const scores = Array(46).fill(0);
    for (let i = 1; i <= 45; i++) scores[i] = (freq[i] / maxF) * 60 + ((latestRound - lastSeen[i]) / maxGap) * 40;

    // 이미 A~D에 포함된 번호 감점 (중복 방지)
    const usedCount = Array(46).fill(0);
    for (const s of sets) for (const n of s.numbers) usedCount[n]++;
    for (let i = 1; i <= 45; i++) scores[i] *= Math.max(0.1, 1 - usedCount[i] * 0.35);

    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: scores[i + 1] })).sort((a, b) => b.s - a.s);

    const targetSumMin = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[0] : 100;
    const targetSumMax = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[1] : 179;
    const targetOdd = patterns.bestOddEven[0]?.odd ?? 3;
    const pool = ranked.slice(0, 20).map(r => r.n);
    const selected = [];
    const rangeCounts = [0, 0, 0, 0, 0];

    for (const n of pool) {
      if (selected.length >= 6) break;
      const rangeIdx = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4;
      if (rangeCounts[rangeIdx] >= 2) continue;
      const trial = [...selected, n].sort((a, b) => a - b);
      if (trial.length === 6) {
        const sum = trial.reduce((a, b) => a + b, 0);
        if (sum < targetSumMin - 20 || sum > targetSumMax + 20) continue;
        if (Math.abs(trial.filter(x => x % 2 === 1).length - targetOdd) > 1) continue;
      }
      selected.push(n);
      rangeCounts[rangeIdx]++;
    }
    for (const n of pool) { if (selected.length >= 6) break; if (!selected.includes(n)) selected.push(n); }

    sets.push(makeResult(selected.slice(0, 6), '패턴 필터 (합계+홀짝+구간 최적화, 중복 감점)', `합계 ${targetSumMin}-${targetSumMax} 범위, 홀${targetOdd}:짝${6 - targetOdd} 타겟, 구간 균형, A~D 중복 감점`));
  }

  // F) 최근 5회 급상승 (짧은 윈도우)
  {
    const recentN = 5;
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const recentFreq = Array(46).fill(0);
    for (const d of data.slice(-recentN)) for (const n of d.numbers) recentFreq[n]++;
    const ranked = [];
    for (let i = 1; i <= 45; i++) {
      const avgRate = freq[i] / totalRounds;
      const recentRate = recentFreq[i] / recentN;
      const surge = avgRate > 0 ? recentRate / avgRate : 0;
      ranked.push({ n: i, surge, recent: recentFreq[i] });
    }
    ranked.sort((a, b) => b.surge - a.surge || b.recent - a.recent);
    const top6 = ranked.filter(r => r.recent > 0).slice(0, 6);
    sets.push(makeResult(top6.map(r => r.n), `최근 급상승 단기 (최근 ${recentN}회)`, top6.map(r => `${r.n}번(${r.surge.toFixed(1)}배)`).join(', ')));
  }

  // G) 조건부 확률: 직전 합계+홀짝 유사 회차 → 다음 회차 번호
  {
    const last = data[data.length - 1];
    const s = last.numbers.reduce((a, b) => a + b, 0);
    const o = last.numbers.filter(n => n % 2 === 1).length;
    const freq = Array(46).fill(0);
    for (let i = 0; i < data.length - 1; i++) {
      const d = data[i];
      const ds = d.numbers.reduce((a, b) => a + b, 0);
      const dOdd = d.numbers.filter(n => n % 2 === 1).length;
      if (Math.abs(ds - s) < 25 && Math.abs(dOdd - o) <= 1) {
        for (const n of data[i + 1].numbers) freq[n]++;
      }
    }
    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, f: freq[i + 1] }))
      .sort((a, b) => b.f - a.f);
    sets.push(makeResult(ranked.slice(0, 6).map(r => r.n), '조건부 확률 (합계+홀짝 유사 전이)', ranked.slice(0, 6).map(r => `${r.n}번(${r.f}회)`).join(', ')));
  }

  // H) 평균 회귀: 장기 평균보다 최근 출현 부족한 번호
  {
    const longFreq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) longFreq[n]++;
    const shortFreq = Array(46).fill(0);
    for (const d of data.slice(-15)) for (const n of d.numbers) shortFreq[n]++;
    const ranked = [];
    for (let i = 1; i <= 45; i++) {
      const reversion = longFreq[i] / totalRounds - shortFreq[i] / 15;
      ranked.push({ n: i, s: reversion });
    }
    ranked.sort((a, b) => b.s - a.s);
    sets.push(makeResult(ranked.slice(0, 6).map(r => r.n), '평균 회귀 (최근 부족 → 반등 기대)', ranked.slice(0, 6).map(r => `${r.n}번(편차${r.s.toFixed(3)})`).join(', ')));
  }

  // I) 피처 복합 스코어: 빈도+최근+미출현+후속쌍 가중합
  {
    const N = data.length;
    const fScores = Array(46).fill(0);
    for (let num = 1; num <= 45; num++) {
      const af = data.filter(d => d.numbers.includes(num)).length / N;
      const r10 = data.slice(-10).filter(d => d.numbers.includes(num)).length / 10;
      const r5 = data.slice(-5).filter(d => d.numbers.includes(num)).length / 5;
      const miss3 = data.slice(-3).every(d => !d.numbers.includes(num)) ? 1 : 0;
      const lastHit = lastDraw.includes(num) ? -0.5 : 0;
      fScores[num] = af * 15 + r10 * 25 + r5 * 10 + miss3 * 8 + lastHit * 10;
    }
    // 기존 A~H 중복 감점
    const usedCount = Array(46).fill(0);
    for (const s of sets) for (const n of s.numbers) usedCount[n]++;
    for (let i = 1; i <= 45; i++) fScores[i] *= Math.max(0.2, 1 - usedCount[i] * 0.15);
    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: fScores[i + 1] })).sort((a, b) => b.s - a.s);
    sets.push(makeResult(ranked.slice(0, 6).map(r => r.n), '피처 복합 (빈도+최근+미출현 가중합)', ranked.slice(0, 6).map(r => `${r.n}번(${r.s.toFixed(1)}점)`).join(', ')));
  }

  // J) 패턴 필터 V2: E와 동일 구조, A~I 전체 중복 감점 + 다른 가중치
  {
    const freq2 = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq2[n]++;
    const maxF2 = Math.max(...freq2.slice(1));
    const lastSeen2 = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) lastSeen2[n] = d.round;
    const maxGap2 = Math.max(...Array.from({ length: 45 }, (_, i) => latestRound - lastSeen2[i + 1])) || 1;
    const scores2 = Array(46).fill(0);
    for (let i = 1; i <= 45; i++) scores2[i] = (freq2[i] / maxF2) * 40 + ((latestRound - lastSeen2[i]) / maxGap2) * 60;
    // A~I 전체 중복 감점 (더 강하게)
    const usedCount2 = Array(46).fill(0);
    for (const s of sets) for (const n of s.numbers) usedCount2[n]++;
    for (let i = 1; i <= 45; i++) scores2[i] *= Math.max(0.05, 1 - usedCount2[i] * 0.2);
    const ranked2 = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: scores2[i + 1] })).sort((a, b) => b.s - a.s);

    const targetSumMin2 = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[0] : 100;
    const targetSumMax2 = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[1] : 179;
    const targetOdd2 = patterns.bestOddEven.length > 1 ? patterns.bestOddEven[1]?.odd ?? 3 : 3;
    const pool2 = ranked2.slice(0, 20).map(r => r.n);
    const selected2 = [];
    const rangeCounts2 = [0, 0, 0, 0, 0];
    for (const n of pool2) {
      if (selected2.length >= 6) break;
      const ri = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : n <= 40 ? 3 : 4;
      if (rangeCounts2[ri] >= 2) continue;
      const trial = [...selected2, n].sort((a, b) => a - b);
      if (trial.length === 6) {
        const sum = trial.reduce((a, b) => a + b, 0);
        if (sum < targetSumMin2 - 20 || sum > targetSumMax2 + 20) continue;
        if (Math.abs(trial.filter(x => x % 2 === 1).length - targetOdd2) > 1) continue;
      }
      selected2.push(n);
      rangeCounts2[ri]++;
    }
    for (const n of pool2) { if (selected2.length >= 6) break; if (!selected2.includes(n)) selected2.push(n); }
    sets.push(makeResult(selected2.slice(0, 6), '패턴 필터 V2 (미출현 가중+전체 중복 감점)', `합계 ${targetSumMin2}-${targetSumMax2}, 홀${targetOdd2}:짝${6 - targetOdd2}, A~I 중복 최대 감점`));
  }

  // 종합 점수
  const allScores = Array(46).fill(0);
  for (const s of sets) for (const n of s.numbers) allScores[n] += 1;
  const freq = Array(46).fill(0);
  for (const d of data) for (const n of d.numbers) freq[n]++;
  const maxF = Math.max(...freq.slice(1));
  for (let i = 1; i <= 45; i++) allScores[i] = +(allScores[i] * 20 + (freq[i] / maxF) * 30).toFixed(1);
  const ranked = Array.from({ length: 45 }, (_, i) => ({ number: i + 1, score: allScores[i + 1], sets: sets.filter(s => s.numbers.includes(i + 1)).length })).sort((a, b) => b.score - a.score);

  return {
    ranked: ranked.slice(0, 20), sets,
    patterns: { dueCycle: patterns.dueCycle.slice(0, 10), bestSumRange: patterns.bestSumRange, bestOddEven: patterns.bestOddEven, topConsecPairs: patterns.topConsecPairs.slice(0, 8), sameEndDigitRate: patterns.sameEndDigitRate, acStats: patterns.acStats }
  };
}

module.exports = { loadData, analyze, predict };
