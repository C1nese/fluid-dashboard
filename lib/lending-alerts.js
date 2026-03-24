const { getConfig } = require("./config");

const state = {
  running: false,
  inFlight: false,
  pollCount: 0,
  successCount: 0,
  errorCount: 0,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastDurationMs: null,
  lastLiquidityUsd: null,
  lastLiquidityTokens: null,
  alertTriggered: false,
  lastTriggeredAt: null,
  lastRecoveredAt: null,
  nextPollAt: null,
  currentIntervalMs: null
};

let timer = null;

function safeNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shiftDecimalString(value, decimals) {
  if (value === null || value === undefined) return "0";

  let str = String(value).trim();
  if (!str) return "0";

  let sign = "";
  if (str.startsWith("-")) {
    sign = "-";
    str = str.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(str)) {
    const fallback = Number(sign + str);
    return Number.isFinite(fallback) ? String(fallback / Math.pow(10, decimals)) : "0";
  }

  const parts = str.split(".");
  let intPart = parts[0] || "0";
  const fracPart = parts[1] || "";
  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";

  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, "") || "0";
  const totalScale = decimals + fracPart.length;

  let result = "";
  if (digits.length <= totalScale) {
    result = "0." + "0".repeat(totalScale - digits.length) + digits;
  } else {
    const idx = digits.length - totalScale;
    const whole = digits.slice(0, idx);
    const frac = digits.slice(idx);
    result = frac ? whole + "." + frac : whole;
  }

  result = result.replace(/^0+(?=\d)/, "");
  if (result.startsWith(".")) result = "0" + result;
  if (result.includes(".")) {
    result = result.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  return sign + (result || "0");
}

function scaleRawToNumber(rawValue, decimals) {
  const shifted = shiftDecimalString(rawValue, decimals);
  const number = Number(shifted);
  return Number.isFinite(number) ? number : 0;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(safeNum(value));
}

function formatCompactUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2
  }).format(safeNum(value));
}

function formatTokens(value) {
  const number = safeNum(value);
  const fractionDigits = number >= 1000 ? 2 : 6;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: fractionDigits
  }).format(number);
}

function withTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => {
    clearTimeout(timeout);
  });
}

function buildBarkUrl(config) {
  if (config.barkPushUrl) {
    return config.barkPushUrl;
  }

  if (!config.barkDeviceKey) {
    return "";
  }

  return `${config.barkBaseUrl.replace(/\/$/, "")}/${config.barkDeviceKey}`;
}

async function sendBarkAlert(config, details) {
  const barkUrl = buildBarkUrl(config);
  if (!barkUrl) {
    return false;
  }

  const payload = {
    title: `Fluid ${config.alertSymbol} 流动性告警`,
    body: [
      `${config.alertSymbol} liquidity hit threshold`,
      `当前流动性: ${formatCompactUsd(details.liquidityUsd)}`,
      `可提取数量: ${formatTokens(details.withdrawableTokens)} ${config.alertSymbol}`,
      `阈值: ${formatCompactUsd(config.alertLiquidityThresholdUsd)}`,
      `检查时间: ${new Date(details.checkedAt).toLocaleString("zh-CN")}`
    ].join("\n"),
    group: config.barkGroup,
    level: config.barkLevel,
    sound: config.barkSound,
    icon: config.barkIcon,
    url: config.barkUrl,
    call: config.barkCall ? "1" : "0"
  };

  const response = await withTimeout(
    barkUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    8000
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bark push failed: HTTP ${response.status} ${text}`);
  }

  return true;
}

async function fetchLiquiditySnapshot(config) {
  const response = await withTimeout(
    config.lendingApiUrl,
    {
      method: "GET",
      headers: {
        "Cache-Control": "no-store"
      }
    },
    config.pollTimeoutMs
  );

  if (!response.ok) {
    throw new Error(`Liquidity API failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const tokens = Array.isArray(payload && payload.data) ? payload.data : [];
  const target = tokens.find((token) => token && token.asset && token.asset.symbol === config.alertSymbol);

  if (!target) {
    throw new Error(`${config.alertSymbol} token not found in payload`);
  }

  const decimals = safeNum((target.asset && target.asset.decimals) || target.decimals || 18);
  const withdrawableRaw = target.liquiditySupplyData && target.liquiditySupplyData.withdrawable;
  const withdrawableTokens = scaleRawToNumber(withdrawableRaw || "0", decimals);
  const price = safeNum(target.asset && target.asset.price);

  return {
    symbol: config.alertSymbol,
    price,
    withdrawableTokens,
    liquidityUsd: withdrawableTokens * price,
    checkedAt: new Date().toISOString()
  };
}

async function pollOnce() {
  const config = getConfig();
  if (state.inFlight) {
    return;
  }

  state.inFlight = true;
  state.pollCount += 1;
  state.lastCheckedAt = new Date().toISOString();

  const startedAt = Date.now();

  try {
    const snapshot = await fetchLiquiditySnapshot(config);
    state.successCount += 1;
    state.lastSuccessAt = snapshot.checkedAt;
    state.lastError = null;
    state.lastErrorAt = null;
    state.lastLiquidityUsd = snapshot.liquidityUsd;
    state.lastLiquidityTokens = snapshot.withdrawableTokens;
    state.lastDurationMs = Date.now() - startedAt;
    state.currentIntervalMs = config.pollIntervalMs;

    const threshold = config.alertLiquidityThresholdUsd;
    const recoverThreshold = threshold * Math.max(config.alertRecoverRatio, 1);
    const shouldTrigger = snapshot.liquidityUsd <= threshold;
    const shouldRecover = snapshot.liquidityUsd > recoverThreshold;

    if (shouldTrigger && !state.alertTriggered) {
      await sendBarkAlert(config, snapshot);
      state.alertTriggered = true;
      state.lastTriggeredAt = snapshot.checkedAt;
      console.log(
        `[alerts] Bark sent for ${snapshot.symbol}: ${formatUsd(snapshot.liquidityUsd)} <= ${formatUsd(threshold)}`
      );
    } else if (state.alertTriggered && shouldRecover) {
      state.alertTriggered = false;
      state.lastRecoveredAt = snapshot.checkedAt;
      console.log(
        `[alerts] Alert reset for ${snapshot.symbol}: liquidity recovered to ${formatUsd(snapshot.liquidityUsd)}`
      );
    }
  } catch (error) {
    state.errorCount += 1;
    state.lastError = error.message;
    state.lastErrorAt = new Date().toISOString();
    state.lastDurationMs = Date.now() - startedAt;

    const nextBackoff = state.currentIntervalMs
      ? Math.min(state.currentIntervalMs * 2, config.maxBackoffMs)
      : Math.min(config.pollIntervalMs * 2, config.maxBackoffMs);

    state.currentIntervalMs = nextBackoff;
    console.error("[alerts]", error.message);
  } finally {
    state.inFlight = false;
  }
}

function scheduleNext(delayMs) {
  if (timer) {
    clearTimeout(timer);
  }

  state.nextPollAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(async () => {
    await pollOnce();
    const config = getConfig();
    const nextDelay = state.lastError ? state.currentIntervalMs || config.pollIntervalMs : config.pollIntervalMs;
    scheduleNext(nextDelay);
  }, delayMs);
}

function startAlerts() {
  if (state.running) {
    return;
  }

  state.running = true;
  const config = getConfig();
  state.currentIntervalMs = config.pollIntervalMs;
  scheduleNext(0);
}

function getAlertStatus() {
  const config = getConfig();
  return {
    ok: true,
    config: {
      symbol: config.alertSymbol,
      thresholdUsd: config.alertLiquidityThresholdUsd,
      recoverRatio: config.alertRecoverRatio,
      pollIntervalMs: config.pollIntervalMs,
      pollTimeoutMs: config.pollTimeoutMs,
      barkEnabled: config.barkEnabled
    },
    state: { ...state }
  };
}

module.exports = {
  getAlertStatus,
  startAlerts
};
