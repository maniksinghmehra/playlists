const normalizePassword = value => {
  const password = String(value || "").trim();
  return password.length >= 2 && /^(['"]).*\1$/.test(password)
    ? password.slice(1, -1)
    : password;
};

const configuredPassword = () =>
  process.env.Pass || process.env.pass || process.env.ADMIN_PASSWORD;

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST required." });
    return;
  }

  const expectedPassword = configuredPassword();
  if (!expectedPassword) {
    res.status(500).json({ error: "The Pass environment variable is not configured." });
    return;
  }

  if (normalizePassword(req.body && req.body.adminPassword) !== normalizePassword(expectedPassword)) {
    res.status(401).json({ error: "Invalid admin password." });
    return;
  }

  res.status(200).json({ ok: true });
};
