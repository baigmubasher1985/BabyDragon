import { Capacitor, registerPlugin } from "@capacitor/core";

const BabyDragonRfKpi = registerPlugin("BabyDragonRfKpi");

const WEBVIEW_FETCH_TIMEOUT_MS = 12000;

async function fetchOoklaResultViaWebView(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), WEBVIEW_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml,*/*" },
    });
    window.clearTimeout(timeoutId);
    const text = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      finalUrl: response.url || url,
      text,
      error: response.ok ? null : `http_${response.status}`,
      engine: "webview",
    };
  } catch (error) {
    window.clearTimeout(timeoutId);
    return {
      ok: false,
      statusCode: null,
      finalUrl: null,
      text: null,
      error: String(error?.message || error || "webview_fetch_failed"),
      engine: "webview",
    };
  }
}

export async function fetchOoklaResultViaNative(url = "") {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: null,
      text: null,
      error: "missing_url",
      engine: "none",
    };
  }

  if (Capacitor.getPlatform() !== "web" && typeof BabyDragonRfKpi.fetchOoklaResultPage === "function") {
    try {
      const response = await BabyDragonRfKpi.fetchOoklaResultPage({ url: trimmed });
      return {
        ok: response?.ok === true,
        statusCode: Number.isFinite(response?.statusCode) ? response.statusCode : null,
        finalUrl: response?.finalUrl ? String(response.finalUrl) : null,
        text: response?.text ? String(response.text) : null,
        error: response?.error ? String(response.error) : null,
        engine: "native",
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        finalUrl: null,
        text: null,
        error: String(error?.message || error || "native_fetch_failed"),
        engine: "native",
      };
    }
  }

  return fetchOoklaResultViaWebView(trimmed);
}

export async function fetchOoklaShareImageBase64(imageUrl = "") {
  const trimmed = String(imageUrl || "").trim();
  if (!trimmed) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: null,
      base64Image: null,
      contentType: null,
      error: "missing_url",
      engine: "none",
    };
  }

  if (Capacitor.getPlatform() !== "web" && typeof BabyDragonRfKpi.fetchOoklaResultShareImage === "function") {
    try {
      const response = await BabyDragonRfKpi.fetchOoklaResultShareImage({ url: trimmed });
      const raw = response?.base64Image ? String(response.base64Image) : "";
      const contentType = response?.contentType ? String(response.contentType) : "image/png";
      const base64Image = raw
        ? (raw.startsWith("data:") ? raw : `data:${contentType};base64,${raw}`)
        : null;
      return {
        ok: response?.ok === true && Boolean(base64Image),
        statusCode: Number.isFinite(response?.statusCode) ? response.statusCode : null,
        finalUrl: response?.finalUrl ? String(response.finalUrl) : null,
        base64Image,
        contentType,
        error: response?.error ? String(response.error) : null,
        engine: "native",
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        finalUrl: null,
        base64Image: null,
        contentType: null,
        error: String(error?.message || error || "native_share_image_fetch_failed"),
        engine: "native",
      };
    }
  }

  return {
    ok: false,
    statusCode: null,
    finalUrl: null,
    base64Image: null,
    contentType: null,
    error: "share_image_fetch_unavailable",
    engine: Capacitor.getPlatform() === "web" ? "pending" : "none",
  };
}
