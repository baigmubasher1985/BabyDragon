package com.mobbitechglobal.babydragon;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Process-wide buffer for native mobility samples collected while JS/WebView may be suspended.
 * Shared by BabyDragonMobilityService (writer) and BabyDragonRfKpiPlugin (reader).
 */
public final class BabyDragonMobilityBuffer {
    private static final String TAG = "BabyDragonMobilityBuffer";
    private static final int MAX_SAMPLES = 20000;
    private static final Object LOCK = new Object();
    private static final List<JSObject> SAMPLES = new ArrayList<>();
    private static volatile String sessionId = "";
    private static volatile long startedAtMs = 0L;
    private static volatile long lastGpsFixMs = 0L;
    private static volatile long lastRfSampleMs = 0L;
    private static volatile int droppedOverflow = 0;
    private static volatile int nativeRfSampleCount = 0;
    private static volatile int nativeGpsSampleCount = 0;
    private static volatile long bufferOldestTimestamp = 0L;
    private static volatile long bufferNewestTimestamp = 0L;
    private static volatile long lastDrainTimestamp = 0L;
    private static volatile int lastDrainCount = 0;
    private static volatile String lastDrainError = "";

    private BabyDragonMobilityBuffer() {}

    public static void reset(String newSessionId) {
        synchronized (LOCK) {
            SAMPLES.clear();
            sessionId = newSessionId != null ? newSessionId : "";
            startedAtMs = System.currentTimeMillis();
            lastGpsFixMs = 0L;
            lastRfSampleMs = 0L;
            droppedOverflow = 0;
            nativeRfSampleCount = 0;
            nativeGpsSampleCount = 0;
            bufferOldestTimestamp = 0L;
            bufferNewestTimestamp = 0L;
            lastDrainTimestamp = 0L;
            lastDrainCount = 0;
            lastDrainError = "";
            Log.i(TAG, "reset sessionId=" + sessionId + " identity=" + System.identityHashCode(SAMPLES));
        }
    }

    public static void clear() {
        synchronized (LOCK) {
            SAMPLES.clear();
            sessionId = "";
            startedAtMs = 0L;
            lastGpsFixMs = 0L;
            lastRfSampleMs = 0L;
            droppedOverflow = 0;
            nativeRfSampleCount = 0;
            nativeGpsSampleCount = 0;
            bufferOldestTimestamp = 0L;
            bufferNewestTimestamp = 0L;
            Log.i(TAG, "clear identity=" + System.identityHashCode(SAMPLES));
        }
    }

    public static void add(JSObject sample) {
        if (sample == null) return;
        synchronized (LOCK) {
            if (SAMPLES.size() >= MAX_SAMPLES) {
                SAMPLES.remove(0);
                droppedOverflow += 1;
                if (!SAMPLES.isEmpty()) {
                    try {
                        bufferOldestTimestamp = SAMPLES.get(0).getLong("timestamp");
                    } catch (Exception ignored) {
                        bufferOldestTimestamp = 0L;
                    }
                } else {
                    bufferOldestTimestamp = 0L;
                }
            }
            long ts = System.currentTimeMillis();
            try {
                if (sample.has("timestamp")) ts = sample.getLong("timestamp");
            } catch (Exception ignored) {
                // keep wall clock
            }
            if (SAMPLES.isEmpty()) bufferOldestTimestamp = ts;
            bufferNewestTimestamp = ts;
            SAMPLES.add(sample);
            lastRfSampleMs = ts;
            nativeRfSampleCount += 1;

            JSObject gps = sample.getJSObject("gps");
            if (gps != null) {
                try {
                    if (gps.has("location_fix_timestamp_ms") && !gps.isNull("location_fix_timestamp_ms")) {
                        lastGpsFixMs = gps.getLong("location_fix_timestamp_ms");
                        nativeGpsSampleCount += 1;
                    }
                } catch (Exception ignored) {
                    // keep previous
                }
            }
            if (nativeRfSampleCount <= 3 || nativeRfSampleCount % 10 == 0) {
                Log.i(TAG, "add count=" + SAMPLES.size()
                    + " nativeRfSampleCount=" + nativeRfSampleCount
                    + " sessionId=" + sessionId
                    + " identity=" + System.identityHashCode(SAMPLES));
            }
        }
    }

    public static void noteGpsFix(long fixMs) {
        if (fixMs > 0L) {
            lastGpsFixMs = fixMs;
            nativeGpsSampleCount += 1;
        }
    }

    /** Drain all buffered samples (destructive). */
    public static JSObject drain() {
        List<JSObject> copy;
        synchronized (LOCK) {
            copy = new ArrayList<>(SAMPLES);
            SAMPLES.clear();
            bufferOldestTimestamp = 0L;
            bufferNewestTimestamp = 0L;
            lastDrainTimestamp = System.currentTimeMillis();
            lastDrainCount = copy.size();
            lastDrainError = "";
        }
        JSArray array = new JSArray();
        for (JSObject item : copy) {
            array.put(item);
        }
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("sessionId", sessionId);
        result.put("count", copy.size());
        result.put("samples", array);
        result.put("droppedOverflow", droppedOverflow);
        result.put("lastGpsFixMs", lastGpsFixMs);
        result.put("lastRfSampleMs", lastRfSampleMs);
        result.put("startedAtMs", startedAtMs);
        result.put("bufferedRemaining", 0);
        result.put("bufferIdentity", System.identityHashCode(SAMPLES));
        Log.i(TAG, "drain count=" + copy.size()
            + " sessionId=" + sessionId
            + " identity=" + System.identityHashCode(SAMPLES));
        return result;
    }

    public static void noteDrainError(String error) {
        lastDrainError = error != null ? error : "unknown";
        lastDrainTimestamp = System.currentTimeMillis();
        Log.e(TAG, "drain error: " + lastDrainError);
    }

    public static JSObject status() {
        synchronized (LOCK) {
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("sessionId", sessionId);
            result.put("bufferedCount", SAMPLES.size());
            result.put("bufferCount", SAMPLES.size());
            result.put("droppedOverflow", droppedOverflow);
            result.put("lastGpsFixMs", lastGpsFixMs);
            result.put("lastRfSampleMs", lastRfSampleMs);
            result.put("startedAtMs", startedAtMs);
            result.put("nativeRfSampleCount", nativeRfSampleCount);
            result.put("nativeGpsSampleCount", nativeGpsSampleCount);
            result.put("bufferOldestTimestamp", bufferOldestTimestamp);
            result.put("bufferNewestTimestamp", bufferNewestTimestamp);
            result.put("lastDrainTimestamp", lastDrainTimestamp);
            result.put("lastDrainCount", lastDrainCount);
            result.put("lastDrainError", lastDrainError != null ? lastDrainError : "");
            result.put("bufferIdentity", System.identityHashCode(SAMPLES));
            return result;
        }
    }
}
