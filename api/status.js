const { loadData } = require('../lib/engine');

module.exports = (req, res) => {
  try {
    const data = loadData();
    res.json({ cached: data.length, lastRound: data[data.length - 1]?.round || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
