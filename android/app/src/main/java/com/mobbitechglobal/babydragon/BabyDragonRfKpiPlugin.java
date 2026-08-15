package com.mobbitechglobal.babydragon;

import android.Manifest;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.content.Context;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.TrafficStats;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.os.Environment;
import android.provider.MediaStore;
import android.telephony.CellIdentityCdma;
import android.telephony.CellIdentityGsm;
import android.telephony.CellIdentityLte;
import android.telephony.CellIdentityNr;
import android.telephony.CellIdentityWcdma;
import android.telephony.CellInfo;
import android.telephony.CellInfoCdma;
import android.telephony.CellInfoGsm;
import android.telephony.CellInfoLte;
import android.telephony.CellInfoNr;
import android.telephony.CellInfoWcdma;
import android.telephony.CellSignalStrength;
import android.telephony.CellSignalStrengthCdma;
import android.telephony.CellSignalStrengthGsm;
import android.telephony.CellSignalStrengthLte;
import android.telephony.CellSignalStrengthNr;
import android.telephony.CellSignalStrengthWcdma;
import android.telephony.SignalStrength;
import android.telephony.TelephonyManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

@CapacitorPlugin(
    name = "BabyDragonRfKpi",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.READ_PHONE_STATE }, alias = "phoneState")
    }
)
public class BabyDragonRfKpiPlugin extends Plugin {

    private static final int UNAVAILABLE = CellInfo.UNAVAILABLE;
    private static final long FRESH_CELL_TIMEOUT_MS = 850L;
    private static final int DEFAULT_DOWNLOAD_BYTES = 8 * 1024 * 1024;
    private static final int DEFAULT_UPLOAD_BYTES = 3 * 1024 * 1024;
    private static final int DEFAULT_THP_TIMEOUT_MS = 8000;
    private static final String DEFAULT_DOWNLOAD_URL = "https://speed.cloudflare.com/__down";
    private static final String DEFAULT_UPLOAD_URL = "https://speed.cloudflare.com/__up";
    private static final AtomicLong SNAPSHOT_SEQUENCE = new AtomicLong(0L);
    private static volatile BabyDragonRfKpiPlugin sInstance = null;

    @Override
    public void load() {
        super.load();
        sInstance = this;
    }

    /**
     * Build an RF+TrafficStats snapshot for the mobility service collector.
     * Safe to call from the service main-thread RF ticker.
     */
    public static JSObject buildMobilityRfSnapshot(Context context) {
        BabyDragonRfKpiPlugin plugin = sInstance;
        if (plugin != null) {
            return plugin.createSnapshotObject(context != null ? context : plugin.getContext());
        }
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("status", "plugin_not_loaded");
        return result;
    }

    public static void emitMobilitySampleHint() {
        BabyDragonRfKpiPlugin plugin = sInstance;
        if (plugin == null) return;
        try {
            JSObject hint = BabyDragonMobilityBuffer.status();
            plugin.notifyListeners("mobilitySampleBuffered", hint);
        } catch (Exception ignored) {
            // Bridge may be suspended; buffer remains authoritative.
        }
    }

    private JSObject createSnapshotObject(Context context) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("timestamp", System.currentTimeMillis());
        result.put("snapshotSequence", SNAPSHOT_SEQUENCE.incrementAndGet());
        result.put("source", "android-telephony-v1.1.0-step-1f3-heartbeat-cellinfo-signalstrength-raw");

        JSObject permissions = buildPermissionStatus(context);
        result.put("permissions", permissions);

        boolean hasFineLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;

        if (!hasFineLocation) {
            result.put("status", "missing_location_permission");
            result.put("message", "ACCESS_FINE_LOCATION is required before Android can expose cell RF information.");
            return result;
        }

        TelephonyManager telephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
        if (telephonyManager == null) {
            result.put("status", "telephony_unavailable");
            result.put("message", "Telephony service is unavailable on this device.");
            return result;
        }

        result.put("freshReadMode", "mobility_service_1s");
        resolveSnapshotInto(result, context, telephonyManager, safeGetAllCellInfo(telephonyManager), "getAllCellInfo_mobility_service");
        return result;
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        JSObject result = createSnapshotObject(getContext());
        // Preserve prior fast-poll mode labeling for UI-driven reads.
        if ("getAllCellInfo_mobility_service".equals(result.getString("readMode"))) {
            result.put("freshReadMode", "fast_1s_poll");
            result.put("readMode", "getAllCellInfo_fast_1s_poll");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void drainMobilitySamples(PluginCall call) {
        try {
            call.resolve(BabyDragonMobilityBuffer.drain());
        } catch (Exception exception) {
            BabyDragonMobilityBuffer.noteDrainError(exception.getMessage());
            JSObject result = new JSObject();
            result.put("ok", false);
            result.put("count", 0);
            result.put("samples", new JSArray());
            result.put("message", exception.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void getMobilityBufferStatus(PluginCall call) {
        JSObject status = BabyDragonMobilityBuffer.status();
        status.put("serviceRunning", BabyDragonMobilityService.isRunning());
        status.put("rfTickerActive", BabyDragonMobilityService.isRfTickerActive());
        call.resolve(status);
    }

    @PluginMethod
    public void getMobilityDiagnostics(PluginCall call) {
        JSObject diagnostics = BabyDragonMobilityService.buildDiagnostics(getContext());
        diagnostics.put("pluginLoaded", sInstance != null);
        diagnostics.put("ok", true);
        android.util.Log.i("BabyDragonRfKpiPlugin", "getMobilityDiagnostics " + diagnostics.toString());
        call.resolve(diagnostics);
    }

    @PluginMethod
    public void requestRfPermissions(PluginCall call) {
        Context context = getContext();
        boolean hasFineLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarseLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
        boolean hasPhoneState = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED;

        if ((hasFineLocation || hasCoarseLocation) && hasPhoneState) {
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("permissions", buildPermissionStatus(context));
            result.put("message", "RF permissions already granted.");
            call.resolve(result);
            return;
        }

        try {
            requestPermissionForAliases(new String[] { "location", "phoneState" }, call, "rfPermissionsCallback");
        } catch (Exception exception) {
            JSObject result = new JSObject();
            result.put("ok", false);
            result.put("permissions", buildPermissionStatus(context));
            result.put("message", exception.getMessage());
            call.resolve(result);
        }
    }

    @PermissionCallback
    private void rfPermissionsCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("permissions", buildPermissionStatus(getContext()));
        result.put("message", "RF permission check completed.");
        call.resolve(result);
    }

    /**
     * Start the mobility foreground service from an explicit FE Start action.
     * Types: location | dataSync. Notification is ongoing with Stop action.
     */
    @PluginMethod
    public void startMobilityForegroundService(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("accepted", false);
        result.put("serviceStarted", false);
        result.put("rfTickerActive", false);
        result.put("locationSubscriptionActive", false);
        result.put("bufferCount", 0);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                boolean hasPost = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED;
                result.put("notificationsPermission", hasPost);
            } else {
                result.put("notificationsPermission", true);
            }

            String sessionId = call.getString("sessionId", "");
            boolean alreadyRunning = BabyDragonMobilityService.isRunning();
            String runningSessionId = BabyDragonMobilityService.getSessionId();
            boolean sameSession = alreadyRunning
                && sessionId != null
                && !sessionId.isEmpty()
                && sessionId.equals(runningSessionId);

            // Idempotent start: do not wipe the live buffer when the same session is already running.
            if (!sameSession) {
                BabyDragonMobilityBuffer.reset(sessionId);
            }

            Intent intent = new Intent(context, BabyDragonMobilityService.class);
            intent.putExtra(BabyDragonMobilityService.EXTRA_TITLE, call.getString("title", "BabyDragon mobility test"));
            intent.putExtra(BabyDragonMobilityService.EXTRA_TEXT, call.getString("text", "Recording RF / GPS / data test"));
            intent.putExtra(BabyDragonMobilityService.EXTRA_STATUS, call.getString("status", "running"));
            intent.putExtra(BabyDragonMobilityService.EXTRA_SESSION_ID, sessionId);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            result.put("accepted", true);
            result.put("idempotentAttach", sameSession);

            // Do not Thread.sleep on the Capacitor bridge thread — that blocks other plugin calls
            // (including permission callbacks and drain). JS polls diagnostics for readiness.
            try {
                Thread.yield();
            } catch (Exception ignored) {
            }

            JSObject diagnostics = BabyDragonMobilityService.buildDiagnostics(context);
            boolean serviceStarted = BabyDragonMobilityService.isRunning();
            boolean rfTickerActive = BabyDragonMobilityService.isRfTickerActive();
            boolean locationActive = BabyDragonMobilityService.isLocationSubscriptionActive();
            int bufferCount = 0;
            try { bufferCount = diagnostics.getInt("bufferCount"); } catch (Exception ignored) {}

            result.put("ok", serviceStarted && rfTickerActive);
            result.put("running", serviceStarted);
            result.put("serviceStarted", serviceStarted);
            result.put("rfTickerActive", rfTickerActive);
            result.put("locationSubscriptionActive", locationActive);
            result.put("locationSubscriptionReason", diagnostics.getString("locationSubscriptionReason", ""));
            result.put("bufferCount", bufferCount);
            result.put("sessionId", sessionId);
            result.put("serviceTypes", "location|dataSync");
            result.put("diagnostics", diagnostics);

            if (!serviceStarted) {
                result.put("message", "Service not running: " + diagnostics.getString("lastServiceError", "startForeground failed"));
            } else if (!rfTickerActive) {
                result.put("message", "RF ticker not active after service start");
            } else if (!locationActive) {
                result.put("message", "Service + RF ticker active; location subscription unavailable: "
                    + diagnostics.getString("locationSubscriptionReason", "unknown"));
            } else {
                result.put("message", "Mobility foreground service started with RF ticker and location subscription.");
            }
            android.util.Log.i("BabyDragonRfKpiPlugin", "startMobilityForegroundService "
                + "ok=" + result.getBoolean("ok")
                + " serviceStarted=" + serviceStarted
                + " rfTickerActive=" + rfTickerActive
                + " locationActive=" + locationActive
                + " bufferCount=" + bufferCount
                + " sessionId=" + sessionId);
            call.resolve(result);
        } catch (Exception exception) {
            result.put("ok", false);
            result.put("accepted", false);
            result.put("running", BabyDragonMobilityService.isRunning());
            result.put("serviceStarted", BabyDragonMobilityService.isRunning());
            result.put("rfTickerActive", BabyDragonMobilityService.isRfTickerActive());
            result.put("message", exception.getMessage());
            android.util.Log.e("BabyDragonRfKpiPlugin", "startMobilityForegroundService failed", exception);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void stopMobilityForegroundService(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        try {
            Intent intent = new Intent(context, BabyDragonMobilityService.class);
            intent.setAction(BabyDragonMobilityService.ACTION_STOP);
            context.startService(intent);
            context.stopService(new Intent(context, BabyDragonMobilityService.class));
            BabyDragonMobilityBuffer.clear();
            result.put("ok", true);
            result.put("running", false);
            result.put("message", "Mobility foreground service stopped.");
            call.resolve(result);
        } catch (Exception exception) {
            result.put("ok", false);
            result.put("running", BabyDragonMobilityService.isRunning());
            result.put("message", exception.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void getMobilityForegroundServiceStatus(PluginCall call) {
        JSObject result = BabyDragonMobilityService.buildDiagnostics(getContext());
        result.put("ok", true);
        result.put("running", BabyDragonMobilityService.isRunning());
        result.put("serviceTypes", "location|dataSync");
        call.resolve(result);
    }

    private void requestFreshCellInfo(
        PluginCall call,
        Context context,
        TelephonyManager telephonyManager,
        JSObject result
    ) {
        Handler mainHandler = new Handler(Looper.getMainLooper());
        final boolean[] resolved = { false };

        Runnable fallback = new Runnable() {
            @Override
            public void run() {
                if (resolved[0]) return;
                resolved[0] = true;
                result.put("freshReadMode", "timeout_fallback");
                resolveSnapshot(call, context, telephonyManager, result, safeGetAllCellInfo(telephonyManager), "getAllCellInfo_timeout_fallback");
            }
        };

        mainHandler.postDelayed(fallback, FRESH_CELL_TIMEOUT_MS);

        try {
            Executor executor = new Executor() {
                @Override
                public void execute(Runnable command) {
                    mainHandler.post(command);
                }
            };

            telephonyManager.requestCellInfoUpdate(executor, new TelephonyManager.CellInfoCallback() {
                @Override
                public void onCellInfo(List<CellInfo> cellInfo) {
                    if (resolved[0]) return;
                    resolved[0] = true;
                    mainHandler.removeCallbacks(fallback);
                    result.put("freshReadMode", "requestCellInfoUpdate");
                    resolveSnapshot(call, context, telephonyManager, result, cellInfo, "requestCellInfoUpdate");
                }

                @Override
                public void onError(int errorCode, Throwable detail) {
                    if (resolved[0]) return;
                    resolved[0] = true;
                    mainHandler.removeCallbacks(fallback);
                    result.put("freshReadMode", "request_error_fallback");
                    result.put("freshReadErrorCode", errorCode);
                    if (detail != null && detail.getMessage() != null) {
                        result.put("freshReadError", detail.getMessage());
                    }
                    resolveSnapshot(call, context, telephonyManager, result, safeGetAllCellInfo(telephonyManager), "getAllCellInfo_error_fallback");
                }
            });
        } catch (Exception exception) {
            if (resolved[0]) return;
            resolved[0] = true;
            mainHandler.removeCallbacks(fallback);
            result.put("freshReadMode", "request_failed_fallback");
            result.put("freshReadError", exception.getMessage());
            resolveSnapshot(call, context, telephonyManager, result, safeGetAllCellInfo(telephonyManager), "getAllCellInfo_request_failed_fallback");
        }
    }

    private List<CellInfo> safeGetAllCellInfo(TelephonyManager telephonyManager) {
        try {
            return telephonyManager.getAllCellInfo();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void resolveSnapshot(
        PluginCall call,
        Context context,
        TelephonyManager telephonyManager,
        JSObject result,
        List<CellInfo> cellInfoList,
        String readMode
    ) {
        resolveSnapshotInto(result, context, telephonyManager, cellInfoList, readMode);
        call.resolve(result);
    }

    private void resolveSnapshotInto(
        JSObject result,
        Context context,
        TelephonyManager telephonyManager,
        List<CellInfo> cellInfoList,
        String readMode
    ) {
        try {
            result.put("timestamp", System.currentTimeMillis());
            result.put("readMode", readMode);
            result.put("carrierName", safeText(telephonyManager.getNetworkOperatorName()));
            result.put("simCarrierName", safeText(telephonyManager.getSimOperatorName()));
            result.put("networkOperator", safeText(safeGetNetworkOperator(telephonyManager)));

            int dataNetworkType = safeGetDataNetworkType(telephonyManager);
            String dataNetworkTypeName = networkTypeName(dataNetworkType);
            result.put("dataNetworkType", dataNetworkType);
            result.put("dataNetworkTypeName", dataNetworkTypeName);
            result.put("callState", safeGetCallState(context, telephonyManager));

            JSObject signalStrengthSnapshot = buildSignalStrengthSnapshot(context, telephonyManager);
            JSObject lteSignalStrength = optJSObject(signalStrengthSnapshot, "lte");
            JSObject nrSignalStrength = optJSObject(signalStrengthSnapshot, "nr");
            JSObject wcdmaSignalStrength = optJSObject(signalStrengthSnapshot, "wcdma");
            JSObject gsmSignalStrength = optJSObject(signalStrengthSnapshot, "gsm");

            result.put("signalStrength", signalStrengthSnapshot);

            JSArray cells = new JSArray();
            JSArray servingCells = new JSArray();
            JSArray neighbors = new JSArray();

            JSObject firstCell = null;
            JSObject firstServing = null;
            JSObject lteAnchor = null;
            JSObject nrSecondary = null;
            JSObject threeGServing = null;
            JSObject twoGServing = null;

            if (cellInfoList != null) {
                for (CellInfo cellInfo : cellInfoList) {
                    JSObject parsed = parseCellInfo(cellInfo);
                    cells.put(parsed);

                    if (firstCell == null) {
                        firstCell = parsed;
                    }

                    boolean registered = cellInfo.isRegistered();
                    boolean servingOrSecondary = isServingOrSecondary(cellInfo);

                    if (registered || servingOrSecondary) {
                        servingCells.put(parsed);
                        if (firstServing == null) {
                            firstServing = parsed;
                        }
                    } else {
                        neighbors.put(parsed);
                    }

                    if (lteAnchor == null && cellInfo instanceof CellInfoLte && servingOrSecondary) {
                        parsed.put("role", "LTE Anchor");
                        parsed.put("identityExposed", true);
                        lteAnchor = parsed;
                    }

                    if (nrSecondary == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && cellInfo instanceof CellInfoNr && servingOrSecondary) {
                        parsed.put("role", "NR Secondary");
                        parsed.put("identityExposed", true);
                        nrSecondary = parsed;
                    }

                    if (threeGServing == null && (cellInfo instanceof CellInfoWcdma || cellInfo instanceof CellInfoCdma) && servingOrSecondary) {
                        parsed.put("role", "3G Serving");
                        parsed.put("identityExposed", true);
                        threeGServing = parsed;
                    }

                    if (twoGServing == null && cellInfo instanceof CellInfoGsm && servingOrSecondary) {
                        parsed.put("role", "2G Serving");
                        parsed.put("identityExposed", true);
                        twoGServing = parsed;
                    }
                }
            }

            if (hasCellObject(lteAnchor)) {
                mergeSignalFallback(lteAnchor, lteSignalStrength, "LTE");
            }

            if (hasCellObject(nrSecondary)) {
                mergeSignalFallback(nrSecondary, nrSignalStrength, "NR");
            } else if (hasSignalMeasurement(nrSignalStrength)) {
                nrSecondary = buildMeasurementOnlyCell(nrSignalStrength, "NR", "5G NR", "NR Secondary");
            }

            if (hasCellObject(threeGServing)) {
                mergeSignalFallback(threeGServing, wcdmaSignalStrength, "3G");
            } else if (hasSignalMeasurement(wcdmaSignalStrength)) {
                threeGServing = buildMeasurementOnlyCell(wcdmaSignalStrength, "WCDMA", "3G WCDMA", "3G Serving");
            }

            if (hasCellObject(twoGServing)) {
                mergeSignalFallback(twoGServing, gsmSignalStrength, "2G");
            } else if (hasSignalMeasurement(gsmSignalStrength)) {
                twoGServing = buildMeasurementOnlyCell(gsmSignalStrength, "GSM", "2G GSM", "2G Serving");
            }

            boolean hasLteAnchor = hasRat(lteAnchor, "LTE");
            boolean hasNrSecondary = hasRat(nrSecondary, "NR");
            boolean nrMeasurementOnly = hasNrSecondary && nrSecondary.optBoolean("measurementOnly", false);
            boolean dataSaysNr = dataNetworkType == TelephonyManager.NETWORK_TYPE_NR;
            boolean nsaCandidate = hasLteAnchor && (hasNrSecondary || dataSaysNr || hasSignalMeasurement(nrSignalStrength));

            JSObject emptyObject = new JSObject();
            result.put("ok", true);
            result.put("cells", cells);
            result.put("servingCells", servingCells);
            result.put("neighbors", neighbors);
            result.put("cellCount", cells.length());
            result.put("servingCellCount", servingCells.length());
            result.put("neighborCount", neighbors.length());

            result.put("lteAnchor", hasLteAnchor ? lteAnchor : new JSObject());
            result.put("nrSecondary", hasNrSecondary ? nrSecondary : new JSObject());
            result.put("threeGServing", hasCellObject(threeGServing) ? threeGServing : new JSObject());
            result.put("twoGServing", hasCellObject(twoGServing) ? twoGServing : new JSObject());

            result.put("lteAnchorStatus", hasLteAnchor ? "live" : "not_exposed");
            result.put("nrSecondaryStatus", hasNrSecondary ? (nrMeasurementOnly ? "measurement_only" : "live") : "not_exposed");
            result.put("nsaCandidate", nsaCandidate);

            if (hasNrSecondary && nrMeasurementOnly) {
                result.put("nrSecondaryMessage", "NR RF measurements are exposed by SignalStrength, but NR cell identity is not exposed by Android/device/carrier.");
            } else if (hasNrSecondary) {
                result.put("nrSecondaryMessage", "NR secondary cell is exposed by Android.");
            } else if (dataSaysNr || nsaCandidate) {
                result.put("nrSecondaryMessage", "NR secondary is not exposed by Android/device/carrier. LTE anchor is still valid live RF.");
            } else {
                result.put("nrSecondaryMessage", "NR secondary is not active or not exposed by Android/device/carrier.");
            }

            if (hasLteAnchor) {
                result.put("lteAnchorMessage", "LTE anchor is exposed by Android. Missing RF fields can be filled from SignalStrength when Android provides them.");
            } else {
                result.put("lteAnchorMessage", "LTE anchor is not exposed by Android/device/carrier.");
            }

            JSObject backwardServing = chooseBackwardCompatibleServing(lteAnchor, nrSecondary, threeGServing, twoGServing, firstServing, firstCell);
            result.put("serving", backwardServing != null ? backwardServing : emptyObject);

            String currentRatName = resolveCurrentRatName(dataNetworkTypeName, nsaCandidate, hasNrSecondary, nrMeasurementOnly, backwardServing);
            result.put("currentRatName", currentRatName);
            result.put("status", cells.length() > 0 || signalStrengthSnapshot.optBoolean("ok", false) ? "cell_info_ready" : "no_cell_info");
            result.put("message", buildSnapshotMessage(hasLteAnchor, hasNrSecondary, nrMeasurementOnly, dataSaysNr, cells.length(), signalStrengthSnapshot.optBoolean("ok", false)));
        } catch (SecurityException securityException) {
            result.put("status", "security_exception");
            result.put("message", securityException.getMessage());
        } catch (Exception exception) {
            result.put("status", "collector_exception");
            result.put("message", exception.getMessage());
        }

        attachTrafficStatsSnapshot(result);
        result.put("connectivity", buildConnectivitySnapshot(context));
    }

    /**
     * Permission-safe connectivity snapshot for report metadata only.
     * Does not alter Native HTTP transfer calculations.
     * Requires ACCESS_NETWORK_STATE (normal permission).
     */
    private JSObject buildConnectivitySnapshot(Context context) {
        JSObject out = new JSObject();
        out.put("wifiStatus", "Unknown");
        out.put("mobileDataStatus", "Unknown");
        out.put("activeTransport", "Unknown");
        out.put("internetConnectivity", "Unknown");
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                out.put("note", "ConnectivityManager unavailable");
                return out;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network active = cm.getActiveNetwork();
                NetworkCapabilities caps = active != null ? cm.getNetworkCapabilities(active) : null;
                if (caps == null) {
                    out.put("wifiStatus", "Disconnected");
                    out.put("mobileDataStatus", "Disconnected");
                    out.put("activeTransport", "None");
                    out.put("internetConnectivity", "Unavailable");
                    return out;
                }
                boolean wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                boolean cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
                boolean other = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
                boolean hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                out.put("wifiStatus", wifi ? "Connected" : "Disconnected");
                out.put("mobileDataStatus", cellular ? "Connected" : "Disconnected");
                // Canonical boolean fields for report JSON / Excel (F10B).
                // mobileDataActive = TRANSPORT_CELLULAR on the default/active network (not SIM presence).
                out.put("wifiConnected", wifi);
                out.put("cellularConnected", cellular);
                out.put("mobileDataActive", cellular);
                out.put("internetCapable", hasInternet);
                out.put("internetValidated", validated);
                if (wifi) out.put("activeTransport", "Wi-Fi");
                else if (cellular) out.put("activeTransport", "Cellular");
                else if (other) out.put("activeTransport", "Other");
                else out.put("activeTransport", "None");
                out.put("defaultTransport", out.getString("activeTransport"));
                if (!hasInternet) out.put("internetConnectivity", "Unavailable");
                else if (validated) out.put("internetConnectivity", "Available");
                else out.put("internetConnectivity", "Unvalidated");
                out.put("timestamp", System.currentTimeMillis());
                out.put("source", "android_connectivity_manager");
            } else {
                NetworkInfo activeInfo = cm.getActiveNetworkInfo();
                if (activeInfo == null || !activeInfo.isConnected()) {
                    out.put("wifiStatus", "Disconnected");
                    out.put("mobileDataStatus", "Disconnected");
                    out.put("wifiConnected", false);
                    out.put("cellularConnected", false);
                    out.put("mobileDataActive", false);
                    out.put("activeTransport", "None");
                    out.put("defaultTransport", "None");
                    out.put("internetCapable", false);
                    out.put("internetValidated", false);
                    out.put("internetConnectivity", "Unavailable");
                    out.put("timestamp", System.currentTimeMillis());
                    out.put("source", "android_connectivity_manager");
                    return out;
                }
                int type = activeInfo.getType();
                boolean wifi = type == ConnectivityManager.TYPE_WIFI;
                boolean cellular = type == ConnectivityManager.TYPE_MOBILE;
                out.put("wifiStatus", wifi ? "Connected" : "Disconnected");
                out.put("mobileDataStatus", cellular ? "Connected" : "Disconnected");
                out.put("wifiConnected", wifi);
                out.put("cellularConnected", cellular);
                out.put("mobileDataActive", cellular);
                out.put("activeTransport", wifi ? "Wi-Fi" : (cellular ? "Cellular" : "Other"));
                out.put("defaultTransport", out.getString("activeTransport"));
                out.put("internetCapable", true);
                out.put("internetValidated", true);
                out.put("internetConnectivity", "Available");
                out.put("timestamp", System.currentTimeMillis());
                out.put("source", "android_connectivity_manager");
            }
        } catch (SecurityException securityException) {
            out.put("note", "ACCESS_NETWORK_STATE required: " + securityException.getMessage());
        } catch (Exception exception) {
            out.put("note", exception.getMessage());
        }
        return out;
    }

    private void attachTrafficStatsSnapshot(JSObject result) {
        JSObject trafficStats = new JSObject();
        long mobileRxBytes = TrafficStats.getMobileRxBytes();
        long mobileTxBytes = TrafficStats.getMobileTxBytes();
        long totalRxBytes = TrafficStats.getTotalRxBytes();
        long totalTxBytes = TrafficStats.getTotalTxBytes();

        boolean mobileSupported = isTrafficStatsCounterSupported(mobileRxBytes)
                && isTrafficStatsCounterSupported(mobileTxBytes);
        boolean totalSupported = isTrafficStatsCounterSupported(totalRxBytes)
                && isTrafficStatsCounterSupported(totalTxBytes);
        boolean supported = mobileSupported || totalSupported;

        trafficStats.put("trafficStatsSupported", supported);
        trafficStats.put("trafficStatsMobileSupported", mobileSupported);
        trafficStats.put("trafficStatsTotalSupported", totalSupported);
        if (mobileSupported && totalSupported) {
            trafficStats.put("trafficStatsSource", "mobile_and_total");
        } else if (totalSupported) {
            trafficStats.put("trafficStatsSource", "total");
        } else if (mobileSupported) {
            trafficStats.put("trafficStatsSource", "mobile");
        } else {
            trafficStats.put("trafficStatsSource", "unsupported");
        }

        if (mobileSupported) {
            trafficStats.put("trafficStatsMobileRxBytes", mobileRxBytes);
            trafficStats.put("trafficStatsMobileTxBytes", mobileTxBytes);
        } else {
            trafficStats.put("trafficStatsMobileRxBytes", null);
            trafficStats.put("trafficStatsMobileTxBytes", null);
        }

        if (totalSupported) {
            trafficStats.put("trafficStatsTotalRxBytes", totalRxBytes);
            trafficStats.put("trafficStatsTotalTxBytes", totalTxBytes);
        } else {
            trafficStats.put("trafficStatsTotalRxBytes", null);
            trafficStats.put("trafficStatsTotalTxBytes", null);
        }

        trafficStats.put("trafficStatsReadAt", System.currentTimeMillis());
        trafficStats.put("trafficStatsApiLevel", Build.VERSION.SDK_INT);
        result.put("trafficStats", trafficStats);
    }

    private boolean isTrafficStatsCounterSupported(long value) {
        return value != TrafficStats.UNSUPPORTED && value >= 0L;
    }

    @PluginMethod
    public void runThroughputTest(PluginCall call) {
        final String phase = call.getString("phase", "download");
        final boolean upload = "upload".equalsIgnoreCase(phase);
        Integer requestedBytes = call.getInt("bytes");
        Integer requestedTimeout = call.getInt("timeoutMs");
        Integer requestedDuration = call.getInt("durationSeconds");
        Integer requestedInterval = call.getInt("intervalSeconds");
        Integer requestedWarmup = call.getInt("warmupSeconds");
        final int durationSeconds = clampInt(requestedDuration != null ? requestedDuration.intValue() : 0, 0, 300);
        final int intervalSeconds = clampInt(requestedInterval != null ? requestedInterval.intValue() : 1, 1, 10);
        final int warmupSeconds = clampInt(requestedWarmup != null ? requestedWarmup.intValue() : 0, 0, 30);
        final int baseBytes = requestedBytes != null ? requestedBytes.intValue() : (upload ? DEFAULT_UPLOAD_BYTES : DEFAULT_DOWNLOAD_BYTES);
        final int bytes = Math.max(256 * 1024, baseBytes);
        final int requestedTimeoutMs = requestedTimeout != null ? requestedTimeout.intValue() : DEFAULT_THP_TIMEOUT_MS;
        final int timeoutMs = durationSeconds > 0
            ? clampInt(Math.min(requestedTimeoutMs, durationSeconds * 1000 + 2500), 2500, 9000)
            : clampInt(requestedTimeoutMs, 2500, DEFAULT_THP_TIMEOUT_MS);
        final String url = safeThroughputUrl(call.getString("url"), upload);

        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("phase", upload ? "upload" : "download");
                result.put("source", "native-httpurlconnection-v1.1.0-step-1f10-warmup");
                result.put("requestedBytes", bytes);
                result.put("durationSeconds", durationSeconds);
                result.put("warmupSeconds", warmupSeconds);
                result.put("intervalSeconds", intervalSeconds);
                result.put("urlHost", hostOnly(url));
                result.put("timestamp", System.currentTimeMillis());

                try {
                    JSObject measured = upload
                        ? measureNativeUpload(url, bytes, timeoutMs, durationSeconds, warmupSeconds)
                        : measureNativeDownload(url, bytes, timeoutMs, durationSeconds, warmupSeconds);

                    measured.put("ok", true);
                    measured.put("phase", upload ? "upload" : "download");
                    measured.put("source", "native-httpurlconnection-v1.1.0-step-1f10-warmup");
                    measured.put("timestamp", System.currentTimeMillis());
                    resolveOnMain(call, measured);
                } catch (Exception exception) {
                    result.put("status", "throughput_exception");
                    result.put("message", exception.getMessage() != null ? exception.getMessage() : "Native throughput test failed.");
                    resolveOnMain(call, result);
                }
            }
        }).start();
    }


    @PluginMethod
    public void saveReportFiles(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "native-file-save-v1.1.0-step-1f9-json-reports");

        try {
            String sessionId = safeFileName(call.getString("sessionId", "bd-rf-" + System.currentTimeMillis()));
            String displayName = call.getString("displayName", sessionId);
            JSArray files = call.getArray("files");

            if (files == null || files.length() == 0) {
                result.put("status", "no_files");
                result.put("message", "No report files were provided.");
                call.resolve(result);
                return;
            }

            String relativeFolder = "BabyDragon/Reports/" + sessionId;
            JSArray savedFiles = new JSArray();

            for (int index = 0; index < files.length(); index += 1) {
                Object rawItem = files.get(index);
                JSONObject item = coerceToJsonObject(rawItem);
                if (item == null) continue;

                String fileName = safeFileName(item.optString("fileName", "babydragon_report_" + (index + 1) + ".csv"));
                String mimeType = item.optString("mimeType", "text/csv");
                String encoding = item.optString("encoding", "utf8");
                String contentBase64 = item.optString("contentBase64", "");
                boolean binaryBase64 = "base64".equalsIgnoreCase(encoding)
                    || (contentBase64 != null && !contentBase64.trim().isEmpty());

                JSObject saved;
                if (binaryBase64) {
                    String base64Payload = contentBase64 != null && !contentBase64.trim().isEmpty()
                        ? contentBase64.trim()
                        : item.optString("content", "");
                    if (base64Payload == null || base64Payload.isEmpty()) {
                        throw new Exception("Binary report missing contentBase64 for: " + fileName);
                    }
                    byte[] bytes = Base64.decode(base64Payload, Base64.DEFAULT);
                    if (bytes == null || bytes.length == 0) {
                        throw new Exception("Binary report decode produced empty bytes for: " + fileName);
                    }
                    saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? saveBytesToPublicDownloads(relativeFolder, fileName, mimeType, bytes)
                        : saveBytesToLegacyDownloads(relativeFolder, fileName, mimeType, bytes);
                } else {
                    String content = item.optString("content", "");
                    saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? saveTextToPublicDownloads(relativeFolder, fileName, mimeType, content)
                        : saveTextToLegacyDownloads(relativeFolder, fileName, mimeType, content);
                }
                saved.put("reportLabel", item.optString("reportLabel", fileName));
                savedFiles.put(saved);
            }

            if (savedFiles.length() == 0) {
                result.put("status", "no_files_saved");
                result.put("message", "No report files could be parsed/saved from the provided payload.");
                call.resolve(result);
                return;
            }

            result.put("ok", true);
            result.put("status", "saved");
            result.put("message", "BabyDragon report files saved to public Downloads.");
            result.put("sessionId", sessionId);
            result.put("displayName", displayName);
            result.put("basePath", "Downloads/" + relativeFolder);
            result.put("savedFiles", savedFiles);
        } catch (Exception exception) {
            result.put("ok", false);
            result.put("status", "save_report_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "Report save failed.");
        }

        call.resolve(result);
    }

    /**
     * Dedicated binary save path for large .xlsx payloads (top-level contentBase64).
     * Avoids nested JSArray object coercion issues on Capacitor Android.
     */
    @PluginMethod
    public void saveBinaryReportFile(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "native-binary-file-save-v1j2f1");
        try {
            String sessionId = safeFileName(call.getString("sessionId", "bd-rf-" + System.currentTimeMillis()));
            String displayName = call.getString("displayName", sessionId);
            String fileName = safeFileName(call.getString("fileName", "babydragon_report.xlsx"));
            String mimeType = call.getString("mimeType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            String contentBase64 = call.getString("contentBase64");
            if (contentBase64 == null || contentBase64.trim().isEmpty()) {
                result.put("status", "missing_content");
                result.put("message", "contentBase64 is required for binary report save.");
                call.resolve(result);
                return;
            }

            String relativeFolder = "BabyDragon/Reports/" + sessionId;
            byte[] bytes = Base64.decode(contentBase64.trim(), Base64.DEFAULT);
            if (bytes == null || bytes.length < 4) {
                result.put("status", "decode_failed");
                result.put("message", "Failed to decode contentBase64 for binary report.");
                call.resolve(result);
                return;
            }
            // Basic ZIP/XLSX magic check (PK).
            if (bytes[0] != 'P' || bytes[1] != 'K') {
                result.put("status", "invalid_xlsx");
                result.put("message", "Decoded bytes are not a ZIP/XLSX workbook (missing PK header).");
                call.resolve(result);
                return;
            }

            JSObject saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveBytesToPublicDownloads(relativeFolder, fileName, mimeType, bytes)
                : saveBytesToLegacyDownloads(relativeFolder, fileName, mimeType, bytes);
            saved.put("reportLabel", call.getString("reportLabel", fileName));

            JSArray savedFiles = new JSArray();
            savedFiles.put(saved);
            result.put("ok", true);
            result.put("status", "saved");
            result.put("message", "Binary report saved to public Downloads.");
            result.put("sessionId", sessionId);
            result.put("displayName", displayName);
            result.put("basePath", "Downloads/" + relativeFolder);
            result.put("savedFiles", savedFiles);
        } catch (Exception exception) {
            result.put("ok", false);
            result.put("status", "save_binary_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "Binary report save failed.");
        }
        call.resolve(result);
    }

    /**
     * Lightweight connectivity snapshot for Start/Stop session metadata (F10B).
     * Does not alter RF/TrafficStats measurement math.
     */
    @PluginMethod
    public void getConnectivitySnapshot(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("source", "native-connectivity-snapshot-f10b");
        result.put("connectivity", buildConnectivitySnapshot(getContext()));
        call.resolve(result);
    }

    /**
     * Discover BabyDragon report packages already saved under Downloads/BabyDragon/Reports.
     * Groups MediaStore (or legacy filesystem) files by package folder id.
     */
    @PluginMethod
    public void listReportPackages(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "native-list-report-packages-f10b");
        try {
            JSArray packages = new JSArray();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                packages = listReportPackagesFromMediaStore();
            } else {
                packages = listReportPackagesFromLegacyFilesystem();
            }
            result.put("ok", true);
            result.put("status", "listed");
            result.put("packageCount", packages.length());
            result.put("packages", packages);
            result.put("message", "Listed BabyDragon report packages.");
        } catch (Exception exception) {
            result.put("status", "list_packages_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "List report packages failed.");
            result.put("packages", new JSArray());
            result.put("packageCount", 0);
        }
        call.resolve(result);
    }

    /**
     * Read a previously saved report text file by content URI (or absolute file path on legacy).
     */
    @PluginMethod
    public void readReportTextFile(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "native-read-report-text-f10b");
        try {
            String uriText = call.getString("uri", "");
            String pathText = call.getString("path", "");
            if ((uriText == null || uriText.trim().isEmpty()) && (pathText == null || pathText.trim().isEmpty())) {
                result.put("status", "missing_uri");
                result.put("message", "uri or path is required.");
                call.resolve(result);
                return;
            }
            byte[] bytes;
            String fileName = call.getString("fileName", "report.txt");
            if (uriText != null && !uriText.trim().isEmpty()) {
                Uri uri = Uri.parse(uriText.trim());
                ContentResolver resolver = getContext().getContentResolver();
                InputStream input = resolver.openInputStream(uri);
                if (input == null) {
                    throw new Exception("Unable to open report URI.");
                }
                try {
                    bytes = readAllBytes(input);
                } finally {
                    try { input.close(); } catch (Exception ignored) {}
                }
            } else {
                File file = new File(pathText.trim());
                if (!file.exists() || !file.isFile()) {
                    throw new Exception("Report file not found.");
                }
                fileName = file.getName();
                java.io.FileInputStream fis = new java.io.FileInputStream(file);
                try {
                    bytes = readAllBytes(fis);
                } finally {
                    try { fis.close(); } catch (Exception ignored) {}
                }
            }
            String content = new String(bytes == null ? new byte[0] : bytes, StandardCharsets.UTF_8);
            // Strip UTF-8 BOM if present.
            if (content.startsWith("\uFEFF")) content = content.substring(1);
            result.put("ok", true);
            result.put("status", "read");
            result.put("fileName", fileName);
            result.put("bytes", bytes == null ? 0 : bytes.length);
            result.put("content", content);
            result.put("message", "Report text file read.");
        } catch (Exception exception) {
            result.put("status", "read_report_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "Read report file failed.");
        }
        call.resolve(result);
    }

    private byte[] readAllBytes(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = input.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private JSArray listReportPackagesFromMediaStore() throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[] {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.RELATIVE_PATH
        };
        // RELATIVE_PATH examples: "Download/BabyDragon/Reports/<packageId>/"
        String selection = MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
        String[] args = new String[] { "%BabyDragon/Reports/%" };
        java.util.LinkedHashMap<String, JSObject> byPackage = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, JSArray> filesByPackage = new java.util.LinkedHashMap<>();
        try (android.database.Cursor cursor = resolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            args,
            MediaStore.MediaColumns.DATE_MODIFIED + " DESC"
        )) {
            if (cursor == null) return new JSArray();
            int idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE);
            int sizeIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE);
            int modIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED);
            int pathIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH);
            while (cursor.moveToNext()) {
                String relativePath = cursor.getString(pathIdx);
                if (relativePath == null) continue;
                String packageId = extractReportPackageId(relativePath);
                if (packageId == null || packageId.isEmpty()) continue;
                JSObject pkg = byPackage.get(packageId);
                JSArray fileList = filesByPackage.get(packageId);
                if (pkg == null) {
                    pkg = new JSObject();
                    pkg.put("packageId", packageId);
                    pkg.put("relativePath", "Downloads/BabyDragon/Reports/" + packageId);
                    pkg.put("modifiedAtMs", 0L);
                    fileList = new JSArray();
                    byPackage.put(packageId, pkg);
                    filesByPackage.put(packageId, fileList);
                }
                long modifiedSec = cursor.isNull(modIdx) ? 0L : cursor.getLong(modIdx);
                long modifiedMs = modifiedSec > 0 ? modifiedSec * 1000L : 0L;
                long currentMod = 0L;
                try { currentMod = pkg.getLong("modifiedAtMs"); } catch (Exception ignored) {}
                if (modifiedMs > currentMod) {
                    pkg.put("modifiedAtMs", modifiedMs);
                }
                long id = cursor.getLong(idIdx);
                Uri uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(id));
                JSObject file = new JSObject();
                String fileName = cursor.getString(nameIdx);
                file.put("fileName", fileName);
                file.put("mimeType", cursor.getString(mimeIdx));
                file.put("bytes", cursor.isNull(sizeIdx) ? 0L : cursor.getLong(sizeIdx));
                file.put("uri", uri.toString());
                file.put("modifiedAtMs", modifiedMs);
                fileList.put(file);
                // Quick role flags for JS discovery without reading content.
                String lower = fileName == null ? "" : fileName.toLowerCase();
                if (lower.endsWith("report.json")) pkg.put("hasReportJson", true);
                if (lower.contains("rf_gps_trace") && lower.endsWith(".csv")) pkg.put("hasRfGpsTrace", true);
                if (lower.contains("ookla_evidence") && lower.endsWith(".csv")) pkg.put("hasOoklaEvidence", true);
                if (lower.contains("fcc_evidence") && lower.endsWith(".json")) pkg.put("hasFccEvidenceJson", true);
                if (lower.contains("fcc_import_metadata") && lower.endsWith(".json")) pkg.put("hasFccImportMetadata", true);
                if (lower.contains("thp_iterations") && lower.endsWith(".csv")) pkg.put("hasThpIterations", true);
                if (lower.contains("iperf3") && lower.endsWith(".json")) pkg.put("hasIperfJson", true);
            }
        }
        JSArray packages = new JSArray();
        for (java.util.Map.Entry<String, JSObject> entry : byPackage.entrySet()) {
            JSObject pkg = entry.getValue();
            pkg.put("files", filesByPackage.get(entry.getKey()));
            packages.put(pkg);
        }
        return packages;
    }

    private JSArray listReportPackagesFromLegacyFilesystem() {
        JSArray packages = new JSArray();
        File downloadsRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File reportsRoot = new File(downloadsRoot, "BabyDragon/Reports");
        if (!reportsRoot.exists() || !reportsRoot.isDirectory()) return packages;
        File[] dirs = reportsRoot.listFiles();
        if (dirs == null) return packages;
        java.util.Arrays.sort(dirs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (File dir : dirs) {
            if (dir == null || !dir.isDirectory()) continue;
            JSObject pkg = new JSObject();
            pkg.put("packageId", dir.getName());
            pkg.put("relativePath", "Downloads/BabyDragon/Reports/" + dir.getName());
            pkg.put("modifiedAtMs", dir.lastModified());
            JSArray files = new JSArray();
            File[] children = dir.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (child == null || !child.isFile()) continue;
                    JSObject file = new JSObject();
                    String fileName = child.getName();
                    file.put("fileName", fileName);
                    file.put("path", child.getAbsolutePath());
                    file.put("bytes", child.length());
                    file.put("modifiedAtMs", child.lastModified());
                    files.put(file);
                    String lower = fileName.toLowerCase();
                    if (lower.endsWith("report.json")) pkg.put("hasReportJson", true);
                    if (lower.contains("rf_gps_trace") && lower.endsWith(".csv")) pkg.put("hasRfGpsTrace", true);
                    if (lower.contains("ookla_evidence") && lower.endsWith(".csv")) pkg.put("hasOoklaEvidence", true);
                    if (lower.contains("fcc_evidence") && lower.endsWith(".json")) pkg.put("hasFccEvidenceJson", true);
                    if (lower.contains("fcc_import_metadata") && lower.endsWith(".json")) pkg.put("hasFccImportMetadata", true);
                    if (lower.contains("thp_iterations") && lower.endsWith(".csv")) pkg.put("hasThpIterations", true);
                    if (lower.contains("iperf3") && lower.endsWith(".json")) pkg.put("hasIperfJson", true);
                }
            }
            pkg.put("files", files);
            packages.put(pkg);
        }
        return packages;
    }

    private String extractReportPackageId(String relativePath) {
        if (relativePath == null) return null;
        String normalized = relativePath.replace('\\', '/');
        String marker = "BabyDragon/Reports/";
        int idx = normalized.indexOf(marker);
        if (idx < 0) return null;
        String rest = normalized.substring(idx + marker.length());
        while (rest.startsWith("/")) rest = rest.substring(1);
        if (rest.isEmpty()) return null;
        int slash = rest.indexOf('/');
        return slash >= 0 ? rest.substring(0, slash) : rest.replaceAll("/+$", "");
    }

    @SuppressWarnings("unchecked")
    private JSONObject coerceToJsonObject(Object rawItem) {
        if (rawItem == null) return null;
        if (rawItem instanceof JSONObject) return (JSONObject) rawItem;
        if (rawItem instanceof JSObject) {
            return ((JSObject) rawItem);
        }
        if (rawItem instanceof java.util.Map) {
            return new JSONObject((java.util.Map<String, Object>) rawItem);
        }
        try {
            return new JSONObject(String.valueOf(rawItem));
        } catch (Exception ignored) {
            return null;
        }
    }

    @PluginMethod
    public void shareReportFiles(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "native-share-v1.1.0-step-1f9-json-reports");

        try {
            JSArray files = call.getArray("files");
            if (files == null || files.length() == 0) {
                result.put("status", "no_files");
                result.put("message", "Export reports first, then share.");
                call.resolve(result);
                return;
            }

            ArrayList<Uri> uris = new ArrayList<>();
            for (int index = 0; index < files.length(); index += 1) {
                Object rawItem = files.get(index);
                JSONObject item = coerceToJsonObject(rawItem);
                if (item == null) continue;
                String uriText = item.optString("uri", "");
                if (uriText != null && !uriText.trim().isEmpty()) {
                    uris.add(Uri.parse(uriText));
                }
            }

            if (uris.isEmpty()) {
                result.put("status", "no_shareable_uri");
                result.put("message", "Reports are saved, but Android did not return shareable file URIs.");
                call.resolve(result);
                return;
            }

            String title = call.getString("title", "BabyDragon RF KPI Report");
            String text = call.getString("text", "BabyDragon RF KPI report package is attached.");
            Intent shareIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            shareIntent.setType("*/*");
            shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            shareIntent.putExtra(Intent.EXTRA_TEXT, text);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(shareIntent, "Share BabyDragon reports");
            getActivity().startActivity(chooser);

            result.put("ok", true);
            result.put("status", "share_started");
            result.put("message", "Share sheet opened for BabyDragon report files.");
        } catch (Exception exception) {
            result.put("status", "share_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "Share failed.");
        }

        call.resolve(result);
    }

    @PluginMethod
    public void getPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("permissions", buildPermissionStatus(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void recognizeTextFromImage(PluginCall call) {
        String base64Image = call.getString("base64Image");
        if (base64Image == null || base64Image.trim().isEmpty()) {
            JSObject failure = new JSObject();
            failure.put("ok", false);
            failure.put("error", "base64Image is required");
            call.resolve(failure);
            return;
        }

        String payload = base64Image.trim();
        if (payload.contains(",")) {
            payload = payload.substring(payload.indexOf(",") + 1);
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(payload, Base64.DEFAULT);
        } catch (IllegalArgumentException exception) {
            JSObject failure = new JSObject();
            failure.put("ok", false);
            failure.put("error", "Invalid base64 image payload");
            call.resolve(failure);
            return;
        }

        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) {
            JSObject failure = new JSObject();
            failure.put("ok", false);
            failure.put("error", "Unable to decode image bytes");
            call.resolve(failure);
            return;
        }

        InputImage image = InputImage.fromBitmap(bitmap, 0);
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(image)
            .addOnSuccessListener(visionText -> {
                JSObject result = new JSObject();
                JSArray lines = new JSArray();
                for (Text.TextBlock block : visionText.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject lineObj = new JSObject();
                        lineObj.put("text", line.getText() != null ? line.getText() : "");
                        android.graphics.Rect box = line.getBoundingBox();
                        if (box != null) {
                            lineObj.put("top", box.top);
                            lineObj.put("left", box.left);
                            lineObj.put("width", box.width());
                            lineObj.put("height", box.height());
                        }
                        lines.put(lineObj);
                    }
                }
                result.put("ok", true);
                result.put("text", visionText.getText() != null ? visionText.getText() : "");
                result.put("lines", lines);
                result.put("confidence", null);
                result.put("error", null);
                resolveOnMain(call, result);
            })
            .addOnFailureListener(exception -> {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("text", "");
                result.put("confidence", null);
                result.put("error", exception.getMessage() != null ? exception.getMessage() : "OCR failed");
                resolveOnMain(call, result);
            });
    }

    @PluginMethod
    public void fetchOoklaResultPage(PluginCall call) {
        String pageUrl = call.getString("url");
        if (pageUrl == null || pageUrl.trim().isEmpty()) {
            JSObject failure = new JSObject();
            failure.put("ok", false);
            failure.put("statusCode", null);
            failure.put("finalUrl", null);
            failure.put("text", null);
            failure.put("error", "url is required");
            call.resolve(failure);
            return;
        }

        final String trimmedUrl = pageUrl.trim();
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                HttpURLConnection connection = null;
                try {
                    if (!trimmedUrl.startsWith("https://")) {
                        result.put("ok", false);
                        result.put("statusCode", null);
                        result.put("finalUrl", null);
                        result.put("text", null);
                        result.put("error", "Only HTTPS URLs are allowed");
                        resolveOnMain(call, result);
                        return;
                    }

                    URL requestUrl = new URL(trimmedUrl);
                    connection = (HttpURLConnection) requestUrl.openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(10000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestProperty("User-Agent", "BabyDragon/1.0 (Android; OOKLA result reader)");
                    connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*");

                    int statusCode = connection.getResponseCode();
                    String finalUrl = connection.getURL() != null ? connection.getURL().toString() : trimmedUrl;
                    InputStream stream = statusCode >= 200 && statusCode < 300
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                    String body = readHttpBodyCapped(stream, 1024 * 1024);

                    result.put("ok", statusCode >= 200 && statusCode < 300);
                    result.put("statusCode", statusCode);
                    result.put("finalUrl", finalUrl);
                    result.put("text", body);
                    result.put("error", statusCode >= 200 && statusCode < 300 ? null : "http_" + statusCode);
                } catch (Exception exception) {
                    result.put("ok", false);
                    result.put("statusCode", null);
                    result.put("finalUrl", null);
                    result.put("text", null);
                    result.put("error", exception.getMessage() != null ? exception.getMessage() : "fetch_failed");
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                    resolveOnMain(call, result);
                }
            }
        }).start();
    }

    /**
     * Fetch the public OOKLA Result share image (og:image) as base64 for OCR.
     * This is not an undocumented API — the share PNG is linked from the result page meta tags.
     */
    @PluginMethod
    public void fetchOoklaResultShareImage(PluginCall call) {
        String imageUrl = call.getString("url");
        if (imageUrl == null || imageUrl.trim().isEmpty()) {
            JSObject failure = new JSObject();
            failure.put("ok", false);
            failure.put("statusCode", null);
            failure.put("finalUrl", null);
            failure.put("base64Image", null);
            failure.put("contentType", null);
            failure.put("error", "url is required");
            call.resolve(failure);
            return;
        }

        final String trimmedUrl = imageUrl.trim();
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                HttpURLConnection connection = null;
                try {
                    if (!trimmedUrl.startsWith("https://")) {
                        result.put("ok", false);
                        result.put("statusCode", null);
                        result.put("finalUrl", null);
                        result.put("base64Image", null);
                        result.put("contentType", null);
                        result.put("error", "Only HTTPS URLs are allowed");
                        resolveOnMain(call, result);
                        return;
                    }
                    if (!trimmedUrl.matches("(?i)^https://([a-z0-9.-]*\\.)?speedtest\\.net/.*")) {
                        result.put("ok", false);
                        result.put("statusCode", null);
                        result.put("finalUrl", null);
                        result.put("base64Image", null);
                        result.put("contentType", null);
                        result.put("error", "Only speedtest.net share image URLs are allowed");
                        resolveOnMain(call, result);
                        return;
                    }

                    URL requestUrl = new URL(trimmedUrl);
                    connection = (HttpURLConnection) requestUrl.openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(10000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestProperty("User-Agent", "BabyDragon/1.0 (Android; OOKLA result reader)");
                    connection.setRequestProperty("Accept", "image/png,image/jpeg,image/*,*/*");

                    int statusCode = connection.getResponseCode();
                    String finalUrl = connection.getURL() != null ? connection.getURL().toString() : trimmedUrl;
                    String contentType = connection.getContentType();
                    InputStream stream = statusCode >= 200 && statusCode < 300
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                    byte[] bytes = readHttpBytesCapped(stream, 2 * 1024 * 1024);
                    boolean ok = statusCode >= 200 && statusCode < 300 && bytes != null && bytes.length > 0;

                    result.put("ok", ok);
                    result.put("statusCode", statusCode);
                    result.put("finalUrl", finalUrl);
                    result.put("contentType", contentType);
                    result.put("base64Image", ok ? Base64.encodeToString(bytes, Base64.NO_WRAP) : null);
                    result.put("error", ok ? null : "http_" + statusCode);
                } catch (Exception exception) {
                    result.put("ok", false);
                    result.put("statusCode", null);
                    result.put("finalUrl", null);
                    result.put("base64Image", null);
                    result.put("contentType", null);
                    result.put("error", exception.getMessage() != null ? exception.getMessage() : "fetch_failed");
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                    resolveOnMain(call, result);
                }
            }
        }).start();
    }

    /**
     * Download an FCC App export ZIP from a user-pasted HTTPS URL.
     * Returns base64 ZIP bytes for FE import only — does not write into report folders.
     */
    @PluginMethod
    public void downloadFccZipFromUrl(PluginCall call) {
        String rawUrl = call.getString("url");
        JSObject failure = new JSObject();
        failure.put("ok", false);
        failure.put("statusCode", null);
        failure.put("contentType", null);
        failure.put("filename", null);
        failure.put("sizeBytes", null);
        failure.put("base64Zip", null);
        failure.put("finalUrl", null);
        failure.put("message", null);

        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            failure.put("error", "url_required");
            failure.put("message", "Invalid URL: HTTPS FCC ZIP URL required");
            call.resolve(failure);
            return;
        }

        final String trimmedUrl = rawUrl.trim();
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("source", "native-fcc-zip-download-v1i2c");
                HttpURLConnection connection = null;
                final int maxBytes = 25 * 1024 * 1024;
                final int connectTimeoutMs = 15000;
                final int readTimeoutMs = 30000;
                final int maxRedirects = 5;
                try {
                    if (!trimmedUrl.regionMatches(true, 0, "https://", 0, 8)) {
                        result.put("error", "https_required");
                        result.put("message", "Invalid URL: HTTPS FCC ZIP URL required");
                        resolveOnMain(call, result);
                        return;
                    }

                    URL currentUrl = new URL(trimmedUrl);
                    String host = currentUrl.getHost() == null ? "" : currentUrl.getHost().toLowerCase();
                    if (host.isEmpty()) {
                        result.put("error", "invalid_host");
                        result.put("message", "Invalid URL: HTTPS FCC ZIP URL required");
                        resolveOnMain(call, result);
                        return;
                    }
                    // Prefer mozark FCC API host; still allow other HTTPS hosts that return a ZIP.
                    boolean preferredHost = host.equals("fccapi.mozark.ai") || host.endsWith(".mozark.ai");

                    int statusCode = -1;
                    String contentType = null;
                    String contentDisposition = null;
                    String finalUrl = trimmedUrl;
                    byte[] bytes = null;

                    for (int redirect = 0; redirect <= maxRedirects; redirect += 1) {
                        if (!"https".equalsIgnoreCase(currentUrl.getProtocol())) {
                            result.put("error", "https_redirect_required");
                            result.put("message", "Download failed: redirects must stay on HTTPS");
                            resolveOnMain(call, result);
                            return;
                        }

                        connection = (HttpURLConnection) currentUrl.openConnection();
                        connection.setInstanceFollowRedirects(false);
                        connection.setRequestMethod("GET");
                        connection.setConnectTimeout(connectTimeoutMs);
                        connection.setReadTimeout(readTimeoutMs);
                        connection.setRequestProperty("User-Agent", "BabyDragon/1.0 (Android; FCC ZIP import)");
                        connection.setRequestProperty("Accept", "application/zip,application/octet-stream,*/*");

                        statusCode = connection.getResponseCode();
                        contentType = connection.getContentType();
                        contentDisposition = connection.getHeaderField("Content-Disposition");
                        finalUrl = connection.getURL() != null ? connection.getURL().toString() : currentUrl.toString();

                        if (statusCode == HttpURLConnection.HTTP_MOVED_PERM
                            || statusCode == HttpURLConnection.HTTP_MOVED_TEMP
                            || statusCode == HttpURLConnection.HTTP_SEE_OTHER
                            || statusCode == 307
                            || statusCode == 308) {
                            String location = connection.getHeaderField("Location");
                            connection.disconnect();
                            connection = null;
                            if (location == null || location.trim().isEmpty()) {
                                result.put("error", "redirect_missing_location");
                                result.put("message", "Download failed: redirect missing Location");
                                result.put("statusCode", statusCode);
                                resolveOnMain(call, result);
                                return;
                            }
                            currentUrl = new URL(currentUrl, location.trim());
                            continue;
                        }

                        long contentLength = connection.getContentLengthLong();
                        if (contentLength > maxBytes) {
                            result.put("error", "size_exceeded");
                            result.put("message", "Download failed: FCC ZIP exceeds 25 MB limit");
                            result.put("statusCode", statusCode);
                            result.put("contentType", contentType);
                            result.put("finalUrl", finalUrl);
                            resolveOnMain(call, result);
                            return;
                        }

                        InputStream stream = statusCode >= 200 && statusCode < 300
                            ? connection.getInputStream()
                            : connection.getErrorStream();
                        bytes = readHttpBytesCapped(stream, maxBytes + 1);
                        if (bytes != null && bytes.length > maxBytes) {
                            result.put("error", "size_exceeded");
                            result.put("message", "Download failed: FCC ZIP exceeds 25 MB limit");
                            result.put("statusCode", statusCode);
                            result.put("contentType", contentType);
                            result.put("finalUrl", finalUrl);
                            resolveOnMain(call, result);
                            return;
                        }
                        break;
                    }

                    boolean httpOk = statusCode >= 200 && statusCode < 300;
                    boolean looksZip = bytes != null
                        && bytes.length >= 4
                        && bytes[0] == 'P'
                        && bytes[1] == 'K';
                    String typeLower = contentType == null ? "" : contentType.toLowerCase();
                    boolean typeZip = typeLower.contains("zip")
                        || typeLower.contains("octet-stream")
                        || typeLower.contains("application/x-zip");

                    String filename = filenameFromContentDisposition(contentDisposition);
                    if (filename == null || filename.trim().isEmpty()) {
                        String path = currentUrl.getPath();
                        if (path != null && path.contains("/")) {
                            filename = path.substring(path.lastIndexOf('/') + 1);
                        }
                    }
                    if (filename == null || filename.trim().isEmpty()) {
                        filename = "fcc-export.zip";
                    }
                    filename = safeFileName(filename);
                    if (!filename.toLowerCase().endsWith(".zip")) {
                        filename = filename + ".zip";
                    }

                    boolean ok = httpOk && looksZip && bytes != null && bytes.length > 0;
                    if (!ok && httpOk && typeZip && bytes != null && bytes.length > 0 && !looksZip) {
                        // Content-Type claims ZIP but magic missing — still reject (never treat as executable).
                        ok = false;
                    }

                    result.put("ok", ok);
                    result.put("statusCode", statusCode);
                    result.put("contentType", contentType);
                    result.put("filename", filename);
                    result.put("sizeBytes", bytes == null ? 0 : bytes.length);
                    result.put("finalUrl", finalUrl);
                    result.put("preferredHost", preferredHost);
                    result.put("base64Zip", ok ? Base64.encodeToString(bytes, Base64.NO_WRAP) : null);
                    if (ok) {
                        result.put("error", null);
                        result.put("message", "FCC ZIP downloaded");
                    } else if (!httpOk) {
                        result.put("error", "http_" + statusCode);
                        result.put("message", "Download failed: HTTP " + statusCode);
                    } else {
                        result.put("error", "not_zip");
                        result.put("message", "Download failed: response is not a ZIP file");
                    }
                } catch (SocketTimeoutException timeout) {
                    result.put("error", "timeout");
                    result.put("message", "Download failed: timeout");
                } catch (Exception exception) {
                    result.put("error", "fetch_failed");
                    result.put("message", "Download failed: "
                        + (exception.getMessage() != null ? exception.getMessage() : "fetch_failed"));
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                    resolveOnMain(call, result);
                }
            }
        }).start();
    }

    private String filenameFromContentDisposition(String header) {
        if (header == null || header.trim().isEmpty()) return null;
        Matcher matcher = Pattern.compile("filename\\*?=(?:UTF-8''|\"?)([^\";]+)", Pattern.CASE_INSENSITIVE)
            .matcher(header);
        if (matcher.find()) {
            return matcher.group(1).replace("\"", "").trim();
        }
        return null;
    }

    private String readHttpBodyCapped(InputStream stream, int maxBytes) throws IOException {
        byte[] bytes = readHttpBytesCapped(stream, maxBytes);
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        return new String(bytes, "UTF-8");
    }

    private byte[] readHttpBytesCapped(InputStream stream, int maxBytes) throws IOException {
        if (stream == null) {
            return new byte[0];
        }
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int total = 0;
        int read;
        while ((read = stream.read(chunk)) != -1) {
            int toWrite = Math.min(read, maxBytes - total);
            if (toWrite <= 0) {
                break;
            }
            buffer.write(chunk, 0, toWrite);
            total += toWrite;
            if (total >= maxBytes) {
                break;
            }
        }
        stream.close();
        return buffer.toByteArray();
    }

    private void resolveOnMain(final PluginCall call, final JSObject result) {
        Handler mainHandler = new Handler(Looper.getMainLooper());
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                call.resolve(result);
            }
        });
    }



    private JSObject saveTextToPublicDownloads(String relativeFolder, String fileName, String mimeType, String content) throws Exception {
        byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
        return saveBytesToPublicDownloads(relativeFolder, fileName, mimeType, bytes);
    }

    private JSObject saveBytesToPublicDownloads(String relativeFolder, String fileName, String mimeType, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType == null || mimeType.trim().isEmpty() ? "application/octet-stream" : mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + relativeFolder);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri uri = resolver.insert(collection, values);
        if (uri == null) {
            throw new Exception("Unable to create public Downloads file: " + fileName);
        }

        OutputStream output = null;
        try {
            output = resolver.openOutputStream(uri, "w");
            if (output == null) {
                throw new Exception("Unable to open output stream for: " + fileName);
            }
            byte[] payload = bytes == null ? new byte[0] : bytes;
            output.write(payload);
            output.flush();

            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, values, null, null);

            JSObject saved = new JSObject();
            saved.put("fileName", fileName);
            saved.put("mimeType", mimeType);
            saved.put("path", "Downloads/" + relativeFolder + "/" + fileName);
            saved.put("uri", uri.toString());
            saved.put("bytes", payload.length);
            return saved;
        } catch (Exception exception) {
            try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
            throw exception;
        } finally {
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
        }
    }

    private JSObject saveTextToLegacyDownloads(String relativeFolder, String fileName, String mimeType, String content) throws Exception {
        byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
        return saveBytesToLegacyDownloads(relativeFolder, fileName, mimeType, bytes);
    }

    private JSObject saveBytesToLegacyDownloads(String relativeFolder, String fileName, String mimeType, byte[] bytes) throws Exception {
        File downloadsRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File reportDir = new File(downloadsRoot, relativeFolder);
        if (!reportDir.exists() && !reportDir.mkdirs()) {
            File documentsRoot = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
            if (documentsRoot == null) documentsRoot = getContext().getFilesDir();
            reportDir = new File(documentsRoot, relativeFolder);
            if (!reportDir.exists() && !reportDir.mkdirs()) {
                throw new Exception("Unable to create report folder: " + reportDir.getAbsolutePath());
            }
        }

        File outputFile = new File(reportDir, fileName);
        FileOutputStream output = null;
        try {
            output = new FileOutputStream(outputFile, false);
            byte[] payload = bytes == null ? new byte[0] : bytes;
            output.write(payload);
            output.flush();
        } finally {
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
        }

        JSObject saved = new JSObject();
        saved.put("fileName", fileName);
        saved.put("mimeType", mimeType);
        saved.put("path", outputFile.getAbsolutePath());
        saved.put("bytes", outputFile.length());
        return saved;
    }

    private String safeFileName(String value) {
        String clean = value == null ? "" : value.trim();
        if (clean.isEmpty()) clean = "babydragon_report";
        clean = clean.replaceAll("[^a-zA-Z0-9._-]+", "_");
        clean = clean.replaceAll("^_+|_+$", "");
        if (clean.isEmpty()) clean = "babydragon_report";
        if (clean.length() > 120) clean = clean.substring(0, 120);
        return clean;
    }

    private int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private String safeThroughputUrl(String value, boolean upload) {
        if (value == null || value.trim().isEmpty()) {
            return upload ? DEFAULT_UPLOAD_URL : DEFAULT_DOWNLOAD_URL;
        }
        return value.trim();
    }

    private String hostOnly(String value) {
        try {
            return new URL(value).getHost();
        } catch (Exception ignored) {
            return "N/A";
        }
    }

    private String appendQueryParam(String url, String key, String value) {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + key + "=" + value;
    }

    private String prepareDownloadUrl(String url, int bytes) {
        String prepared = url;
        if (!prepared.contains("bytes=")) {
            prepared = appendQueryParam(prepared, "bytes", String.valueOf(bytes));
        }
        return appendQueryParam(prepared, "cacheBust", String.valueOf(System.currentTimeMillis()));
    }

    private String prepareUploadUrl(String url) {
        return appendQueryParam(url, "cacheBust", String.valueOf(System.currentTimeMillis()));
    }


    private long measureDownloadWarmupBytes(String url, int requestBytes, int timeoutMs, int warmupSeconds) throws Exception {
        long startedNanos = System.nanoTime();
        long targetNanos = warmupSeconds * 1000000000L;
        long received = 0L;

        do {
            HttpURLConnection connection = null;
            InputStream input = null;
            try {
                URL target = new URL(prepareDownloadUrl(url, requestBytes));
                connection = (HttpURLConnection) target.openConnection();
                connection.setRequestMethod("GET");
                int effectiveTimeoutMs = clampInt(warmupSeconds * 1000 + 1500, 1500, timeoutMs);
                connection.setConnectTimeout(effectiveTimeoutMs);
                connection.setReadTimeout(effectiveTimeoutMs);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "BabyDragon-Mobile/1.1 Android NativeTHP Warmup");
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept", "application/octet-stream,*/*");
                connection.connect();

                int statusCode = connection.getResponseCode();
                if (statusCode < 200 || statusCode >= 400) {
                    throw new Exception("DL warmup native HTTP " + statusCode);
                }

                input = new BufferedInputStream(connection.getInputStream());
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    received += read;
                    if ((System.nanoTime() - startedNanos) >= targetNanos) break;
                }
            } finally {
                if (input != null) {
                    try { input.close(); } catch (Exception ignored) {}
                }
                if (connection != null) connection.disconnect();
            }
        } while ((System.nanoTime() - startedNanos) < targetNanos);

        return received;
    }

    private long measureUploadWarmupBytes(String url, int timeoutMs, int warmupSeconds) throws Exception {
        long startedNanos = System.nanoTime();
        long targetNanos = warmupSeconds * 1000000000L;
        long sent = 0L;
        HttpURLConnection connection = null;
        OutputStream output = null;
        InputStream responseStream = null;

        try {
            URL target = new URL(prepareUploadUrl(url));
            connection = (HttpURLConnection) target.openConnection();
            connection.setRequestMethod("POST");
            int effectiveTimeoutMs = clampInt(warmupSeconds * 1000 + 1500, 1500, timeoutMs);
            connection.setConnectTimeout(effectiveTimeoutMs);
            connection.setReadTimeout(effectiveTimeoutMs);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setChunkedStreamingMode(64 * 1024);
            connection.setRequestProperty("User-Agent", "BabyDragon-Mobile/1.1 Android NativeTHP Warmup");
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/json,text/plain,*/*");

            output = new BufferedOutputStream(connection.getOutputStream());
            byte[] buffer = new byte[64 * 1024];
            for (int index = 0; index < buffer.length; index += 1) {
                buffer[index] = (byte) (index % 251);
            }

            while ((System.nanoTime() - startedNanos) < targetNanos) {
                output.write(buffer, 0, buffer.length);
                sent += buffer.length;
            }
            output.flush();

            try {
                int statusCode = connection.getResponseCode();
                responseStream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (responseStream != null) {
                    byte[] drain = new byte[4096];
                    while (responseStream.read(drain) != -1) {}
                }
                if (statusCode < 200 || statusCode >= 400) {
                    throw new Exception("UL warmup native HTTP " + statusCode);
                }
            } catch (SocketTimeoutException ignored) {
                // Upload bytes were already written. Warmup response confirmation is helpful, not required.
            }
        } finally {
            if (responseStream != null) {
                try { responseStream.close(); } catch (Exception ignored) {}
            }
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
            if (connection != null) connection.disconnect();
        }

        return sent;
    }

    private JSObject measureNativeDownload(String url, int bytes, int timeoutMs, int durationSeconds, int warmupSeconds) throws Exception {
        int requestBytes = durationSeconds > 0 ? DEFAULT_DOWNLOAD_BYTES : Math.max(256 * 1024, bytes);
        long warmupBytes = warmupSeconds > 0 ? measureDownloadWarmupBytes(url, requestBytes, timeoutMs, warmupSeconds) : 0L;
        long startedNanos = System.nanoTime();
        long received = 0L;
        int lastStatusCode = 0;
        long targetNanos = durationSeconds > 0 ? durationSeconds * 1000000000L : 0L;

        do {
            HttpURLConnection connection = null;
            InputStream input = null;
            try {
                URL target = new URL(prepareDownloadUrl(url, requestBytes));
                connection = (HttpURLConnection) target.openConnection();
                connection.setRequestMethod("GET");
                int effectiveTimeoutMs = durationSeconds > 0 ? clampInt(durationSeconds * 1000 + 1800, 1800, timeoutMs) : timeoutMs;
                connection.setConnectTimeout(effectiveTimeoutMs);
                connection.setReadTimeout(effectiveTimeoutMs);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "BabyDragon-Mobile/1.1 Android NativeTHP");
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept", "application/octet-stream,*/*");
                connection.connect();

                lastStatusCode = connection.getResponseCode();
                if (lastStatusCode < 200 || lastStatusCode >= 400) {
                    throw new Exception("DL native HTTP " + lastStatusCode);
                }

                input = new BufferedInputStream(connection.getInputStream());
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    received += read;
                    if (targetNanos > 0 && (System.nanoTime() - startedNanos) >= targetNanos) {
                        break;
                    }
                }
            } finally {
                if (input != null) {
                    try { input.close(); } catch (Exception ignored) {}
                }
                if (connection != null) connection.disconnect();
            }

            if (targetNanos <= 0) break;
        } while ((System.nanoTime() - startedNanos) < targetNanos);

        double seconds = Math.max(0.15, (System.nanoTime() - startedNanos) / 1000000000.0);
        JSObject result = new JSObject();
        result.put("status", "complete");
        result.put("httpStatus", lastStatusCode);
        result.put("bytes", received);
        result.put("measuredBytes", received);
        result.put("warmupBytes", warmupBytes);
        result.put("warmupSeconds", warmupSeconds);
        result.put("seconds", seconds);
        result.put("wallSeconds", seconds);
        result.put("durationTargetSeconds", durationSeconds);
        result.put("durationLimited", durationSeconds > 0 && seconds >= Math.max(0.8, durationSeconds * 0.85));
        result.put("mbps", (received * 8.0) / seconds / 1000000.0);
        return result;
    }

    private JSObject measureNativeUpload(String url, int bytes, int timeoutMs, int durationSeconds, int warmupSeconds) throws Exception {
        long warmupBytes = warmupSeconds > 0 ? measureUploadWarmupBytes(url, timeoutMs, warmupSeconds) : 0L;
        long startedNanos = System.nanoTime();
        long sent = 0L;
        HttpURLConnection connection = null;
        OutputStream output = null;
        InputStream responseStream = null;

        try {
            URL target = new URL(prepareUploadUrl(url));
            connection = (HttpURLConnection) target.openConnection();
            connection.setRequestMethod("POST");
            int effectiveTimeoutMs = durationSeconds > 0 ? clampInt(durationSeconds * 1000 + 1800, 1800, timeoutMs) : timeoutMs;
            connection.setConnectTimeout(effectiveTimeoutMs);
            connection.setReadTimeout(effectiveTimeoutMs);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", "BabyDragon-Mobile/1.1 Android NativeTHP");
            if (durationSeconds > 0) {
                connection.setChunkedStreamingMode(64 * 1024);
            } else {
                connection.setFixedLengthStreamingMode(bytes);
            }
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/json,text/plain,*/*");

            output = new BufferedOutputStream(connection.getOutputStream());
            byte[] buffer = new byte[64 * 1024];
            for (int index = 0; index < buffer.length; index += 1) {
                buffer[index] = (byte) (index % 251);
            }

            long targetNanos = durationSeconds > 0 ? durationSeconds * 1000000000L : 0L;
            if (targetNanos > 0) {
                while ((System.nanoTime() - startedNanos) < targetNanos) {
                    output.write(buffer, 0, buffer.length);
                    sent += buffer.length;
                }
            } else {
                int remaining = bytes;
                while (remaining > 0) {
                    int chunk = Math.min(buffer.length, remaining);
                    output.write(buffer, 0, chunk);
                    sent += chunk;
                    remaining -= chunk;
                }
            }
            output.flush();
            long transferEndedNanos = System.nanoTime();

            int statusCode = 0;
            boolean responseConfirmed = true;
            String uploadStatus = "complete";
            try {
                statusCode = connection.getResponseCode();
                responseStream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (responseStream != null) {
                    byte[] drain = new byte[4096];
                    while (responseStream.read(drain) != -1) {
                        // drain response so Android closes the socket cleanly
                    }
                }
            } catch (SocketTimeoutException timeoutException) {
                responseConfirmed = false;
                uploadStatus = "complete_upload_response_timeout";
                statusCode = 202;
            }

            if (responseConfirmed && (statusCode < 200 || statusCode >= 400)) {
                throw new Exception("UL native HTTP " + statusCode);
            }

            double transferSeconds = Math.max(0.15, (transferEndedNanos - startedNanos) / 1000000000.0);
            double wallSeconds = Math.max(0.15, (System.nanoTime() - startedNanos) / 1000000000.0);
            JSObject result = new JSObject();
            result.put("status", uploadStatus);
            result.put("httpStatus", statusCode);
            result.put("responseConfirmed", responseConfirmed);
            result.put("bytes", sent);
            result.put("measuredBytes", sent);
            result.put("warmupBytes", warmupBytes);
            result.put("warmupSeconds", warmupSeconds);
            result.put("seconds", transferSeconds);
            result.put("wallSeconds", wallSeconds);
            result.put("durationTargetSeconds", durationSeconds);
            result.put("durationLimited", durationSeconds > 0 && transferSeconds >= Math.max(0.8, durationSeconds * 0.85));
            result.put("mbps", (sent * 8.0) / transferSeconds / 1000000.0);
            return result;
        } finally {
            if (responseStream != null) {
                try { responseStream.close(); } catch (Exception ignored) {}
            }
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
            if (connection != null) connection.disconnect();
        }
    }

    private JSObject buildPermissionStatus(Context context) {
        JSObject permissions = new JSObject();
        permissions.put("fineLocation", ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        permissions.put("coarseLocation", ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        permissions.put("readPhoneState", ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED);
        return permissions;
    }

    private JSObject buildSignalStrengthSnapshot(Context context, TelephonyManager telephonyManager) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", "SignalStrength");

        boolean hasPhoneState = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
        if (!hasPhoneState) {
            result.put("status", "read_phone_state_permission_needed");
            result.put("message", "READ_PHONE_STATE is needed for SignalStrength fallback on some Android devices.");
            return result;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            result.put("status", "android_api_too_old");
            result.put("message", "SignalStrength fallback requires Android P or newer.");
            return result;
        }

        try {
            SignalStrength signalStrength = telephonyManager.getSignalStrength();
            if (signalStrength == null) {
                result.put("status", "signal_strength_null");
                result.put("message", "Android returned no SignalStrength object.");
                return result;
            }

            String rawSignalText = signalStrength.toString();
            result.put("rawTextAvailable", rawSignalText != null && rawSignalText.length() > 0);

            JSArray radios = new JSArray();
            JSObject lte = null;
            JSObject nr = null;
            JSObject wcdma = null;
            JSObject gsm = null;
            JSObject cdma = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                List<CellSignalStrength> strengths = signalStrength.getCellSignalStrengths();
                if (strengths != null) {
                    for (CellSignalStrength strength : strengths) {
                        JSObject parsed = parseSignalStrength(strength);
                        if (!hasCellObject(parsed)) continue;

                        radios.put(parsed);
                        String rat = parsed.optString("rat", "");
                        if ("LTE".equalsIgnoreCase(rat) && lte == null) lte = parsed;
                        if ("NR".equalsIgnoreCase(rat) && nr == null) nr = parsed;
                        if ("WCDMA".equalsIgnoreCase(rat) && wcdma == null) wcdma = parsed;
                        if ("GSM".equalsIgnoreCase(rat) && gsm == null) gsm = parsed;
                        if ("CDMA".equalsIgnoreCase(rat) && cdma == null) cdma = parsed;
                    }
                }
            }

            result.put("ok", radios.length() > 0);
            result.put("status", radios.length() > 0 ? "signal_strength_ready" : "signal_strength_empty");
            result.put("radios", radios);
            result.put("radioCount", radios.length());
            result.put("lte", lte != null ? lte : new JSObject());
            result.put("nr", nr != null ? nr : new JSObject());
            result.put("wcdma", wcdma != null ? wcdma : new JSObject());
            result.put("gsm", gsm != null ? gsm : new JSObject());
            result.put("cdma", cdma != null ? cdma : new JSObject());

            mergeRawSignalTextFallback(result, rawSignalText);
            boolean rawParsed = result.optBoolean("rawParseUsed", false);
            result.put("ok", radios.length() > 0 || rawParsed);
            result.put("status", radios.length() > 0 || rawParsed ? "signal_strength_ready" : "signal_strength_empty");
            result.put("message", rawParsed || radios.length() > 0 ? "SignalStrength fallback loaded." : "SignalStrength did not expose per-RAT RF values.");
        } catch (SecurityException securityException) {
            result.put("status", "security_exception");
            result.put("message", securityException.getMessage());
        } catch (Exception exception) {
            result.put("status", "signal_strength_exception");
            result.put("message", exception.getMessage());
        }

        return result;
    }

    private void mergeRawSignalTextFallback(JSObject signalStrengthResult, String rawSignalText) {
        if (rawSignalText == null || rawSignalText.trim().isEmpty()) return;

        JSObject parsedLte = parseRawLteSignalText(rawSignalText);
        if (hasSignalMeasurement(parsedLte)) {
            JSObject currentLte = optJSObject(signalStrengthResult, "lte");
            if (hasCellObject(currentLte)) {
                mergeSignalFallback(currentLte, parsedLte, "LTE_RAW_TEXT");
                signalStrengthResult.put("lte", currentLte);
            } else {
                signalStrengthResult.put("lte", parsedLte);
            }
            signalStrengthResult.put("rawParseUsed", true);
        }

        JSObject parsedNr = parseRawNrSignalText(rawSignalText);
        if (hasSignalMeasurement(parsedNr)) {
            JSObject currentNr = optJSObject(signalStrengthResult, "nr");
            if (hasCellObject(currentNr)) {
                mergeSignalFallback(currentNr, parsedNr, "NR_RAW_TEXT");
                signalStrengthResult.put("nr", currentNr);
            } else {
                signalStrengthResult.put("nr", parsedNr);
            }
            signalStrengthResult.put("rawParseUsed", true);
        }
    }

    private JSObject parseRawLteSignalText(String rawSignalText) {
        JSObject cell = new JSObject();
        cell.put("source", "SignalStrength.toString");
        cell.put("identityExposed", false);
        cell.put("measurementOnly", true);
        cell.put("rat", "LTE");
        cell.put("ratFamily", "4G");
        cell.put("technology", "4G LTE");

        Integer rsrp = findFirstInt(rawSignalText, "(?i)(?:rsrp|lteRsrp)\\s*[=:]\\s*(-?\\d+)");
        Integer rsrq = findFirstInt(rawSignalText, "(?i)(?:rsrq|lteRsrq)\\s*[=:]\\s*(-?\\d+)");
        Integer rssi = findFirstInt(rawSignalText, "(?i)(?:rssi|lteRssi)\\s*[=:]\\s*(-?\\d+)");
        Integer rssnr = findFirstInt(rawSignalText, "(?i)(?:rssnr|lteRssnr|sinr|lteSinr)\\s*[=:]\\s*(-?\\d+)");

        if (hasValidIntValue(rsrp)) putIfValidInt(cell, "rsrp", rsrp);
        if (hasValidIntValue(rsrq)) putIfValidInt(cell, "rsrq", rsrq);
        if (hasValidIntValue(rssi)) putIfValidInt(cell, "rssi", rssi);
        if (hasValidIntValue(rssnr)) putIfValidLteRssnr(cell, rssnr, "SignalStrength.toString.rssnr");
        return cell;
    }

    private JSObject parseRawNrSignalText(String rawSignalText) {
        JSObject cell = new JSObject();
        cell.put("source", "SignalStrength.toString");
        cell.put("identityExposed", false);
        cell.put("measurementOnly", true);
        cell.put("rat", "NR");
        cell.put("ratFamily", "5G");
        cell.put("technology", "5G NR");

        Integer ssRsrp = findFirstInt(rawSignalText, "(?i)(?:ssRsrp|nrSsRsrp|nrRsrp)\\s*[=:]\\s*(-?\\d+)");
        Integer ssRsrq = findFirstInt(rawSignalText, "(?i)(?:ssRsrq|nrSsRsrq|nrRsrq)\\s*[=:]\\s*(-?\\d+)");
        Integer ssSinr = findFirstInt(rawSignalText, "(?i)(?:ssSinr|nrSsSinr|nrSinr)\\s*[=:]\\s*(-?\\d+)");

        if (hasValidIntValue(ssRsrp)) {
            putIfValidInt(cell, "rsrp", ssRsrp);
            putIfValidInt(cell, "ssRsrp", ssRsrp);
        }
        if (hasValidIntValue(ssRsrq)) {
            putIfValidInt(cell, "rsrq", ssRsrq);
            putIfValidInt(cell, "ssRsrq", ssRsrq);
        }
        if (hasValidIntValue(ssSinr)) {
            putIfValidInt(cell, "sinr", ssSinr);
            putIfValidInt(cell, "ssSinr", ssSinr);
            cell.put("sinrSource", "SignalStrength.toString.ssSinr");
        }
        return cell;
    }

    private Integer findFirstInt(String text, String regex) {
        if (text == null) return null;
        Matcher matcher = Pattern.compile(regex).matcher(text);
        if (!matcher.find()) return null;
        try {
            return Integer.parseInt(matcher.group(1));
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean hasValidIntValue(Integer value) {
        return value != null && hasValidInt(value);
    }

    private JSObject parseSignalStrength(CellSignalStrength strength) {
        JSObject cell = new JSObject();
        cell.put("source", "SignalStrength");
        cell.put("identityExposed", false);
        cell.put("measurementOnly", true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && strength instanceof CellSignalStrengthNr) {
            parseNrSignalStrength((CellSignalStrengthNr) strength, cell);
        } else if (strength instanceof CellSignalStrengthLte) {
            parseLteSignalStrength((CellSignalStrengthLte) strength, cell);
        } else if (strength instanceof CellSignalStrengthWcdma) {
            parseWcdmaSignalStrength((CellSignalStrengthWcdma) strength, cell);
        } else if (strength instanceof CellSignalStrengthGsm) {
            parseGsmSignalStrength((CellSignalStrengthGsm) strength, cell);
        } else if (strength instanceof CellSignalStrengthCdma) {
            parseCdmaSignalStrength((CellSignalStrengthCdma) strength, cell);
        } else {
            cell.put("rat", "UNKNOWN");
            cell.put("technology", "Unknown");
        }

        return cell;
    }

    private JSObject parseCellInfo(CellInfo cellInfo) {
        JSObject cell = new JSObject();
        cell.put("registered", cellInfo.isRegistered());
        cell.put("timestampNanos", cellInfo.getTimeStamp());
        cell.put("source", "CellInfo");
        cell.put("identityExposed", true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int connectionStatus = cellInfo.getCellConnectionStatus();
            cell.put("connectionStatus", connectionStatus);
            cell.put("connectionStatusName", connectionStatusName(connectionStatus));
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && cellInfo instanceof CellInfoNr) {
            parseNr((CellInfoNr) cellInfo, cell);
        } else if (cellInfo instanceof CellInfoLte) {
            parseLte((CellInfoLte) cellInfo, cell);
        } else if (cellInfo instanceof CellInfoWcdma) {
            parseWcdma((CellInfoWcdma) cellInfo, cell);
        } else if (cellInfo instanceof CellInfoGsm) {
            parseGsm((CellInfoGsm) cellInfo, cell);
        } else if (cellInfo instanceof CellInfoCdma) {
            parseCdma((CellInfoCdma) cellInfo, cell);
        } else {
            cell.put("rat", "UNKNOWN");
            cell.put("technology", "Unknown");
        }

        return cell;
    }

    private void parseNr(CellInfoNr info, JSObject cell) {
        CellIdentityNr id = (CellIdentityNr) info.getCellIdentity();
        CellSignalStrengthNr sig = (CellSignalStrengthNr) info.getCellSignalStrength();

        cell.put("rat", "NR");
        cell.put("ratFamily", "5G");
        cell.put("technology", "5G NR");
        putIfValidLong(cell, "cellId", id.getNci());
        putIfValidLong(cell, "nci", id.getNci());
        putIfValidInt(cell, "pci", id.getPci());
        putIfValidInt(cell, "tac", id.getTac());
        putIfValidInt(cell, "channel", id.getNrarfcn());
        putIfValidInt(cell, "nrarfcn", id.getNrarfcn());
        putIfValidInt(cell, "rsrp", sig.getSsRsrp());
        putIfValidInt(cell, "ssRsrp", sig.getSsRsrp());
        putIfValidInt(cell, "rsrq", sig.getSsRsrq());
        putIfValidInt(cell, "ssRsrq", sig.getSsRsrq());
        putIfValidInt(cell, "sinr", sig.getSsSinr());
        putIfValidInt(cell, "ssSinr", sig.getSsSinr());
        if (hasValidInt(sig.getSsSinr())) cell.put("sinrSource", "CellInfo.getSsSinr");
        putIfValidInt(cell, "level", sig.getLevel());
        if (Build.VERSION.SDK_INT >= 34) {
            putIfValidInt(cell, "timingAdvance", sig.getTimingAdvanceMicros());
            cell.put("timingAdvanceUnit", "microseconds");
        }
    }

    private void parseLte(CellInfoLte info, JSObject cell) {
        CellIdentityLte id = info.getCellIdentity();
        CellSignalStrengthLte sig = info.getCellSignalStrength();

        cell.put("rat", "LTE");
        cell.put("ratFamily", "4G");
        cell.put("technology", "4G LTE");
        putIfValidInt(cell, "cellId", id.getCi());
        putIfValidInt(cell, "ci", id.getCi());
        putIfValidInt(cell, "pci", id.getPci());
        putIfValidInt(cell, "tac", id.getTac());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            putIfValidInt(cell, "channel", id.getEarfcn());
            putIfValidInt(cell, "earfcn", id.getEarfcn());
        }
        putIfValidInt(cell, "dbm", sig.getDbm());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            putIfValidInt(cell, "rsrp", sig.getRsrp());
            putIfValidInt(cell, "rsrq", sig.getRsrq());
            putIfValidLteRssnr(cell, sig.getRssnr(), "CellInfo.getRssnr");
            putIfValidInt(cell, "timingAdvance", sig.getTimingAdvance());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            putIfValidInt(cell, "rssi", sig.getRssi());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseWcdma(CellInfoWcdma info, JSObject cell) {
        CellIdentityWcdma id = info.getCellIdentity();
        CellSignalStrengthWcdma sig = info.getCellSignalStrength();

        cell.put("rat", "WCDMA");
        cell.put("ratFamily", "3G");
        cell.put("technology", "3G WCDMA");
        putIfValidInt(cell, "cellId", id.getCid());
        putIfValidInt(cell, "cid", id.getCid());
        putIfValidInt(cell, "lac", id.getLac());
        putIfValidInt(cell, "psc", id.getPsc());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            putIfValidInt(cell, "channel", id.getUarfcn());
            putIfValidInt(cell, "uarfcn", id.getUarfcn());
        }
        putIfValidInt(cell, "rscp", sig.getDbm());
        putIfValidInt(cell, "dbm", sig.getDbm());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            putIfValidInt(cell, "ecno", sig.getEcNo());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseGsm(CellInfoGsm info, JSObject cell) {
        CellIdentityGsm id = info.getCellIdentity();
        CellSignalStrengthGsm sig = info.getCellSignalStrength();

        cell.put("rat", "GSM");
        cell.put("ratFamily", "2G");
        cell.put("technology", "2G GSM");
        putIfValidInt(cell, "cellId", id.getCid());
        putIfValidInt(cell, "cid", id.getCid());
        putIfValidInt(cell, "lac", id.getLac());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            putIfValidInt(cell, "channel", id.getArfcn());
            putIfValidInt(cell, "arfcn", id.getArfcn());
            putIfValidInt(cell, "bsic", id.getBsic());
        }
        putIfValidInt(cell, "rssi", sig.getDbm());
        putIfValidInt(cell, "rxlev", sig.getDbm());
        putIfValidInt(cell, "ber", sig.getBitErrorRate());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            putIfValidInt(cell, "timingAdvance", sig.getTimingAdvance());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseCdma(CellInfoCdma info, JSObject cell) {
        CellIdentityCdma id = info.getCellIdentity();
        CellSignalStrengthCdma sig = info.getCellSignalStrength();

        cell.put("rat", "CDMA");
        cell.put("ratFamily", "3G");
        cell.put("technology", "CDMA");
        putIfValidInt(cell, "cellId", id.getBasestationId());
        putIfValidInt(cell, "networkId", id.getNetworkId());
        putIfValidInt(cell, "systemId", id.getSystemId());
        putIfValidInt(cell, "rssi", sig.getCdmaDbm());
        putIfValidInt(cell, "ecio", sig.getCdmaEcio());
        putIfValidInt(cell, "evdoDbm", sig.getEvdoDbm());
        putIfValidInt(cell, "evdoSnr", sig.getEvdoSnr());
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseNrSignalStrength(CellSignalStrengthNr sig, JSObject cell) {
        cell.put("rat", "NR");
        cell.put("ratFamily", "5G");
        cell.put("technology", "5G NR");
        putIfValidInt(cell, "rsrp", sig.getSsRsrp());
        putIfValidInt(cell, "ssRsrp", sig.getSsRsrp());
        putIfValidInt(cell, "rsrq", sig.getSsRsrq());
        putIfValidInt(cell, "ssRsrq", sig.getSsRsrq());
        putIfValidInt(cell, "sinr", sig.getSsSinr());
        putIfValidInt(cell, "ssSinr", sig.getSsSinr());
        if (hasValidInt(sig.getSsSinr())) cell.put("sinrSource", "SignalStrength.getSsSinr");
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseLteSignalStrength(CellSignalStrengthLte sig, JSObject cell) {
        cell.put("rat", "LTE");
        cell.put("ratFamily", "4G");
        cell.put("technology", "4G LTE");
        putIfValidInt(cell, "dbm", sig.getDbm());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            putIfValidInt(cell, "rsrp", sig.getRsrp());
            putIfValidInt(cell, "rsrq", sig.getRsrq());
            putIfValidLteRssnr(cell, sig.getRssnr(), "SignalStrength.getRssnr");
            putIfValidInt(cell, "timingAdvance", sig.getTimingAdvance());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            putIfValidInt(cell, "rssi", sig.getRssi());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseWcdmaSignalStrength(CellSignalStrengthWcdma sig, JSObject cell) {
        cell.put("rat", "WCDMA");
        cell.put("ratFamily", "3G");
        cell.put("technology", "3G WCDMA");
        putIfValidInt(cell, "rscp", sig.getDbm());
        putIfValidInt(cell, "dbm", sig.getDbm());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            putIfValidInt(cell, "ecno", sig.getEcNo());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseGsmSignalStrength(CellSignalStrengthGsm sig, JSObject cell) {
        cell.put("rat", "GSM");
        cell.put("ratFamily", "2G");
        cell.put("technology", "2G GSM");
        putIfValidInt(cell, "rssi", sig.getDbm());
        putIfValidInt(cell, "rxlev", sig.getDbm());
        putIfValidInt(cell, "ber", sig.getBitErrorRate());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            putIfValidInt(cell, "timingAdvance", sig.getTimingAdvance());
        }
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void parseCdmaSignalStrength(CellSignalStrengthCdma sig, JSObject cell) {
        cell.put("rat", "CDMA");
        cell.put("ratFamily", "3G");
        cell.put("technology", "CDMA");
        putIfValidInt(cell, "rssi", sig.getCdmaDbm());
        putIfValidInt(cell, "ecio", sig.getCdmaEcio());
        putIfValidInt(cell, "evdoDbm", sig.getEvdoDbm());
        putIfValidInt(cell, "evdoSnr", sig.getEvdoSnr());
        putIfValidInt(cell, "level", sig.getLevel());
    }

    private void mergeSignalFallback(JSObject target, JSObject signal, String ratFamily) {
        if (!hasSignalMeasurement(signal)) return;

        boolean copied = false;
        copied = copyIfMissing(target, signal, "dbm") || copied;
        copied = copyIfMissing(target, signal, "rssi") || copied;
        copied = copyIfMissing(target, signal, "rsrp") || copied;
        copied = copyIfMissing(target, signal, "ssRsrp") || copied;
        copied = copyIfMissing(target, signal, "rscp") || copied;
        copied = copyIfMissing(target, signal, "rsrq") || copied;
        copied = copyIfMissing(target, signal, "ssRsrq") || copied;
        copied = copyIfMissing(target, signal, "ecno") || copied;
        copied = copyIfMissing(target, signal, "sinr") || copied;
        copied = copyIfMissing(target, signal, "rssnr") || copied;
        copied = copyIfMissing(target, signal, "ssSinr") || copied;
        copied = copyIfMissing(target, signal, "rssnrRaw") || copied;
        copied = copyIfMissing(target, signal, "ber") || copied;
        copied = copyIfMissing(target, signal, "rxlev") || copied;
        copied = copyIfMissing(target, signal, "timingAdvance") || copied;
        copied = copyIfMissing(target, signal, "level") || copied;

        if (!target.has("sinrSource") && signal.has("sinrSource")) {
            target.put("sinrSource", signal.optString("sinrSource", "SignalStrength"));
            copied = true;
        }

        if (copied) {
            target.put("signalStrengthFallbackUsed", true);
            target.put("measurementSources", "CellInfo + SignalStrength");
        } else if (!target.has("measurementSources")) {
            target.put("measurementSources", target.optString("source", "CellInfo"));
        }

        target.put("fallbackRatFamily", ratFamily);
    }

    private JSObject buildMeasurementOnlyCell(JSObject signal, String rat, String technology, String role) {
        JSObject cell = new JSObject();
        cell.put("rat", rat);
        cell.put("technology", technology);
        cell.put("role", role);
        cell.put("source", "SignalStrength");
        cell.put("measurementSources", "SignalStrength");
        cell.put("identityExposed", false);
        cell.put("measurementOnly", true);

        copyIfMissing(cell, signal, "dbm");
        copyIfMissing(cell, signal, "rssi");
        copyIfMissing(cell, signal, "rsrp");
        copyIfMissing(cell, signal, "ssRsrp");
        copyIfMissing(cell, signal, "rscp");
        copyIfMissing(cell, signal, "rsrq");
        copyIfMissing(cell, signal, "ssRsrq");
        copyIfMissing(cell, signal, "ecno");
        copyIfMissing(cell, signal, "sinr");
        copyIfMissing(cell, signal, "rssnr");
        copyIfMissing(cell, signal, "ssSinr");
        copyIfMissing(cell, signal, "rssnrRaw");
        copyIfMissing(cell, signal, "ber");
        copyIfMissing(cell, signal, "rxlev");
        copyIfMissing(cell, signal, "timingAdvance");
        copyIfMissing(cell, signal, "level");
        copyIfMissing(cell, signal, "sinrSource");

        return cell;
    }

    private boolean copyIfMissing(JSObject target, JSObject source, String key) {
        if (target == null || source == null) return false;
        if (target.has(key) || !source.has(key)) return false;
        target.put(key, source.opt(key));
        return true;
    }

    private JSObject optJSObject(JSObject object, String key) {
        if (object == null || !object.has(key)) return null;
        Object value = object.opt(key);
        if (value instanceof JSObject) return (JSObject) value;
        return null;
    }

    private boolean hasSignalMeasurement(JSObject object) {
        if (object == null) return false;
        return object.has("rsrp")
            || object.has("ssRsrp")
            || object.has("rscp")
            || object.has("rsrq")
            || object.has("ssRsrq")
            || object.has("ecno")
            || object.has("sinr")
            || object.has("ssSinr")
            || object.has("rssnr")
            || object.has("rssi")
            || object.has("rxlev")
            || object.has("dbm");
    }

    private boolean isServingOrSecondary(CellInfo cellInfo) {
        if (cellInfo.isRegistered()) return true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int status = cellInfo.getCellConnectionStatus();
            return status == CellInfo.CONNECTION_PRIMARY_SERVING || status == CellInfo.CONNECTION_SECONDARY_SERVING;
        }

        return false;
    }

    private boolean hasCellObject(JSObject object) {
        return object != null && object.has("rat");
    }

    private boolean hasRat(JSObject object, String rat) {
        return object != null && rat.equalsIgnoreCase(object.optString("rat", ""));
    }

    private JSObject chooseBackwardCompatibleServing(
        JSObject lteAnchor,
        JSObject nrSecondary,
        JSObject threeGServing,
        JSObject twoGServing,
        JSObject firstServing,
        JSObject firstCell
    ) {
        if (hasCellObject(lteAnchor)) return lteAnchor;
        if (hasCellObject(nrSecondary)) return nrSecondary;
        if (hasCellObject(threeGServing)) return threeGServing;
        if (hasCellObject(twoGServing)) return twoGServing;
        if (hasCellObject(firstServing)) return firstServing;
        if (hasCellObject(firstCell)) return firstCell;
        return null;
    }

    private String buildSnapshotMessage(
        boolean hasLteAnchor,
        boolean hasNrSecondary,
        boolean nrMeasurementOnly,
        boolean dataSaysNr,
        int cellCount,
        boolean hasSignalStrength
    ) {
        if (cellCount <= 0 && !hasSignalStrength) return "No cell RF info returned by Android yet.";
        if (hasLteAnchor && hasNrSecondary && nrMeasurementOnly) return "LTE anchor live. NR RF measurement exposed by SignalStrength, NR identity not exposed.";
        if (hasLteAnchor && hasNrSecondary) return "Android exposed LTE anchor and NR secondary.";
        if (hasLteAnchor && dataSaysNr) return "LTE anchor live. NR secondary is not exposed by Android/device/carrier.";
        if (hasLteAnchor) return "LTE anchor live. SignalStrength fallback enabled for missing RF values.";
        if (hasNrSecondary && nrMeasurementOnly) return "NR RF measurement exposed by SignalStrength. Cell identity is not exposed.";
        if (hasNrSecondary) return "NR cell exposed by Android.";
        if (hasSignalStrength) return "SignalStrength RF measurements loaded.";
        return "Android RF snapshot loaded.";
    }

    private String resolveCurrentRatName(
        String dataNetworkTypeName,
        boolean nsaCandidate,
        boolean hasNrSecondary,
        boolean nrMeasurementOnly,
        JSObject serving
    ) {
        if (nsaCandidate) {
            if (hasNrSecondary && nrMeasurementOnly) return "NR NSA · LTE Anchor + NR RF measurement";
            if (hasNrSecondary) return "NR NSA · LTE Anchor + NR Secondary";
            return "NR NSA · LTE Anchor only";
        }

        String servingTechnology = serving != null ? serving.optString("technology", "") : "";
        if (servingTechnology != null && !servingTechnology.trim().isEmpty()) {
            return servingTechnology;
        }

        if (dataNetworkTypeName != null && !dataNetworkTypeName.trim().isEmpty()) {
            return dataNetworkTypeName;
        }

        return "Unknown";
    }

    private String connectionStatusName(int status) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (status == CellInfo.CONNECTION_PRIMARY_SERVING) return "primary_serving";
            if (status == CellInfo.CONNECTION_SECONDARY_SERVING) return "secondary_serving";
            if (status == CellInfo.CONNECTION_NONE) return "none";
            if (status == CellInfo.CONNECTION_UNKNOWN) return "unknown";
        }
        return "unavailable";
    }

    private String safeGetNetworkOperator(TelephonyManager telephonyManager) {
        try {
            return telephonyManager.getNetworkOperator();
        } catch (Exception ignored) {
            return "";
        }
    }

    private int safeGetDataNetworkType(TelephonyManager telephonyManager) {
        try {
            return telephonyManager.getDataNetworkType();
        } catch (Exception ignored) {
            return TelephonyManager.NETWORK_TYPE_UNKNOWN;
        }
    }

    private String safeGetCallState(Context context, TelephonyManager telephonyManager) {
        boolean hasPhoneState = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
        if (!hasPhoneState) return "permission_needed";
        try {
            int state = telephonyManager.getCallState();
            if (state == TelephonyManager.CALL_STATE_IDLE) return "idle";
            if (state == TelephonyManager.CALL_STATE_RINGING) return "ringing";
            if (state == TelephonyManager.CALL_STATE_OFFHOOK) return "offhook";
            return "unknown";
        } catch (Exception ignored) {
            return "unavailable";
        }
    }

    private boolean hasValidInt(int value) {
        return value != UNAVAILABLE && value != Integer.MAX_VALUE && value != Integer.MIN_VALUE;
    }

    private void putIfValidInt(JSObject object, String key, int value) {
        if (hasValidInt(value)) {
            object.put(key, value);
        }
    }

    private void putIfValidLong(JSObject object, String key, long value) {
        if (value != Long.MAX_VALUE && value != Long.MIN_VALUE && value >= 0) {
            object.put(key, String.valueOf(value));
        }
    }

    private void putIfValidDouble(JSObject object, String key, double value) {
        if (!Double.isNaN(value) && !Double.isInfinite(value)) {
            object.put(key, value);
        }
    }

    private void putIfValidLteRssnr(JSObject object, int rawRssnr, String source) {
        if (!hasValidInt(rawRssnr)) return;
        double sinrDb = Math.round((rawRssnr / 10.0) * 10.0) / 10.0;
        putIfValidDouble(object, "sinr", sinrDb);
        putIfValidDouble(object, "rssnr", sinrDb);
        putIfValidInt(object, "rssnrRaw", rawRssnr);
        object.put("sinrSource", source);
        object.put("sinrScale", "LTE RSSNR raw value divided by 10 to report dB.");
    }

    private String safeText(String value) {
        if (value == null || value.trim().isEmpty()) return "N/A";
        return value;
    }

    private String networkTypeName(int type) {
        switch (type) {
            case TelephonyManager.NETWORK_TYPE_NR: return "5G NR";
            case TelephonyManager.NETWORK_TYPE_LTE: return "LTE";
            case TelephonyManager.NETWORK_TYPE_HSPAP: return "HSPA+";
            case TelephonyManager.NETWORK_TYPE_HSPA: return "HSPA";
            case TelephonyManager.NETWORK_TYPE_HSDPA: return "HSDPA";
            case TelephonyManager.NETWORK_TYPE_HSUPA: return "HSUPA";
            case TelephonyManager.NETWORK_TYPE_UMTS: return "UMTS";
            case TelephonyManager.NETWORK_TYPE_EDGE: return "EDGE";
            case TelephonyManager.NETWORK_TYPE_GPRS: return "GPRS";
            case TelephonyManager.NETWORK_TYPE_GSM: return "GSM";
            case TelephonyManager.NETWORK_TYPE_CDMA: return "CDMA";
            case TelephonyManager.NETWORK_TYPE_EVDO_0: return "EVDO 0";
            case TelephonyManager.NETWORK_TYPE_EVDO_A: return "EVDO A";
            case TelephonyManager.NETWORK_TYPE_EVDO_B: return "EVDO B";
            case TelephonyManager.NETWORK_TYPE_1xRTT: return "1xRTT";
            default: return "Unknown";
        }
    }
}
