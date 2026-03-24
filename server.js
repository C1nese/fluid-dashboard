const express = require("express");
const path = require("path");

const { getConfig } = require("./lib/config");
const { getAlertStatus, startAlerts } = require("./lib/lending-alerts");

const app = express();
const config = getConfig();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "fluid-lending-bark-alerts",
    now: new Date().toISOString()
  });
});

app.get("/api/alert-status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(getAlertStatus());
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(config.port, () => {
  console.log(`Server ready at http://localhost:${config.port}`);
  startAlerts();
});
