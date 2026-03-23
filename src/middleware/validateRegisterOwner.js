/**
 * Owner ro'yxatdan o'tish va tasdiqlash uchun validatsiya.
 * Telefon: +998 format, parol: kamida 8 belgi.
 */
function validateRegisterOwner(req, res, next) {
  const errors = [];
  const { full_name, phone, password } = req.body;

  if (!full_name || typeof full_name !== "string") {
    errors.push("full_name is required");
  }
  if (!phone || typeof phone !== "string") {
    errors.push("phone is required");
  } else {
    const digits = phone.replace(/\D/g, "");
    if (!digits.startsWith("998") || digits.length < 12) {
      errors.push("phone must be in +998 format");
    }
  }
  if (!password || typeof password !== "string") {
    errors.push("password is required");
  } else if (password.length < 8) {
    errors.push("password must be at least 8 characters");
  }

  if (errors.length) {
    return res.status(400).json({
      success: false,
      data: null,
      message: errors.join("; "),
    });
  }
  next();
}

/**
 * Shop details (2-qadam) — shop_name, address, open_at, close_at
 */
function validateShopDetails(req, res, next) {
  const errors = [];
  const { shop_name, address, open_at, close_at } = req.body;

  if (!shop_name || typeof shop_name !== "string") {
    errors.push("shop_name is required");
  }
  if (!address || typeof address !== "string") {
    errors.push("address is required");
  }
  if (!open_at || typeof open_at !== "string") {
    errors.push("open_at is required (e.g. 09:00)");
  }
  if (!close_at || typeof close_at !== "string") {
    errors.push("close_at is required (e.g. 18:00)");
  }

  if (errors.length) {
    return res.status(400).json({
      success: false,
      data: null,
      message: errors.join("; "),
    });
  }
  next();
}

module.exports = { validateRegisterOwner, validateShopDetails };
