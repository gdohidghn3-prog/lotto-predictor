const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'lotto-data.json');

let _cache = null;

function loadData() {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  return _cache;
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

  // A) 역대 빈도 TOP
  {
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, f: freq[i + 1] })).sort((a, b) => b.f - a.f);
    sets.push(makeResult(ranked.slice(0, 6).map(r => r.n), '역대 빈도 TOP 6', ranked.slice(0, 6).map(r => `${r.n}번(${r.f}회)`).join(', ')));
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

  // E) 패턴 필터 조합
  {
    const freq = Array(46).fill(0);
    for (const d of data) for (const n of d.numbers) freq[n]++;
    const recentFreq = Array(46).fill(0);
    for (const d of data.slice(-30)) for (const n of d.numbers) recentFreq[n]++;
    const maxF = Math.max(...freq.slice(1));
    const maxR = Math.max(...recentFreq.slice(1)) || 1;
    const scores = Array(46).fill(0);
    for (let i = 1; i <= 45; i++) scores[i] = (freq[i] / maxF) * 50 + (recentFreq[i] / maxR) * 50;
    const ranked = Array.from({ length: 45 }, (_, i) => ({ n: i + 1, s: scores[i + 1] })).sort((a, b) => b.s - a.s);

    const targetSumMin = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[0] : 100;
    const targetSumMax = patterns.bestSumRange[0] ? +patterns.bestSumRange[0].range.split('-')[1] : 179;
    const targetOdd = patterns.bestOddEven[0]?.odd ?? 3;
    const pool = ranked.slice(0, 18).map(r => r.n);
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

    sets.push(makeResult(selected.slice(0, 6), '패턴 필터 (합계+홀짝+구간+AC 최적화)', `합계 ${targetSumMin}-${targetSumMax} 범위, 홀${targetOdd}:짝${6 - targetOdd} 타겟, 구간 균형`));
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
