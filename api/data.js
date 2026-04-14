const { loadData, analyze } = require('../lib/engine');

module.exports = (req, res) => {
  try {
    const data = loadData();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.json(analyze(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
