const VALUE_SHORT_FLAGS = new Set(["c", "p", "t", "i", "P", "b", "w", "A"]);
const BOOL_SHORT_FLAGS = new Set(["R", "J", "u", "4", "6", "d"]);

export function tokenizeIperf3Command(commandText = "") {
  const text = String(commandText || "").trim();
  const rawTokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const ch of text) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        rawTokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) rawTokens.push(current);

  return expandCompactShortFlags(rawTokens);
}

function isNextShortFlag(text, index) {
  if (text[index] !== "-" || index + 1 >= text.length) return false;
  const nextChar = text[index + 1];
  return VALUE_SHORT_FLAGS.has(nextChar) || BOOL_SHORT_FLAGS.has(nextChar);
}

function splitGluedShortFlags(token = "") {
  if (!token.startsWith("-") || token.startsWith("--")) return [token];

  const parts = [];
  let index = 0;

  while (index < token.length) {
    if (token[index] !== "-") break;
    index += 1;
    if (index >= token.length) break;

    const flagChar = token[index];
    index += 1;

    if (VALUE_SHORT_FLAGS.has(flagChar)) {
      parts.push(`-${flagChar}`);
      let value = "";
      while (index < token.length) {
        if (isNextShortFlag(token, index)) break;
        value += token[index];
        index += 1;
      }
      if (value) parts.push(value);
      continue;
    }

    if (BOOL_SHORT_FLAGS.has(flagChar)) {
      parts.push(`-${flagChar}`);
      continue;
    }

    parts.push(token.slice(index - 2));
    break;
  }

  return parts.length ? parts : [token];
}

function expandCompactShortFlags(tokens) {
  const expanded = [];
  for (const token of tokens) {
    if (token.startsWith("-") && !token.startsWith("--")) {
      expanded.push(...splitGluedShortFlags(token));
      continue;
    }
    expanded.push(token);
  }
  return expanded;
}

function nextValue(tokens, index) {
  return index + 1 < tokens.length ? tokens[index + 1] : "";
}

export function parseDigitsOnly(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return "";
  return raw;
}

export function resolvePort(value = "", fallback = "5201") {
  const digits = parseDigitsOnly(value);
  if (!digits) return parseDigitsOnly(fallback) || "5201";
  const port = Number(digits);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return parseDigitsOnly(fallback) || "5201";
  }
  return String(port);
}

function resolveDigits(value = "", fallback = "") {
  const digits = parseDigitsOnly(value);
  if (digits) return digits;
  return parseDigitsOnly(fallback) || fallback;
}

function parseBitrateToMbps(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/^([0-9.]+)\s*([kmg])?/);
  if (!match) return "";
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return "";
  const unit = match[2] || "m";
  if (unit === "k") return String(Math.max(1, Math.round(n / 1000)));
  if (unit === "g") return String(Math.round(n * 1000));
  return String(Math.round(n));
}

function previousPortFromSetup(existingSetup = {}) {
  return resolvePort(existingSetup.port, "5201");
}

export function parseIperf3Command(commandText = "", existingSetup = {}) {
  const tokens = tokenizeIperf3Command(commandText);
  const previousPort = previousPortFromSetup(existingSetup);
  const result = {
    ok: false,
    warnings: [],
    values: {
      rawCommand: String(commandText || "").trim(),
      customerCommand: String(commandText || "").trim(),
      commandMode: true,
    },
  };

  if (!tokens.length) {
    result.warnings.push("Command is empty. Form values were kept unchanged.");
    return result;
  }

  const first = tokens[0].toLowerCase();
  if (!first.endsWith("iperf3") && first !== "iperf3") {
    result.warnings.push("Command does not start with iperf3.");
  }

  let sawClient = false;
  let sawJson = false;
  let sawPortFlag = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "-c" || token === "--client") {
      result.values.server = nextValue(tokens, i);
      sawClient = Boolean(result.values.server);
      i += 1;
      continue;
    }
    if (token.startsWith("--client=")) {
      result.values.server = token.split("=").slice(1).join("=");
      sawClient = Boolean(result.values.server);
      continue;
    }
    if (token === "-p" || token === "--port") {
      sawPortFlag = true;
      const rawPort = nextValue(tokens, i);
      const port = parseDigitsOnly(rawPort);
      if (port) {
        result.values.port = resolvePort(port, previousPort);
      } else if (rawPort) {
        result.warnings.push(`Invalid port "${rawPort}". Port must be digits only. Using ${previousPort}.`);
        result.values.port = previousPort;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--port=")) {
      sawPortFlag = true;
      const rawPort = token.split("=").slice(1).join("=");
      const port = parseDigitsOnly(rawPort);
      if (port) {
        result.values.port = resolvePort(port, previousPort);
      } else if (rawPort) {
        result.warnings.push(`Invalid port "${rawPort}". Port must be digits only. Using ${previousPort}.`);
        result.values.port = previousPort;
      }
      continue;
    }
    if (token === "-t" || token === "--time") {
      const duration = parseDigitsOnly(nextValue(tokens, i));
      if (duration) result.values.durationSeconds = duration;
      i += 1;
      continue;
    }
    if (token.startsWith("--time=")) {
      const duration = parseDigitsOnly(token.split("=").slice(1).join("="));
      if (duration) result.values.durationSeconds = duration;
      continue;
    }
    if (token === "-i" || token === "--interval") {
      const interval = parseDigitsOnly(nextValue(tokens, i));
      if (interval) result.values.intervalSeconds = interval;
      i += 1;
      continue;
    }
    if (token.startsWith("--interval=")) {
      const interval = parseDigitsOnly(token.split("=").slice(1).join("="));
      if (interval) result.values.intervalSeconds = interval;
      continue;
    }
    if (token === "-P" || token === "--parallel") {
      const streams = parseDigitsOnly(nextValue(tokens, i));
      if (streams) result.values.streams = streams;
      i += 1;
      continue;
    }
    if (token.startsWith("--parallel=")) {
      const streams = parseDigitsOnly(token.split("=").slice(1).join("="));
      if (streams) result.values.streams = streams;
      continue;
    }
    if (token === "-u" || token === "--udp") {
      result.values.protocol = "UDP";
      continue;
    }
    if (token === "-b" || token === "--bitrate" || token === "--bandwidth") {
      result.values.udpBitrateMbps = parseBitrateToMbps(nextValue(tokens, i));
      i += 1;
      continue;
    }
    if (token.startsWith("--bitrate=") || token.startsWith("--bandwidth=")) {
      result.values.udpBitrateMbps = parseBitrateToMbps(token.split("=").slice(1).join("="));
      continue;
    }
    if (token === "-R" || token === "--reverse") {
      result.values.reverseMode = true;
      result.values.direction = "dl";
      continue;
    }
    if (token === "-d" || token === "--dualtest" || token === "--bidir") {
      result.values.direction = "dl_ul";
      if (token === "--bidir") result.values.bidirMode = true;
      continue;
    }
    if (token === "-J" || token === "--json") {
      sawJson = true;
      result.values.forceJson = true;
      continue;
    }
    if (token === "-4" || token === "--version4") {
      result.values.ipVersion = "4";
      continue;
    }
    if (token === "-6" || token === "--version6") {
      result.values.ipVersion = "6";
      continue;
    }
    if (token === "--connect-timeout") {
      const timeout = parseDigitsOnly(nextValue(tokens, i));
      if (timeout) result.values.connectTimeoutMs = timeout;
      i += 1;
      continue;
    }
    if (token.startsWith("--connect-timeout=")) {
      const timeout = parseDigitsOnly(token.split("=").slice(1).join("="));
      if (timeout) result.values.connectTimeoutMs = timeout;
      continue;
    }
  }

  if (!result.values.protocol) result.values.protocol = "TCP";
  if (!result.values.direction) result.values.direction = result.values.reverseMode ? "dl" : "ul";
  result.values.port = resolvePort(result.values.port, previousPort);
  result.values.durationSeconds = resolveDigits(
    result.values.durationSeconds,
    String(existingSetup.durationSeconds ?? "10"),
  );
  result.values.intervalSeconds = resolveDigits(
    result.values.intervalSeconds,
    String(existingSetup.intervalSeconds ?? "1"),
  );
  result.values.streams = resolveDigits(result.values.streams, String(existingSetup.streams ?? "1"));
  if (result.values.udpBitrateMbps) {
    result.values.udpBitrateMbps = resolveDigits(
      result.values.udpBitrateMbps,
      String(existingSetup.udpBitrateMbps ?? "10"),
    );
  }

  if (!sawClient) {
    result.warnings.push("No -c / --client server found. Form values were kept unchanged.");
  }
  if (!sawJson) {
    result.warnings.push("No -J / --json flag found. BabyDragon will add JSON mode when executing.");
  }
  if (!sawPortFlag && !result.warnings.some((item) => item.includes("Invalid port"))) {
    result.values.port = previousPort;
  }

  result.ok = sawClient;
  return result;
}

export function buildIperf3CommandFromSetup(setup = {}) {
  const server = String(setup.server || "").trim() || "<server>";
  const port = resolvePort(setup.port, "5201");
  const duration = resolveDigits(String(setup.durationSeconds ?? ""), "10");
  const interval = resolveDigits(String(setup.intervalSeconds ?? ""), "1");
  const streams = resolveDigits(String(setup.streams ?? ""), "1");
  const protocol = String(setup.protocol || "TCP").toUpperCase();
  const direction = String(setup.direction || "").toLowerCase();
  const reverse = setup.reverseMode === true || direction === "dl";
  const udpBitrateMbps = resolveDigits(String(setup.udpBitrateMbps ?? ""), "10");
  const parts = ["iperf3", "-c", server, "-p", port, "-t", duration, "-i", interval];
  if (Number(streams) > 1) parts.push("-P", streams);
  if (protocol === "UDP") parts.push("-u", "-b", `${udpBitrateMbps}M`);
  if (reverse) parts.push("-R");
  parts.push("-J");
  return parts.join(" ");
}

export function sanitizeIperfSetup(setup = {}, fallback = {}) {
  const base = { ...fallback, ...setup };
  return {
    ...base,
    port: resolvePort(base.port, resolvePort(fallback.port, "5201")),
    durationSeconds: resolveDigits(String(base.durationSeconds ?? ""), resolveDigits(String(fallback.durationSeconds ?? ""), "10")),
    warmupSeconds: resolveDigits(String(base.warmupSeconds ?? ""), resolveDigits(String(fallback.warmupSeconds ?? ""), "3")),
    intervalSeconds: resolveDigits(String(base.intervalSeconds ?? ""), resolveDigits(String(fallback.intervalSeconds ?? ""), "1")),
    iterations: resolveDigits(String(base.iterations ?? ""), resolveDigits(String(fallback.iterations ?? ""), "1")),
    waitSeconds: resolveDigits(String(base.waitSeconds ?? ""), resolveDigits(String(fallback.waitSeconds ?? ""), "5")),
    streams: resolveDigits(String(base.streams ?? ""), resolveDigits(String(fallback.streams ?? ""), "1")),
    udpBitrateMbps: resolveDigits(String(base.udpBitrateMbps ?? ""), resolveDigits(String(fallback.udpBitrateMbps ?? ""), "10")),
    server: String(base.server ?? "").trim(),
    protocol: String(base.protocol || "TCP").toUpperCase() === "UDP" ? "UDP" : "TCP",
    direction: String(base.direction || fallback.direction || "ul"),
  };
}
