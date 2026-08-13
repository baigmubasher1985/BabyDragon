const VALUE_SHORT_FLAGS = new Set(["c", "p", "t", "i", "P", "b", "w", "A"]);
const NUMERIC_VALUE_FLAGS = new Set(["p", "t", "i", "P"]);
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

      if (NUMERIC_VALUE_FLAGS.has(flagChar)) {
        let value = "";
        while (index < token.length && /\d/.test(token[index])) {
          value += token[index];
          index += 1;
        }
        if (value) parts.push(value);
        continue;
      }

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
    errors: [],
    warnings: [],
    values: {
      rawCommand: String(commandText || "").trim(),
      customerCommand: String(commandText || "").trim(),
      commandMode: true,
    },
  };

  if (!tokens.length) {
    result.errors.push("Command is empty.");
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

  if (!sawClient || !String(result.values.server || "").trim()) {
    result.errors.push("Missing client server (-c / --client).");
  }
  if (!sawJson) {
    result.warnings.push("No -J / --json flag. BabyDragon will add JSON when executing.");
  }
  if (!sawPortFlag && !result.warnings.some((item) => item.includes("Invalid port"))) {
    result.values.port = previousPort;
  }

  result.ok = result.errors.length === 0;
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
  // Direction is authoritative: UL never inherits stale bidir/reverse form state.
  let reverse = setup.reverseMode === true;
  let bidir = setup.bidirMode === true;
  if (direction === "ul") {
    reverse = false;
    bidir = false;
  } else if (direction === "dl") {
    reverse = true;
    bidir = false;
  } else if (isDlUlDirection(direction)) {
    reverse = false;
    bidir = protocol === "TCP" ? true : bidir;
  }
  const udpBitrateMbps = resolveDigits(String(setup.udpBitrateMbps ?? ""), "10");
  const parts = ["iperf3", "-c", server, "-p", port, "-t", duration, "-i", interval];
  if (Number(streams) > 1) parts.push("-P", streams);
  if (protocol === "UDP") parts.push("-u", "-b", `${udpBitrateMbps}M`);
  if (bidir) parts.push("--bidir");
  else if (reverse) parts.push("-R");
  parts.push("-J");
  return parts.join(" ");
}

/**
 * Consistency check between saved command text and direction / process stdout flags.
 * Hard-fails on direction/command mismatches (STEP 1J2-F9). Does not alter execution.
 */
export function assertIperfCommandConsistency({
  command = "",
  directionKey = "",
  reverseMode = false,
  bidirMode = false,
  processReverse = null,
  processBidir = null,
} = {}) {
  const warnings = [];
  const errors = [];
  const tokens = String(command || "").trim().split(/\s+/).filter(Boolean);
  const hasBidir = tokens.includes("--bidir");
  const hasReverse = tokens.includes("-R") || tokens.includes("--reverse");
  const dir = String(directionKey || "").toLowerCase();

  if (dir === "ul" && (hasBidir || bidirMode === true)) {
    errors.push("UL direction must not include --bidir.");
  }
  if (dir === "ul" && (hasReverse || reverseMode === true)) {
    errors.push("UL direction must not include reverse (-R).");
  }
  if (dir === "dl" && hasBidir) {
    errors.push("DL direction should use reverse (-R), not --bidir.");
  }
  if (dir === "dl" && !hasReverse && reverseMode !== true) {
    errors.push("INTERNAL_DIRECTION_MISMATCH: selected DL but executed command lacks -R.");
  }
  if (dir === "dl_ul" && !hasBidir && bidirMode !== true) {
    errors.push("INTERNAL_DIRECTION_MISMATCH: bidirectional direction expects --bidir.");
  }
  if (processReverse != null && Boolean(processReverse) !== hasReverse && dir !== "dl_ul") {
    errors.push(`Saved command reverse flag mismatch vs process test_start.reverse=${processReverse}.`);
  }
  if (processBidir != null && Boolean(processBidir) !== hasBidir) {
    errors.push(`Saved command bidir flag mismatch vs process test_start.bidir=${processBidir}.`);
  }
  if (dir === "dl" && processReverse === false) {
    errors.push("INTERNAL_DIRECTION_MISMATCH: selected DL but process test_start.reverse=0.");
  }
  if (dir === "dl_ul" && processBidir === false) {
    errors.push("INTERNAL_DIRECTION_MISMATCH: selected DL+UL but process test_start.bidir=0.");
  }
  return {
    ok: errors.length === 0,
    hardFail: errors.length > 0,
    errors,
    warnings,
    message: errors[0] || warnings[0] || null,
  };
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
    reverseMode: base.reverseMode === true,
    bidirMode: base.bidirMode === true,
  };
}

const DANGEROUS_SHELL_PATTERN = /;|&&|\|\||\$\(|`|\|>|>>|<<|(?<![=<>!])>(?!=)|(?<![=<>!])<(?!=)/;

export function isDlUlDirection(direction = "") {
  return String(direction || "").toLowerCase() === "dl_ul";
}

function applyDlUlBidirPolicy(setup = {}, { usedParsedCommand = false } = {}) {
  if (!isDlUlDirection(setup.direction)) {
    return setup;
  }

  const protocol = String(setup.protocol || "TCP").toUpperCase();

  if (usedParsedCommand) {
    if (setup.bidirMode !== true) {
      return {
        ...setup,
        _bidirError: "Bidirectional requires --bidir and server support.",
      };
    }
    return { ...setup, bidirMode: true, reverseMode: false };
  }

  if (protocol === "UDP") {
    return {
      ...setup,
      _bidirError: "UDP bidirectional (DL+UL) is not supported from form settings. Use TCP or paste a command with --bidir if your server supports it.",
    };
  }

  return { ...setup, bidirMode: true, reverseMode: false };
}

export function hasDangerousShellOperators(commandText = "") {
  return DANGEROUS_SHELL_PATTERN.test(String(commandText || ""));
}

export function resolveIperf3RunSetup(setup = {}, fallback = {}) {
  const base = sanitizeIperfSetup(setup, fallback);
  const result = {
    ok: false,
    error: "",
    warnings: [],
    setup: { ...base },
  };

  const commandText = String(setup.customerCommand || setup.rawCommand || "").trim();
  let usedParsedCommand = false;

  if (setup.commandMode === true && commandText) {
    if (hasDangerousShellOperators(commandText)) {
      result.error = "Command contains unsupported shell operators. Use plain iPerf3 flags only.";
      return result;
    }

    const parsed = parseIperf3Command(commandText, base);
    result.warnings = parsed.warnings || [];
    if (parsed.ok) {
      usedParsedCommand = true;
      result.setup = sanitizeIperfSetup({
        ...base,
        ...parsed.values,
        reverseMode: parsed.values.reverseMode === true,
        bidirMode: parsed.values.bidirMode === true,
      }, base);
    }
  }

  if (!String(result.setup.server || "").trim()) {
    result.error = "iPerf3 server host is required.";
    return result;
  }

  result.setup = applyDlUlBidirPolicy(result.setup, { usedParsedCommand });
  if (result.setup._bidirError) {
    result.error = result.setup._bidirError;
    const { _bidirError, ...cleanSetup } = result.setup;
    result.setup = cleanSetup;
    return result;
  }

  // Enforce direction → flag mapping unless a pasted command already set modes.
  if (!usedParsedCommand) {
    const dir = String(result.setup.direction || "").toLowerCase();
    if (dir === "dl") {
      result.setup.reverseMode = true;
      result.setup.bidirMode = false;
    } else if (dir === "ul") {
      result.setup.reverseMode = false;
      result.setup.bidirMode = false;
    } else if (dir === "dl_ul") {
      // applyDlUlBidirPolicy already forced bidir for TCP; keep reverse off.
      result.setup.reverseMode = false;
      if (String(result.setup.protocol || "TCP").toUpperCase() === "TCP") {
        result.setup.bidirMode = true;
      }
    }
  }

  result.setup.reverseMode = result.setup.reverseMode === true;
  result.setup.bidirMode = result.setup.bidirMode === true;
  result.ok = true;
  return result;
}

export function buildIperf3ArgListFromSetup(setup = {}) {
  const resolved = sanitizeIperfSetup(setup);
  const server = String(resolved.server || "").trim();
  const port = resolvePort(resolved.port, "5201");
  const duration = resolveDigits(String(resolved.durationSeconds ?? ""), "10");
  const interval = resolveDigits(String(resolved.intervalSeconds ?? ""), "1");
  const streams = resolveDigits(String(resolved.streams ?? ""), "1");
  const protocol = String(resolved.protocol || "TCP").toUpperCase();
  const udpBitrateMbps = resolveDigits(String(resolved.udpBitrateMbps ?? ""), "10");
  const bidir = resolved.bidirMode === true
    || (isDlUlDirection(resolved.direction) && protocol === "TCP" && resolved.reverseMode !== true);
  const args = ["-c", server, "-p", port, "-t", duration, "-i", interval];

  if (Number(streams) > 1) {
    args.push("-P", streams);
  }
  if (protocol === "UDP") {
    args.push("-u", "-b", `${udpBitrateMbps}M`);
  }
  if (bidir) {
    args.push("--bidir");
  } else if (resolved.reverseMode === true) {
    args.push("-R");
  }
  args.push("-J");
  return args;
}
