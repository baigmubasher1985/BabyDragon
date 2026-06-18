import { BabyDragonIperf } from "../plugins/babyDragonIperf";

const asNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const buildIperf3Payload = (setup = {}) => ({
  server: String(setup.server || "ping.online.net").trim(),
  port: asNumber(setup.port, 5201),
  protocol: String(setup.protocol || "TCP").toUpperCase(),
  direction: String(setup.direction || "dl").toLowerCase(),
  durationSeconds: asNumber(setup.durationSeconds, 10),
  intervalSeconds: asNumber(setup.intervalSeconds, 1),
  streams: asNumber(setup.streams, 1),
  reverseMode: setup.reverseMode !== false,
  udpBitrateMbps: asNumber(setup.udpBitrateMbps, 10),
  commandMode: setup.commandMode === true,
  customerCommand: String(setup.customerCommand || setup.rawCommand || "").trim(),
  rawCommand: String(setup.rawCommand || setup.customerCommand || "").trim(),
});

export async function getIperf3Status() {
  return BabyDragonIperf.getIperfStatus();
}

export async function prepareIperf3Binary() {
  return BabyDragonIperf.prepareIperfBinary();
}

export async function runIperf3Once(setup, onProgress) {
  let listener = null;
  const payload = buildIperf3Payload(setup);

  try {
    listener = await BabyDragonIperf.addListener("iperfProgress", (event) => {
      if (typeof onProgress === "function") onProgress(event);
    });

    return await BabyDragonIperf.runIperf3(payload);
  } finally {
    if (listener) await listener.remove();
  }
}
