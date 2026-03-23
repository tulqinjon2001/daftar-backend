const dashboardService = require("../services/dashboardService");

async function getStats(req, res) {
  try {
    const shopId = req.shopId;
    if (!shopId) {
      return res.status(400).json({ success: false, data: null, message: "Shop not found" });
    }
    const result = await dashboardService.getDashboardStats(shopId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error("Dashboard getStats error:", err);
    return res.status(500).json({ success: false, data: null, message: "Server error" });
  }
}

module.exports = { getStats };
