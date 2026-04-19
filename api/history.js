const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const candidates = [
      path.resolve(__dirname, '..', 'predictions.json'),
      path.join(process.cwd(), 'predictions.json'),
      path.join(__dirname, 'predictions.json'),
    ];
    let preds = {};
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        preds = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      }
    }
    const list = Object.values(preds).sort((a, b) => b.round - a.round);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ predictions: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
