import { Capacitor, registerPlugin } from "@capacitor/core";

const BabyDragonRfKpi = registerPlugin("BabyDragonRfKpi");

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Screenshot file is missing."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read screenshot file."));
    reader.readAsDataURL(file);
  });
}

export async function recognizeOoklaBase64Image(base64Image = "") {
  if (Capacitor.getPlatform() === "web") {
    return {
      ok: false,
      text: "",
      lines: [],
      confidence: null,
      error: "OCR engine pending on web preview. Use Android APK for ML Kit OCR.",
      engine: "pending",
    };
  }

  if (typeof BabyDragonRfKpi.recognizeTextFromImage !== "function") {
    return {
      ok: false,
      text: "",
      lines: [],
      confidence: null,
      error: "OCR engine pending. Native recognizeTextFromImage is not available in this build.",
      engine: "pending",
    };
  }

  const payload = String(base64Image || "").trim();
  if (!payload) {
    return {
      ok: false,
      text: "",
      lines: [],
      confidence: null,
      error: "base64Image is required",
      engine: "mlkit",
    };
  }

  const response = await BabyDragonRfKpi.recognizeTextFromImage({ base64Image: payload });
  return {
    ok: response?.ok === true,
    text: String(response?.text || ""),
    lines: Array.isArray(response?.lines) ? response.lines : [],
    confidence: Number.isFinite(response?.confidence) ? response.confidence : null,
    error: response?.error ? String(response.error) : null,
    engine: "mlkit",
  };
}

export async function recognizeOoklaScreenshotText(file) {
  try {
    const base64Image = await fileToBase64(file);
    return recognizeOoklaBase64Image(base64Image);
  } catch (error) {
    return {
      ok: false,
      text: "",
      lines: [],
      confidence: null,
      error: String(error?.message || error || "Unable to read screenshot file."),
      engine: "mlkit",
    };
  }
}
