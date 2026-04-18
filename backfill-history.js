// 과거 회차 예측 시뮬레이션 백필
// 각 회차 N에 대해, N-1까지의 데이터만으로 predict()를 실행 → 실제 N회차와 매칭
// 실제 예측(simulated 미지정)은 절대 덮어쓰지 않음

const fs = require('fs');
const path = require('path');
const { predict } = require('./lib/engine');

const DATA_FILE = path.join(__dirname, 'lotto-data.json');
const PRED_FILE = path.join(__dirname, 'predictions.json');

const BACKFILL_COUNT = parseInt(process.argv[2]) || 20; // 최근 N회차

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const preds = fs.existsSync(PRED_FILE)
    ? JSON.parse(fs.readFileSync(PRED_FILE, 'utf-8'))
    : {};

  data.sort((a, b) => a.round - b.round);
  const latestRound = data[data.length - 1].round;
  const startRound = Math.max(2, latestRound - BACKFILL_COUNT + 1);

  let added = 0;
  let skipped = 0;

  for (let round = startRound; round <= latestRound; round++) {
    const key = String(round);
    const existing = preds[key];

    // 실제 기록이 있으면 건드리지 않음
    if (existing && !existing.simulated) {
      skipped++;
      continue;
    }

    // 이미 시뮬레이션된 것도 스킵 (재실행 시 안정성)
    if (existing && existing.simulated) {
      skipped++;
      continue;
    }

    const pastData = data.filter(d => d.round < round);
    if (pastData.length < 50) continue; // 너무 적으면 의미 없음

    const draw = data.find(d => d.round === round);
    if (!draw) continue;

    const result = predict(pastData);
    const winSet = new Set(draw.numbers);
    const matches = result.sets.map((s, i) => {
      const hitNums = s.numbers.filter(n => winSet.has(n));
      return {
        setIdx: i,
        letter: String.fromCharCode(65 + i),
        strategy: s.strategy,
        hits: hitNums.length,
        hitNumbers: hitNums,
        bonusHit: s.numbers.includes(draw.bonus)
      };
    });

    preds[key] = {
      round,
      createdAt: new Date().toISOString(),
      basedOnRound: round - 1,
      simulated: true,
      sets: result.sets.map(s => ({
        numbers: s.numbers,
        strategy: s.strategy,
        sum: s.sum,
        oddEven: s.oddEven
      })),
      result: {
        winningNumbers: draw.numbers,
        bonus: draw.bonus,
        date: draw.date,
        matches
      }
    };
    added++;
    const best = Math.max(...matches.map(m => m.hits));
    console.log(`[백필] ${round}회차 (최고 적중 ${best}개)`);
  }

  fs.writeFileSync(PRED_FILE, JSON.stringify(preds, null, 2));
  console.log(`[완료] 추가 ${added}개, 스킵 ${skipped}개. 총 ${Object.keys(preds).length}회차`);
}

main();
