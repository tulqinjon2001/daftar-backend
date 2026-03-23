const reportsService = require("../services/reportsService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

async function getActivityFeed(req, res) {
  try {
    const result = await reportsService.getActivityFeed(req.shopId, req.query);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getActivityFeed", err);
    apiResponse(res, false, null, "Activity feed failed", 500);
  }
}

module.exports = { getActivityFeed };
