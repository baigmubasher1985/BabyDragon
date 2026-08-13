package com.mobbitechglobal.babydragon;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.net.ftp.FTPReply;
import org.apache.commons.net.ftp.FTPSClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

@CapacitorPlugin(name = "BabyDragonFtp")
public class BabyDragonFtpPlugin extends Plugin {

    @PluginMethod
    public void runFtpTest(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    FtpConfig cfg = FtpConfig.from(call);
                    sendProgress("starting", cfg, 0, "FTP test started", null);

                    JSObject result = runFtpSession(cfg);

                    notifyListeners("ftpProgress", result);
                    call.resolve(result);
                } catch (Exception ex) {
                    JSObject err = new JSObject();
                    err.put("ok", false);
                    err.put("status", "error");
                    err.put("source", "native-ftp-v1g2a");
                    err.put("test_type", "ftp");
                    err.put("error_code", "FTP_UNKNOWN_ERROR");
                    err.put("message", ex.getMessage() == null ? "FTP test failed" : ex.getMessage());

                    notifyListeners("ftpProgress", err);
                    call.reject("FTP test failed: " + err.getString("message"));
                }
            }
        }).start();
    }

    private JSObject runFtpSession(FtpConfig cfg) throws Exception {
        long sessionStartedMs = System.currentTimeMillis();

        JSArray iterationsArray = new JSArray();

        double dlSum = 0.0;
        double ulSum = 0.0;
        int dlCount = 0;
        int ulCount = 0;

        long totalDlWarmupBytes = 0L;
        long totalDlMeasuredBytes = 0L;
        long totalUlWarmupBytes = 0L;
        long totalUlMeasuredBytes = 0L;

        boolean runDl = cfg.direction.equals("DL") || cfg.direction.equals("DL_UL");
        boolean runUl = cfg.direction.equals("UL") || cfg.direction.equals("DL_UL");

        int perDirectionDurationSec = cfg.durationSec;
        if (cfg.direction.equals("DL_UL")) {
            perDirectionDurationSec = Math.max(1, cfg.durationSec / 2);
        }

        boolean hasFailure = false;
        boolean hasRequestedMeasuredBytes = false;
        String firstErrorCode = "";
        String firstErrorMessage = "";

        for (int i = 1; i <= cfg.iterations; i++) {
            sendProgress("iteration_start", cfg, i, "FTP iteration " + i + " started", null);

            JSObject iterationObj = new JSObject();
            iterationObj.put("iteration", i);
            iterationObj.put("direction", cfg.direction);
            iterationObj.put("duration_sec", cfg.durationSec);
            iterationObj.put("duration_per_direction_sec", perDirectionDurationSec);
            iterationObj.put("warmup_sec", cfg.warmupSec);
            iterationObj.put("host", cfg.host);
            iterationObj.put("port", cfg.port);
            iterationObj.put("started_at_ms", System.currentTimeMillis());

            if (runDl) {
                TransferResult dl = runDownload(cfg, perDirectionDurationSec);
                iterationObj.put("dl", dl.toJson());

                if (dl.ok && dl.mbps != null && dl.measuredBytes > 0L) {
                    dlSum += dl.mbps;
                    dlCount++;
                    hasRequestedMeasuredBytes = true;
                } else {
                    hasFailure = true;
                    if (firstErrorCode.isEmpty()) firstErrorCode = dl.errorCode;
                    if (firstErrorMessage.isEmpty()) firstErrorMessage = dl.message;
                }

                totalDlWarmupBytes += dl.warmupBytes;
                totalDlMeasuredBytes += dl.measuredBytes;
            }

            if (runUl) {
                TransferResult ul = runUpload(cfg, perDirectionDurationSec, i);
                iterationObj.put("ul", ul.toJson());

                if (ul.ok && ul.mbps != null && ul.measuredBytes > 0L) {
                    ulSum += ul.mbps;
                    ulCount++;
                    hasRequestedMeasuredBytes = true;
                } else {
                    hasFailure = true;
                    if (firstErrorCode.isEmpty()) firstErrorCode = ul.errorCode;
                    if (firstErrorMessage.isEmpty()) firstErrorMessage = ul.message;
                }

                totalUlWarmupBytes += ul.warmupBytes;
                totalUlMeasuredBytes += ul.measuredBytes;
            }

            iterationObj.put("ended_at_ms", System.currentTimeMillis());
            iterationsArray.put(iterationObj);

            sendProgress("iteration_done", cfg, i, "FTP iteration " + i + " completed", iterationObj);

            if (i < cfg.iterations && cfg.waitSec > 0) {
                sleep(cfg.waitSec * 1000L);
            }
        }

        long sessionEndedMs = System.currentTimeMillis();

        boolean ok = hasRequestedMeasuredBytes && !allRequestedDirectionsZero(runDl, runUl, totalDlMeasuredBytes, totalUlMeasuredBytes);
        String status = ok ? "saved" : "error";
        String errorCode = ok ? "" : (firstErrorCode.isEmpty() ? "FTP_NO_MEASURED_BYTES" : firstErrorCode);
        String message = ok
                ? "FTP test completed."
                : (firstErrorMessage == null || firstErrorMessage.trim().isEmpty()
                    ? "FTP completed but no measured bytes were captured. Use a larger FTP file or a controlled FTP server."
                    : firstErrorMessage);

        JSObject result = new JSObject();
        result.put("ok", ok);
        result.put("status", status);
        result.put("source", "native-ftp-v1g2a");
        result.put("test_type", "ftp");
        result.put("session_id", cfg.sessionId);

        result.put("started_at_ms", sessionStartedMs);
        result.put("ended_at_ms", sessionEndedMs);
        result.put("elapsed_ms", sessionEndedMs - sessionStartedMs);

        result.put("host", cfg.host);
        result.put("port", cfg.port);
        result.put("username", cfg.username);
        result.put("direction", cfg.direction);

        result.put("duration_sec", cfg.durationSec);
        result.put("duration_per_direction_sec", perDirectionDurationSec);
        result.put("warmup_sec", cfg.warmupSec);
        result.put("interval_sec", cfg.intervalSec);
        result.put("wait_sec", cfg.waitSec);
        result.put("iterations_requested", cfg.iterations);
        result.put("iterations_completed", cfg.iterations);

        result.put("avg_dl_mbps", round3(dlCount == 0 ? null : dlSum / dlCount));
        result.put("avg_ul_mbps", round3(ulCount == 0 ? null : ulSum / ulCount));

        result.put("dl_warmup_bytes", totalDlWarmupBytes);
        result.put("dl_measured_bytes", totalDlMeasuredBytes);
        result.put("ul_warmup_bytes", totalUlWarmupBytes);
        result.put("ul_measured_bytes", totalUlMeasuredBytes);

        result.put("error_code", errorCode);
        result.put("message", message);
        result.put("iterations", iterationsArray);

        return result;
    }

    private boolean allRequestedDirectionsZero(boolean runDl, boolean runUl, long dlMeasuredBytes, long ulMeasuredBytes) {
        if (runDl && dlMeasuredBytes <= 0L) return true;
        if (runUl && ulMeasuredBytes <= 0L) return true;
        return false;
    }

    private TransferResult runDownload(FtpConfig cfg, int measuredDurationSec) {
        FTPClient client = null;
        TransferResult tr = new TransferResult();
        tr.direction = "DL";

        long measuredStartedMs = 0L;
        long measuredLastMs = 0L;

        try {
            client = connect(cfg);

            // Important Step 1G2A fix:
            // FTP connect/login time does NOT count toward warmup or test duration.
            long transferStartMs = System.currentTimeMillis();
            long warmupEndMs = transferStartMs + cfg.warmupSec * 1000L;
            long measuredEndMs = warmupEndMs + measuredDurationSec * 1000L;

            byte[] buffer = new byte[64 * 1024];

            while (System.currentTimeMillis() < measuredEndMs) {
                InputStream in = client.retrieveFileStream(cfg.dlPath);

                if (in == null) {
                    throw new IOException("Could not open FTP download path: " + cfg.dlPath + ". Reply: " + client.getReplyString());
                }

                int read;
                while ((read = in.read(buffer)) != -1) {
                    long now = System.currentTimeMillis();

                    if (now >= measuredEndMs) {
                        break;
                    }

                    if (now < warmupEndMs) {
                        tr.warmupBytes += read;
                    } else {
                        if (measuredStartedMs == 0L) {
                            measuredStartedMs = now;
                        }
                        tr.measuredBytes += read;
                        measuredLastMs = now;
                    }
                }

                try {
                    in.close();
                } catch (Exception ignored) {
                }

                boolean completed = client.completePendingCommand();
                if (!completed) {
                    throw new IOException("FTP download command did not complete. Reply: " + client.getReplyString());
                }
            }

            tr.durationMs = measuredDuration(measuredStartedMs, measuredLastMs, measuredDurationSec);
            tr.mbps = mbps(tr.measuredBytes, tr.durationMs);

            if (tr.measuredBytes <= 0L) {
                tr.ok = false;
                tr.errorCode = "FTP_DL_NO_MEASURED_BYTES";
                tr.message = "FTP DL completed but measured bytes are 0. Use a larger FTP file or set warmup to 0 for smoke test.";
            } else {
                tr.ok = true;
                tr.errorCode = "";
                tr.message = "FTP DL complete";
            }

        } catch (IOException ex) {
            tr.ok = false;
            tr.errorCode = downloadErrorCode(ex.getMessage());
            tr.message = ex.getMessage();
            tr.durationMs = measuredDuration(measuredStartedMs, measuredLastMs, measuredDurationSec);
            tr.mbps = mbps(tr.measuredBytes, tr.durationMs);
        } catch (Exception ex) {
            tr.ok = false;
            tr.errorCode = "FTP_UNKNOWN_ERROR";
            tr.message = ex.getMessage();
            tr.durationMs = measuredDuration(measuredStartedMs, measuredLastMs, measuredDurationSec);
            tr.mbps = mbps(tr.measuredBytes, tr.durationMs);
        } finally {
            disconnect(client);
        }

        return tr;
    }

    private TransferResult runUpload(FtpConfig cfg, int measuredDurationSec, int iteration) {
        FTPClient client = null;
        TransferResult tr = new TransferResult();
        tr.direction = "UL";

        try {
            client = connect(cfg);

            // Important Step 1G2A fix:
            // FTP connect/login time does NOT count toward warmup or test duration.
            long transferStartMs = System.currentTimeMillis();
            long warmupEndMs = transferStartMs + cfg.warmupSec * 1000L;
            long measuredEndMs = warmupEndMs + measuredDurationSec * 1000L;

            String remoteFolder = cfg.ulFolder == null || cfg.ulFolder.trim().isEmpty()
                    ? "/"
                    : cfg.ulFolder.trim();

            if (!remoteFolder.endsWith("/")) {
                remoteFolder = remoteFolder + "/";
            }

            String remoteFile = remoteFolder
                    + "babydragon_ftp_"
                    + safeFileName(cfg.sessionId)
                    + "_it"
                    + iteration
                    + "_"
                    + System.currentTimeMillis()
                    + ".bin";

            TimedUploadInputStream uploadStream = new TimedUploadInputStream(
                    warmupEndMs,
                    measuredEndMs
            );

            boolean stored = client.storeFile(remoteFile, uploadStream);

            tr.warmupBytes = uploadStream.getWarmupBytes();
            tr.measuredBytes = uploadStream.getMeasuredBytes();
            tr.durationMs = uploadStream.getMeasuredDurationMs();
            tr.mbps = mbps(tr.measuredBytes, tr.durationMs);

            if (!stored) {
                tr.ok = false;
                tr.errorCode = "FTP_UPLOAD_REJECTED";
                tr.message = "FTP upload failed. Server reply: " + client.getReplyString();
            } else if (tr.measuredBytes <= 0L) {
                tr.ok = false;
                tr.errorCode = "FTP_UL_NO_MEASURED_BYTES";
                tr.message = "FTP UL completed but measured bytes are 0. Check upload permission or set warmup to 0 for smoke test.";
            } else {
                tr.ok = true;
                tr.errorCode = "";
                tr.message = "FTP UL complete";

                try {
                    client.deleteFile(remoteFile);
                } catch (Exception ignored) {
                    // Some public FTP servers do not allow delete. Do not fail the test after upload success.
                }
            }

        } catch (IOException ex) {
            tr.ok = false;
            tr.errorCode = uploadErrorCode(ex.getMessage());
            tr.message = ex.getMessage();
        } catch (Exception ex) {
            tr.ok = false;
            tr.errorCode = "FTP_UNKNOWN_ERROR";
            tr.message = ex.getMessage();
        } finally {
            disconnect(client);
        }

        return tr;
    }

    private FTPClient connect(FtpConfig cfg) throws Exception {
        FTPClient client = cfg.secure ? new FTPSClient(false) : new FTPClient();

        client.setConnectTimeout(15000);
        client.setDataTimeout(30000);
        client.setDefaultTimeout(30000);

        try {
            client.connect(cfg.host, cfg.port);
        } catch (Exception ex) {
            throw new IOException("FTP connect failed to " + cfg.host + ":" + cfg.port + ". " + ex.getMessage());
        }

        int reply = client.getReplyCode();
        if (!FTPReply.isPositiveCompletion(reply)) {
            throw new IOException("FTP refused connection. Reply: " + reply);
        }

        boolean loginOk = client.login(cfg.username, cfg.password);
        if (!loginOk) {
            throw new IOException("FTP login failed for user: " + cfg.username + ". Reply: " + client.getReplyString());
        }

        if (client instanceof FTPSClient) {
            FTPSClient ftps = (FTPSClient) client;
            ftps.execPBSZ(0);
            ftps.execPROT("P");
        }

        client.setFileType(FTP.BINARY_FILE_TYPE);

        if (cfg.passive) {
            client.enterLocalPassiveMode();
        } else {
            client.enterLocalActiveMode();
        }

        return client;
    }

    private void disconnect(FTPClient client) {
        if (client == null) {
            return;
        }

        try {
            if (client.isConnected()) {
                try {
                    client.logout();
                } catch (Exception ignored) {
                }
                client.disconnect();
            }
        } catch (Exception ignored) {
        }
    }

    private void sendProgress(String status, FtpConfig cfg, int iteration, String message, JSObject iterationObj) {
        JSObject o = new JSObject();
        o.put("ok", true);
        o.put("source", "native-ftp-v1g2a");
        o.put("test_type", "ftp");
        o.put("status", status);
        o.put("message", message);
        o.put("session_id", cfg.sessionId);
        o.put("iteration", iteration);
        o.put("iterations_requested", cfg.iterations);

        if (iterationObj != null) {
            o.put("iteration_result", iterationObj);
        }

        notifyListeners("ftpProgress", o);
    }

    private static String downloadErrorCode(String message) {
        String m = message == null ? "" : message.toLowerCase(Locale.US);
        if (m.contains("connect")) return "FTP_CONNECT_FAILED";
        if (m.contains("login")) return "FTP_LOGIN_FAILED";
        if (m.contains("not found") || m.contains("open ftp download path")) return "FTP_DOWNLOAD_FILE_NOT_FOUND";
        if (m.contains("timeout")) return "FTP_TIMEOUT";
        return "FTP_DOWNLOAD_FAILED";
    }

    private static String uploadErrorCode(String message) {
        String m = message == null ? "" : message.toLowerCase(Locale.US);
        if (m.contains("connect")) return "FTP_CONNECT_FAILED";
        if (m.contains("login")) return "FTP_LOGIN_FAILED";
        if (m.contains("permission") || m.contains("denied") || m.contains("upload")) return "FTP_UPLOAD_REJECTED";
        if (m.contains("timeout")) return "FTP_TIMEOUT";
        return "FTP_UPLOAD_FAILED";
    }

    private static long measuredDuration(long startedMs, long lastMs, int fallbackSec) {
        if (startedMs > 0L && lastMs > startedMs) {
            return Math.max(1L, lastMs - startedMs);
        }

        return Math.max(1L, fallbackSec * 1000L);
    }

    private static Double mbps(long bytes, long durationMs) {
        if (bytes <= 0L || durationMs <= 0L) {
            return null;
        }

        double seconds = durationMs / 1000.0;
        return round3((bytes * 8.0) / seconds / 1000000.0);
    }

    private static Double round3(Double value) {
        if (value == null) {
            return null;
        }

        return Math.round(value * 1000.0) / 1000.0;
    }

    private static String safeFileName(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "ftp";
        }

        return raw.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private static class FtpConfig {
        String sessionId;
        String host;
        int port;
        String username;
        String password;
        String direction;
        int durationSec;
        int warmupSec;
        int intervalSec;
        int waitSec;
        int iterations;
        String dlPath;
        String ulFolder;
        boolean passive;
        boolean secure;

        static FtpConfig from(PluginCall call) {
            FtpConfig cfg = new FtpConfig();

            cfg.sessionId = getString(call, "sessionId", "bd-ftp-" + System.currentTimeMillis());
            cfg.host = getString(call, "host", "");
            cfg.port = getInt(call, "port", 21);
            cfg.username = getString(call, "username", "anonymous");
            cfg.password = getString(call, "password", "");
            cfg.direction = normalizeDirection(getString(call, "direction", "DL"));
            cfg.durationSec = clamp(getInt(call, "durationSec", 10), 1, 3600);
            cfg.warmupSec = clamp(getInt(call, "warmupSec", 3), 0, 300);
            cfg.intervalSec = clamp(getInt(call, "intervalSec", 1), 1, 60);
            cfg.waitSec = clamp(getInt(call, "waitSec", 5), 0, 600);
            cfg.iterations = clamp(getInt(call, "iterations", 1), 1, 999999);
            cfg.dlPath = getString(call, "dlPath", "/readme.txt");
            cfg.ulFolder = getString(call, "ulFolder", "/");
            cfg.passive = getBool(call, "passive", true);
            cfg.secure = getBool(call, "secure", false);

            if (cfg.host.trim().isEmpty()) {
                throw new IllegalArgumentException("FTP host is required");
            }

            return cfg;
        }

        static String normalizeDirection(String raw) {
            String d = raw == null ? "DL" : raw.trim().toUpperCase(Locale.US);

            if (d.contains("DL") && d.contains("UL")) {
                return "DL_UL";
            }

            if (d.contains("UPLOAD") || d.equals("UL") || d.contains("UL ONLY")) {
                return "UL";
            }

            return "DL";
        }

        static String getString(PluginCall call, String key, String def) {
            String v = call.getString(key);
            if (v == null || v.trim().isEmpty()) {
                return def;
            }

            return v.trim();
        }

        static int getInt(PluginCall call, String key, int def) {
            Integer v = call.getInt(key);
            return v == null ? def : v;
        }

        static boolean getBool(PluginCall call, String key, boolean def) {
            Boolean v = call.getBoolean(key);
            return v == null ? def : v;
        }

        static int clamp(int v, int min, int max) {
            return Math.max(min, Math.min(max, v));
        }
    }

    private static class TransferResult {
        boolean ok;
        String direction;
        String message;
        String errorCode = "";
        long warmupBytes;
        long measuredBytes;
        long durationMs;
        Double mbps;

        JSObject toJson() {
            JSObject o = new JSObject();
            o.put("ok", ok);
            o.put("direction", direction);
            o.put("message", message);
            o.put("error_code", errorCode);
            o.put("warmup_bytes", warmupBytes);
            o.put("measured_bytes", measuredBytes);
            o.put("measured_duration_ms", durationMs);
            o.put("mbps", round3(mbps));

            return o;
        }
    }

    private static class TimedUploadInputStream extends InputStream {
        private final long warmupEndMs;
        private final long measuredEndMs;
        private final byte[] block;

        private long warmupBytes = 0L;
        private long measuredBytes = 0L;
        private long measuredStartedMs = 0L;
        private long measuredLastMs = 0L;

        TimedUploadInputStream(long warmupEndMs, long measuredEndMs) {
            this.warmupEndMs = warmupEndMs;
            this.measuredEndMs = measuredEndMs;
            this.block = new byte[64 * 1024];

            for (int i = 0; i < block.length; i++) {
                block[i] = (byte) (i % 251);
            }
        }

        @Override
        public int read() {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);

            if (n <= 0) {
                return -1;
            }

            return one[0] & 0xff;
        }

        @Override
        public int read(byte[] b, int off, int len) {
            long now = System.currentTimeMillis();

            if (now >= measuredEndMs) {
                return -1;
            }

            int n = Math.min(len, block.length);
            System.arraycopy(block, 0, b, off, n);

            if (now < warmupEndMs) {
                warmupBytes += n;
            } else {
                if (measuredStartedMs == 0L) {
                    measuredStartedMs = now;
                }

                measuredBytes += n;
                measuredLastMs = now;
            }

            return n;
        }

        long getWarmupBytes() {
            return warmupBytes;
        }

        long getMeasuredBytes() {
            return measuredBytes;
        }

        long getMeasuredDurationMs() {
            if (measuredStartedMs > 0L && measuredLastMs > measuredStartedMs) {
                return Math.max(1L, measuredLastMs - measuredStartedMs);
            }

            return Math.max(1L, measuredEndMs - warmupEndMs);
        }
    }
}
