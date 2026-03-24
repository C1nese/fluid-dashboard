function getNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getConfig() {
  const barkBaseUrl = process.env.BARK_BASE_URL || "https://api.day.app";
  const barkDeviceKey = process.env.BARK_DEVICE_KEY || "";

  return {
    port: getNumber(process.env.PORT, 3000),
    lendingApiUrl: process.env.LENDING_API_URL || "https://api.fluid.instadapp.io/v2/lending/56/tokens",
    barkPushUrl: process.env.BARK_PUSH_URL || "",
    barkBaseUrl,
    barkDeviceKey,
    barkEnabled: Boolean(process.env.BARK_PUSH_URL || barkDeviceKey),
    barkSound: process.env.BARK_SOUND || "alarm",
    barkGroup: process.env.BARK_GROUP || "Fluid Lending",
    barkLevel: process.env.BARK_LEVEL || "active",
    barkCall: process.env.BARK_CALL === "true",
    barkIcon: process.env.BARK_ICON || "",
    barkUrl: process.env.BARK_URL || "",
    alertSymbol: process.env.ALERT_SYMBOL || "USDT",
    alertLiquidityThresholdUsd: getNumber(process.env.ALERT_USDT_LIQUIDITY_THRESHOLD, 4200000),
    alertRecoverRatio: getNumber(process.env.ALERT_RECOVER_RATIO, 1.05),
    pollIntervalMs: getNumber(process.env.ALERT_POLL_MS, 15000),
    pollTimeoutMs: getNumber(process.env.ALERT_TIMEOUT_MS, 8000),
    maxBackoffMs: getNumber(process.env.ALERT_MAX_BACKOFF_MS, 180000)
  };
}

module.exports = {
  getConfig
};
