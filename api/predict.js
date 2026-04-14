const { loadData, predict } = require('../lib/engine');

module.exports = (req, res) => {
  try {
    const data = loadData();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.json(predict(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
