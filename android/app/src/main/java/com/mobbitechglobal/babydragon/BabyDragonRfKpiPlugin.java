package com.mobbitechglobal.babydragon;

import android.Manifest;
import android.content.Context;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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


    @PluginMethod
    public void getSnapshot(PluginCall call) {
        JSObject result = new JSObject();
        Context context = getContext();

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
            call.resolve(result);
            return;
        }

        TelephonyManager telephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
        if (telephonyManager == null) {
            result.put("status", "telephony_unavailable");
            result.put("message", "Telephony service is unavailable on this device.");
            call.resolve(result);
            return;
        }

        // Step 1E3: one-second UI polling should not wait on requestCellInfoUpdate.
        // getAllCellInfo + SignalStrength returns quickly and keeps Live/Avg breathing.
        result.put("freshReadMode", "fast_1s_poll");
        resolveSnapshot(call, context, telephonyManager, result, safeGetAllCellInfo(telephonyManager), "getAllCellInfo_fast_1s_poll");
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

        call.resolve(result);
    }

    @PluginMethod
    public void runThroughputTest(PluginCall call) {
        final String phase = call.getString("phase", "download");
        final boolean upload = "upload".equalsIgnoreCase(phase);
        Integer requestedBytes = call.getInt("bytes");
        Integer requestedTimeout = call.getInt("timeoutMs");
        Integer requestedDuration = call.getInt("durationSeconds");
        Integer requestedInterval = call.getInt("intervalSeconds");
        final int durationSeconds = clampInt(requestedDuration != null ? requestedDuration.intValue() : 0, 0, 300);
        final int intervalSeconds = clampInt(requestedInterval != null ? requestedInterval.intValue() : 1, 1, 10);
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
                result.put("source", "native-httpurlconnection-v1.1.0-step-1f7-duration-truth");
                result.put("requestedBytes", bytes);
                result.put("durationSeconds", durationSeconds);
                result.put("intervalSeconds", intervalSeconds);
                result.put("urlHost", hostOnly(url));
                result.put("timestamp", System.currentTimeMillis());

                try {
                    JSObject measured = upload
                        ? measureNativeUpload(url, bytes, timeoutMs, durationSeconds)
                        : measureNativeDownload(url, bytes, timeoutMs, durationSeconds);

                    measured.put("ok", true);
                    measured.put("phase", upload ? "upload" : "download");
                    measured.put("source", "native-httpurlconnection-v1.1.0-step-1f7-duration-truth");
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
                if (!(rawItem instanceof JSONObject)) continue;

                JSONObject item = (JSONObject) rawItem;
                String fileName = safeFileName(item.optString("fileName", "babydragon_report_" + (index + 1) + ".csv"));
                String content = item.optString("content", "");
                String mimeType = item.optString("mimeType", "text/csv");

                JSObject saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveTextToPublicDownloads(relativeFolder, fileName, mimeType, content)
                    : saveTextToLegacyDownloads(relativeFolder, fileName, mimeType, content);
                saved.put("reportLabel", item.optString("reportLabel", fileName));
                savedFiles.put(saved);
            }

            result.put("ok", true);
            result.put("status", "saved");
            result.put("message", "BabyDragon report files saved to public Downloads.");
            result.put("sessionId", sessionId);
            result.put("displayName", displayName);
            result.put("basePath", "Downloads/" + relativeFolder);
            result.put("savedFiles", savedFiles);
        } catch (Exception exception) {
            result.put("status", "save_report_exception");
            result.put("message", exception.getMessage() != null ? exception.getMessage() : "Report save failed.");
        }

        call.resolve(result);
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
                if (!(rawItem instanceof JSONObject)) continue;
                JSONObject item = (JSONObject) rawItem;
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
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType == null || mimeType.trim().isEmpty() ? "text/csv" : mimeType);
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
            byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
            output.write(bytes);
            output.flush();

            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, values, null, null);

            JSObject saved = new JSObject();
            saved.put("fileName", fileName);
            saved.put("mimeType", mimeType);
            saved.put("path", "Downloads/" + relativeFolder + "/" + fileName);
            saved.put("uri", uri.toString());
            saved.put("bytes", bytes.length);
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
        OutputStreamWriter writer = null;
        try {
            writer = new OutputStreamWriter(new FileOutputStream(outputFile, false), StandardCharsets.UTF_8);
            writer.write(content == null ? "" : content);
            writer.flush();
        } finally {
            if (writer != null) {
                try { writer.close(); } catch (Exception ignored) {}
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

    private JSObject measureNativeDownload(String url, int bytes, int timeoutMs, int durationSeconds) throws Exception {
        long startedNanos = System.nanoTime();
        long received = 0L;
        int lastStatusCode = 0;
        int requestBytes = durationSeconds > 0 ? DEFAULT_DOWNLOAD_BYTES : Math.max(256 * 1024, bytes);
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
        result.put("seconds", seconds);
        result.put("wallSeconds", seconds);
        result.put("durationTargetSeconds", durationSeconds);
        result.put("durationLimited", durationSeconds > 0 && seconds >= Math.max(0.8, durationSeconds * 0.85));
        result.put("mbps", (received * 8.0) / seconds / 1000000.0);
        return result;
    }

    private JSObject measureNativeUpload(String url, int bytes, int timeoutMs, int durationSeconds) throws Exception {
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
