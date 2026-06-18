package com.mobbitechglobal.babydragon;

import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "BabyDragonIperf")
public class BabyDragonIperfPlugin extends Plugin {
    private static final String SOURCE = "native-iperf3-v1g4a";
    private static final String ASSET_ROOT = "iperf3";
    private static final String BINARY_NAME = "iperf3";

    @PluginMethod
    public void getIperfStatus(PluginCall call) {
        JSObject result = buildStatus();
        call.resolve(result);
    }

    @PluginMethod
    public void prepareIperfBinary(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", SOURCE);

        try {
            String abi = selectedAbi();
            String assetPath = assetPathForAbi(abi);
            File output = internalBinaryFile(abi);

            boolean copied = copyAssetToFile(assetPath, output);
            boolean executable = output.setExecutable(true, false);
            output.setReadable(true, false);

            result.put("ok", copied && output.exists() && output.length() > 0 && executable);
            result.put("status", result.getBool("ok") ? "binary_ready" : "binary_not_executable");
            result.put("abi", abi);
            result.put("assetPath", assetPath);
            result.put("internalPath", output.getAbsolutePath());
            result.put("bytes", output.exists() ? output.length() : 0);
            result.put("executable", output.canExecute());
            result.put("message", result.getBool("ok")
                    ? "iPerf3 binary copied and marked executable."
                    : "iPerf3 binary copied, but Android did not mark it executable.");
        } catch (Exception ex) {
            result.put("ok", false);
            result.put("status", "binary_missing_or_copy_failed");
            result.put("abi", selectedAbi());
            result.put("assetPath", assetPathForAbi(selectedAbi()));
            result.put("message", ex.getMessage() == null ? "Unable to prepare iPerf3 binary." : ex.getMessage());
        }

        call.resolve(result);
    }

    @PluginMethod
    public void runIperf3(PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("source", SOURCE);
                result.put("test_type", "iperf3");

                try {
                    IperfConfig cfg = IperfConfig.from(call);
                    JSObject prep = prepareBinaryInternal();
                    if (!prep.optBoolean("ok", false)) {
                        result.put("status", "binary_not_ready");
                        result.put("message", prep.optString("message", "iPerf3 binary is not ready."));
                        result.put("binary", prep);
                        call.resolve(result);
                        return;
                    }

                    String binaryPath = prep.optString("internalPath");
                    List<String> command = buildCommand(binaryPath, cfg);
                    JSArray commandJson = new JSArray();
                    for (String item : command) commandJson.put(item);

                    notifyProgress("starting", cfg, "Starting iPerf3 client.", commandJson);

                    ProcessBuilder builder = new ProcessBuilder(command);
                    builder.redirectErrorStream(false);
                    long startedMs = System.currentTimeMillis();
                    Process process = builder.start();

                    StreamCollector stdout = new StreamCollector(process.getInputStream());
                    StreamCollector stderr = new StreamCollector(process.getErrorStream());
                    Thread stdoutThread = new Thread(stdout);
                    Thread stderrThread = new Thread(stderr);
                    stdoutThread.start();
                    stderrThread.start();

                    boolean finished = process.waitFor(cfg.timeoutSeconds, TimeUnit.SECONDS);
                    if (!finished) {
                        process.destroy();
                        try { process.destroyForcibly(); } catch (Exception ignored) {}
                        result.put("ok", false);
                        result.put("status", "timeout");
                        result.put("error_code", "IPERF_TIMEOUT");
                        result.put("message", "iPerf3 test timed out.");
                    }

                    stdoutThread.join(1000);
                    stderrThread.join(1000);

                    int exitCode = finished ? process.exitValue() : -1;
                    long endedMs = System.currentTimeMillis();
                    String stdoutText = stdout.getText();
                    String stderrText = stderr.getText();

                    result.put("source", SOURCE);
                    result.put("test_type", "iperf3");
                    result.put("ok", finished && exitCode == 0);
                    result.put("status", finished && exitCode == 0 ? "complete" : result.optString("status", "error"));
                    result.put("error_code", finished && exitCode == 0 ? "" : result.optString("error_code", "IPERF_EXIT_" + exitCode));
                    result.put("message", finished && exitCode == 0 ? "iPerf3 test completed." : safeErrorMessage(stderrText, exitCode));
                    result.put("started_at_ms", startedMs);
                    result.put("ended_at_ms", endedMs);
                    result.put("elapsed_ms", endedMs - startedMs);
                    result.put("exit_code", exitCode);
                    result.put("command", commandJson);
                    result.put("stdout", stdoutText);
                    result.put("stderr", stderrText);
                    result.put("binary", prep);

                    JSObject config = new JSObject();
                    config.put("server", cfg.server);
                    config.put("port", cfg.port);
                    config.put("protocol", cfg.protocol);
                    config.put("direction", cfg.direction);
                    config.put("duration_sec", cfg.durationSeconds);
                    config.put("interval_sec", cfg.intervalSeconds);
                    config.put("streams", cfg.streams);
                    config.put("reverse_mode", cfg.reverseMode);
                    config.put("udp_bitrate_mbps", cfg.udpBitrateMbps);
                    result.put("config", config);

                    parseIperfJson(stdoutText, result);

                    notifyProgress(result.optString("status", "complete"), cfg, result.optString("message", "iPerf3 finished."), commandJson);
                } catch (Exception ex) {
                    result.put("ok", false);
                    result.put("status", "exception");
                    result.put("error_code", "IPERF_EXCEPTION");
                    result.put("message", ex.getMessage() == null ? "iPerf3 run failed." : ex.getMessage());
                    notifyListeners("iperfProgress", result);
                }

                call.resolve(result);
            }
        }).start();
    }

    private JSObject buildStatus() {
        JSObject result = new JSObject();
        result.put("source", SOURCE);
        result.put("ok", false);

        String abi = selectedAbi();
        String assetPath = assetPathForAbi(abi);
        File output = internalBinaryFile(abi);

        result.put("abi", abi);
        result.put("supportedAbis", new JSArray(Arrays.asList(Build.SUPPORTED_ABIS)));
        result.put("assetPath", assetPath);
        result.put("internalPath", output.getAbsolutePath());
        result.put("internalExists", output.exists());
        result.put("internalBytes", output.exists() ? output.length() : 0);
        result.put("internalExecutable", output.exists() && output.canExecute());

        try {
            InputStream stream = getContext().getAssets().open(assetPath);
            int first = stream.read();
            stream.close();
            result.put("assetExists", true);
            result.put("assetReadable", first >= 0);
        } catch (Exception ex) {
            result.put("assetExists", false);
            result.put("assetReadable", false);
        }

        boolean ready = output.exists() && output.length() > 0 && output.canExecute();
        result.put("ok", ready);
        result.put("status", ready ? "binary_ready" : "binary_missing");
        result.put("message", ready
                ? "iPerf3 binary is ready."
                : "iPerf3 binary is not installed yet. Place ABI binary in assets and run Prepare.");

        return result;
    }

    private JSObject prepareBinaryInternal() {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", SOURCE);

        try {
            String abi = selectedAbi();
            String assetPath = assetPathForAbi(abi);
            File output = internalBinaryFile(abi);

            boolean copied = copyAssetToFile(assetPath, output);
            boolean executable = output.setExecutable(true, false);
            output.setReadable(true, false);

            result.put("ok", copied && output.exists() && output.length() > 0 && executable);
            result.put("status", result.optBoolean("ok", false) ? "binary_ready" : "binary_not_executable");
            result.put("abi", abi);
            result.put("assetPath", assetPath);
            result.put("internalPath", output.getAbsolutePath());
            result.put("bytes", output.exists() ? output.length() : 0);
            result.put("executable", output.canExecute());
            result.put("message", result.optBoolean("ok", false)
                    ? "iPerf3 binary ready."
                    : "iPerf3 binary was copied but is not executable.");
        } catch (Exception ex) {
            result.put("ok", false);
            result.put("status", "binary_missing_or_copy_failed");
            result.put("abi", selectedAbi());
            result.put("assetPath", assetPathForAbi(selectedAbi()));
            result.put("message", ex.getMessage() == null ? "Unable to prepare iPerf3 binary." : ex.getMessage());
        }

        return result;
    }

    private boolean copyAssetToFile(String assetPath, File output) throws Exception {
        InputStream input = null;
        FileOutputStream fileOutput = null;

        try {
            input = getContext().getAssets().open(assetPath);
            File parent = output.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }

            fileOutput = new FileOutputStream(output, false);
            byte[] buffer = new byte[64 * 1024];
            int read;
            long copied = 0L;

            while ((read = input.read(buffer)) != -1) {
                fileOutput.write(buffer, 0, read);
                copied += read;
            }

            fileOutput.flush();
            return copied > 0L;
        } finally {
            if (fileOutput != null) {
                try { fileOutput.close(); } catch (Exception ignored) {}
            }
            if (input != null) {
                try { input.close(); } catch (Exception ignored) {}
            }
        }
    }

    private List<String> buildCommand(String binaryPath, IperfConfig cfg) {
        List<String> command = new ArrayList<>();
        command.add(binaryPath);
        command.add("-c");
        command.add(cfg.server);
        command.add("-p");
        command.add(String.valueOf(cfg.port));
        command.add("-t");
        command.add(String.valueOf(cfg.durationSeconds));
        command.add("-i");
        command.add(String.valueOf(cfg.intervalSeconds));
        command.add("-J");

        if (cfg.streams > 1) {
            command.add("-P");
            command.add(String.valueOf(cfg.streams));
        }

        if ("UDP".equalsIgnoreCase(cfg.protocol)) {
            command.add("-u");
            command.add("-b");
            command.add(cfg.udpBitrateMbps + "M");
        }

        boolean downlink = "dl".equalsIgnoreCase(cfg.direction) || "download".equalsIgnoreCase(cfg.direction);
        if (downlink || cfg.reverseMode) {
            command.add("-R");
        }

        return command;
    }

    private void parseIperfJson(String stdout, JSObject result) {
        if (stdout == null || stdout.trim().isEmpty()) return;

        try {
            JSONObject json = new JSONObject(stdout);
            result.put("raw_json", json);

            JSONObject end = json.optJSONObject("end");
            if (end == null) return;

            JSObject summary = new JSObject();

            JSONObject sumSent = end.optJSONObject("sum_sent");
            JSONObject sumReceived = end.optJSONObject("sum_received");
            JSONObject sum = end.optJSONObject("sum");
            JSONObject sumBidirReverse = end.optJSONObject("sum_bidir_reverse");
            JSONObject sumBidir = end.optJSONObject("sum_bidir");

            if (sumReceived != null) {
                summary.put("received_mbps", bitsPerSecondToMbps(sumReceived.optDouble("bits_per_second", 0.0)));
                summary.put("received_bytes", sumReceived.optLong("bytes", 0L));
            }

            if (sumSent != null) {
                summary.put("sent_mbps", bitsPerSecondToMbps(sumSent.optDouble("bits_per_second", 0.0)));
                summary.put("sent_bytes", sumSent.optLong("bytes", 0L));
            }

            if (sum != null) {
                summary.put("udp_mbps", bitsPerSecondToMbps(sum.optDouble("bits_per_second", 0.0)));
                summary.put("udp_bytes", sum.optLong("bytes", 0L));
                summary.put("udp_jitter_ms", sum.optDouble("jitter_ms", 0.0));
                summary.put("udp_lost_packets", sum.optLong("lost_packets", 0L));
                summary.put("udp_packets", sum.optLong("packets", 0L));
            }

            if (sumBidirReverse != null) {
                summary.put("bidir_reverse_mbps", bitsPerSecondToMbps(sumBidirReverse.optDouble("bits_per_second", 0.0)));
            }

            if (sumBidir != null) {
                summary.put("bidir_mbps", bitsPerSecondToMbps(sumBidir.optDouble("bits_per_second", 0.0)));
            }

            result.put("summary", summary);
        } catch (Exception ex) {
            result.put("json_parse_warning", ex.getMessage());
        }
    }

    private double bitsPerSecondToMbps(double bps) {
        if (Double.isNaN(bps) || Double.isInfinite(bps) || bps <= 0.0) return 0.0;
        return Math.round((bps / 1000000.0) * 1000.0) / 1000.0;
    }

    private String safeErrorMessage(String stderr, int exitCode) {
        if (stderr != null && !stderr.trim().isEmpty()) {
            return stderr.trim();
        }

        return "iPerf3 exited with code " + exitCode + ".";
    }

    private void notifyProgress(String status, IperfConfig cfg, String message, JSArray command) {
        JSObject event = new JSObject();
        event.put("ok", true);
        event.put("source", SOURCE);
        event.put("test_type", "iperf3");
        event.put("status", status);
        event.put("message", message);
        event.put("server", cfg.server);
        event.put("port", cfg.port);
        event.put("protocol", cfg.protocol);
        event.put("direction", cfg.direction);
        if (command != null) event.put("command", command);
        notifyListeners("iperfProgress", event);
    }

    private File internalBinaryFile(String abi) {
        File dir = new File(getContext().getFilesDir(), "babydragon/iperf3/" + abi);
        return new File(dir, BINARY_NAME);
    }

    private String assetPathForAbi(String abi) {
        return ASSET_ROOT + "/" + abi + "/" + BINARY_NAME;
    }

    private String selectedAbi() {
        String[] supported = Build.SUPPORTED_ABIS;

        if (supported != null) {
            for (String abi : supported) {
                if ("arm64-v8a".equals(abi)) return "arm64-v8a";
                if ("armeabi-v7a".equals(abi)) return "armeabi-v7a";
                if ("x86_64".equals(abi)) return "x86_64";
                if ("x86".equals(abi)) return "x86";
            }
        }

        return "arm64-v8a";
    }

    private static class StreamCollector implements Runnable {
        private final InputStream stream;
        private final StringBuilder builder = new StringBuilder();

        StreamCollector(InputStream stream) {
            this.stream = stream;
        }

        @Override
        public void run() {
            BufferedReader reader = null;
            try {
                reader = new BufferedReader(new InputStreamReader(stream));
                String line;
                while ((line = reader.readLine()) != null) {
                    builder.append(line).append("\n");
                }
            } catch (Exception ignored) {
            } finally {
                if (reader != null) {
                    try { reader.close(); } catch (Exception ignored) {}
                }
            }
        }

        String getText() {
            return builder.toString();
        }
    }

    private static class IperfConfig {
        String server;
        int port;
        String protocol;
        String direction;
        int durationSeconds;
        int intervalSeconds;
        int streams;
        boolean reverseMode;
        int udpBitrateMbps;
        int timeoutSeconds;

        static IperfConfig from(PluginCall call) {
            IperfConfig cfg = new IperfConfig();
            cfg.server = getString(call, "server", "");
            cfg.port = clamp(getInt(call, "port", 5201), 1, 65535);
            cfg.protocol = getString(call, "protocol", "TCP").toUpperCase(Locale.US);
            cfg.direction = normalizeDirection(getString(call, "direction", "dl"));
            cfg.durationSeconds = clamp(getInt(call, "durationSeconds", 10), 1, 3600);
            cfg.intervalSeconds = clamp(getInt(call, "intervalSeconds", 1), 1, 60);
            cfg.streams = clamp(getInt(call, "streams", 1), 1, 128);
            cfg.reverseMode = getBool(call, "reverseMode", false);
            cfg.udpBitrateMbps = clamp(getInt(call, "udpBitrateMbps", 10), 1, 100000);
            cfg.timeoutSeconds = cfg.durationSeconds + 25;

            if (cfg.server.trim().isEmpty()) {
                throw new IllegalArgumentException("iPerf3 server is required.");
            }

            return cfg;
        }

        static String normalizeDirection(String raw) {
            String d = raw == null ? "dl" : raw.trim().toLowerCase(Locale.US);
            if (d.contains("ul") || d.contains("upload")) return "ul";
            if (d.contains("dl") || d.contains("download")) return "dl";
            return d;
        }

        static String getString(PluginCall call, String key, String def) {
            String value = call.getString(key);
            if (value == null || value.trim().isEmpty()) return def;
            return value.trim();
        }

        static int getInt(PluginCall call, String key, int def) {
            Integer value = call.getInt(key);
            return value == null ? def : value;
        }

        static boolean getBool(PluginCall call, String key, boolean def) {
            Boolean value = call.getBoolean(key);
            return value == null ? def : value;
        }

        static int clamp(int value, int min, int max) {
            return Math.max(min, Math.min(max, value));
        }
    }
}
