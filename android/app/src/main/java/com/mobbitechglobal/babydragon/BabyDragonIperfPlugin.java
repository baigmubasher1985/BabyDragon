package com.mobbitechglobal.babydragon;

import android.os.Build;
import android.system.ErrnoException;
import android.system.Os;

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
    private static final String SOURCE = "native-iperf3-v1g4b";
    private static final String ASSET_ROOT = "iperf3";
    private static final String BINARY_NAME = "iperf3";
    private static final int CHMOD_MODE_755 = 0755;
    private static volatile Process activeProcess;
    private static volatile boolean preferLinkerExecution = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;

    @PluginMethod
    public void getIperfStatus(PluginCall call) {
        JSObject result = buildStatus();
        call.resolve(result);
    }

    @PluginMethod
    public void prepareIperfBinary(PluginCall call) {
        JSObject result = ensureBinaryReady(true);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelIperf3(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("source", SOURCE);

        Process process = activeProcess;
        if (process != null) {
            try {
                process.destroy();
            } catch (Exception ignored) {}
            try {
                process.destroyForcibly();
            } catch (Exception ignored) {}
            activeProcess = null;
            result.put("message", "iPerf3 process cancelled.");
        } else {
            result.put("message", "No active iPerf3 process.");
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
                    applyBinaryPermissions(internalBinaryFile(selectedAbi()));
                    List<String> command = buildExecutionCommand(binaryPath, cfg);
                    JSArray commandJson = new JSArray();
                    for (String item : command) commandJson.put(item);

                    notifyProgress("starting", cfg, "Starting iPerf3 client.", commandJson);

                    ProcessBuilder builder = new ProcessBuilder(command);
                    builder.redirectErrorStream(false);
                    long startedMs = System.currentTimeMillis();
                    Process process = builder.start();
                    activeProcess = process;

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
                    activeProcess = null;

                    result.put("source", SOURCE);
                    result.put("test_type", "iperf3");
                    result.put("ok", finished && exitCode == 0);
                    result.put("status", finished && exitCode == 0 ? "complete" : result.optString("status", "error"));
                    result.put("error_code", finished && exitCode == 0 ? "" : result.optString("error_code", "IPERF_EXIT_" + exitCode));
                    result.put("message", finished && exitCode == 0
                        ? "iPerf3 test completed."
                        : safeErrorMessage(stderrText, stdoutText, exitCode));
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
                    config.put("bidir_mode", cfg.bidirMode);
                    config.put("udp_bitrate_mbps", cfg.udpBitrateMbps);
                    result.put("config", config);

                    parseIperfJson(stdoutText, result);

                    notifyProgress(result.optString("status", "complete"), cfg, result.optString("message", "iPerf3 finished."), commandJson);
                } catch (Exception ex) {
                    activeProcess = null;
                    result.put("ok", false);
                    result.put("status", "exception");
                    result.put("error_code", "IPERF_EXCEPTION");
                    String message = ex.getMessage() == null ? "iPerf3 run failed." : ex.getMessage();
                    if (message.toLowerCase(Locale.US).contains("error=13")
                            || message.toLowerCase(Locale.US).contains("permission denied")) {
                        message = "iPerf3 binary permission denied (EACCES). Android "
                                + Build.VERSION.SDK_INT
                                + " may block direct execution from files dir. Re-run Prepare, then retry. "
                                + "If still blocked, package iPerf3 as libiperf3.so in jniLibs/<abi>/ with extractNativeLibs=true.";
                    }
                    result.put("message", message);
                    notifyListeners("iperfProgress", result);
                }

                call.resolve(result);
            }
        }).start();
    }

    private JSObject buildStatus() {
        return ensureBinaryReady(false);
    }

    private JSObject prepareBinaryInternal() {
        return ensureBinaryReady(true);
    }

    private JSObject ensureBinaryReady(boolean forceRecopy) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("source", SOURCE);
        result.put("apiLevel", Build.VERSION.SDK_INT);
        result.put("targetSdk", getContext().getApplicationInfo().targetSdkVersion);

        String abi = selectedAbi();
        String assetPath = assetPathForAbi(abi);
        File output = internalBinaryFile(abi);

        result.put("abi", abi);
        result.put("supportedAbis", new JSArray(Arrays.asList(Build.SUPPORTED_ABIS)));
        result.put("assetPath", assetPath);
        result.put("internalPath", output.getAbsolutePath());
        result.put("absolutePath", output.getAbsolutePath());
        result.put("exists", output.exists());
        result.put("length", output.exists() ? output.length() : 0);
        result.put("internalExists", output.exists());
        result.put("internalBytes", output.exists() ? output.length() : 0);

        try {
            InputStream stream = getContext().getAssets().open(assetPath);
            int first = stream.read();
            stream.close();
            result.put("assetExists", true);
            result.put("assetReadable", first >= 0);
            result.put("assetBytes", assetByteLength(assetPath));
        } catch (Exception ex) {
            result.put("assetExists", false);
            result.put("assetReadable", false);
            result.put("assetBytes", 0);
            result.put("status", "binary_missing_or_copy_failed");
            result.put("message", "iPerf3 asset binary is missing for ABI " + abi + ". Place it in assets and rebuild.");
            return result;
        }

        try {
            boolean copied = false;
            boolean stale = isBinaryStale(output, assetPath);
            if (forceRecopy || stale || !output.exists() || output.length() == 0) {
                copied = copyAssetToFile(assetPath, output);
                result.put("copiedFromAsset", copied);
                result.put("staleReplaced", stale);
            } else {
                result.put("copiedFromAsset", false);
                result.put("staleReplaced", false);
            }

            PermissionState permissions = applyBinaryPermissions(output);
            attachPermissionDetails(result, permissions);

            ExecutionProbe probe = probeBinaryExecution(output, abi);
            preferLinkerExecution = probe.preferLinker;
            result.put("canExecute", output.canExecute());
            result.put("internalExecutable", output.canExecute());
            result.put("executable", probe.ok);
            result.put("executionProbeOk", probe.ok);
            result.put("executionMode", probe.preferLinker ? "linker_wrapper" : "direct");
            result.put("linkerPath", probe.linkerPath);
            result.put("chmodApplied", permissions.chmodApplied);
            result.put("javaChmodApplied", permissions.javaChmodApplied);
            result.put("processChmodApplied", permissions.processChmodApplied);

            boolean ready = output.exists() && output.length() > 0 && probe.ok;
            result.put("ok", ready);
            result.put("bytes", output.length());
            result.put("status", ready ? "binary_ready" : "binary_not_executable");
            result.put("message", ready
                    ? (probe.preferLinker
                        ? "iPerf3 binary is ready. Android " + Build.VERSION.SDK_INT + " uses linker wrapper execution."
                        : "iPerf3 binary is ready.")
                    : buildNotReadyMessage(output, permissions, probe));
            return result;
        } catch (Exception ex) {
            result.put("ok", false);
            result.put("status", "binary_missing_or_copy_failed");
            result.put("message", ex.getMessage() == null ? "Unable to prepare iPerf3 binary." : ex.getMessage());
            return result;
        }
    }

    private String buildNotReadyMessage(File output, PermissionState permissions, ExecutionProbe probe) {
        if (!output.exists() || output.length() == 0) {
            return "iPerf3 binary file is missing or empty after copy.";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !probe.ok) {
            return "Android " + Build.VERSION.SDK_INT + " blocked executing iPerf3 from app files dir (error 13). "
                    + "Next narrow path: package iPerf3 as libiperf3.so under jniLibs/<abi>/ with extractNativeLibs=true, "
                    + "then execute from nativeLibraryDir. Probe: " + probe.message;
        }
        if (!permissions.chmodApplied) {
            return "iPerf3 binary permissions could not be set. " + probe.message;
        }
        return "iPerf3 binary is not executable. " + probe.message;
    }

    private void attachPermissionDetails(JSObject result, PermissionState permissions) {
        result.put("readable", permissions.readable);
        result.put("writable", permissions.writable);
        result.put("ownerExecutable", permissions.ownerExecutable);
        result.put("chmodMode", permissions.chmodMode);
    }

    private boolean isBinaryStale(File output, String assetPath) throws Exception {
        if (!output.exists() || output.length() == 0) return true;
        long assetLen = assetByteLength(assetPath);
        return assetLen > 0 && output.length() != assetLen;
    }

    private long assetByteLength(String assetPath) throws Exception {
        InputStream input = null;
        try {
            input = getContext().getAssets().open(assetPath);
            long total = 0L;
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
            }
            return total;
        } finally {
            if (input != null) {
                try { input.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static class PermissionState {
        boolean readable;
        boolean writable;
        boolean ownerExecutable;
        boolean chmodApplied;
        boolean javaChmodApplied;
        boolean processChmodApplied;
        int chmodMode;
    }

    private static class ExecutionProbe {
        boolean ok;
        boolean preferLinker;
        String linkerPath;
        String message;
    }

    private PermissionState applyBinaryPermissions(File output) {
        PermissionState state = new PermissionState();
        if (output == null || !output.exists()) return state;

        state.readable = output.setReadable(true, false);
        state.writable = output.setWritable(true, true);
        state.ownerExecutable = output.setExecutable(true, false);
        output.setExecutable(true, true);

        try {
            Os.chmod(output.getAbsolutePath(), CHMOD_MODE_755);
            state.javaChmodApplied = true;
            state.chmodApplied = true;
            state.chmodMode = CHMOD_MODE_755;
        } catch (ErrnoException ignored) {
            state.javaChmodApplied = false;
        }

        state.processChmodApplied = runProcessChmod755(output.getAbsolutePath());
        if (state.processChmodApplied) {
            state.chmodApplied = true;
            state.chmodMode = CHMOD_MODE_755;
        }

        state.readable = output.canRead();
        state.writable = output.canWrite();
        state.ownerExecutable = output.canExecute();
        return state;
    }

    private boolean runProcessChmod755(String absolutePath) {
        try {
            ProcessBuilder builder = new ProcessBuilder("chmod", "755", absolutePath);
            builder.redirectErrorStream(true);
            Process process = builder.start();
            boolean finished = process.waitFor(5, TimeUnit.SECONDS);
            if (!finished) {
                process.destroy();
                try { process.destroyForcibly(); } catch (Exception ignored) {}
                return false;
            }
            return process.exitValue() == 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    private ExecutionProbe probeBinaryExecution(File output, String abi) {
        ExecutionProbe probe = new ExecutionProbe();
        probe.linkerPath = linkerPathForAbi(abi);
        probe.preferLinker = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;

        if (output == null || !output.exists() || output.length() == 0) {
            probe.ok = false;
            probe.message = "Binary file missing.";
            return probe;
        }

        if (probe.preferLinker) {
            probe.ok = runProbeCommand(buildProbeCommand(probe.linkerPath, output.getAbsolutePath(), new String[]{"--version"}));
            if (!probe.ok) {
                probe.message = "Linker wrapper probe failed for " + probe.linkerPath + ".";
            } else {
                probe.message = "Linker wrapper probe ok.";
            }
            return probe;
        }

        probe.ok = runProbeCommand(buildProbeCommand(null, output.getAbsolutePath(), new String[]{"--version"}));
        if (!probe.ok) {
            probe.preferLinker = true;
            probe.ok = runProbeCommand(buildProbeCommand(probe.linkerPath, output.getAbsolutePath(), new String[]{"--version"}));
            probe.message = probe.ok ? "Direct probe failed; linker wrapper probe ok." : "Direct and linker probes failed.";
        } else {
            probe.preferLinker = false;
            probe.message = "Direct probe ok.";
        }
        return probe;
    }

    private List<String> buildProbeCommand(String linkerPath, String binaryPath, String[] args) {
        List<String> command = new ArrayList<>();
        if (linkerPath != null && !linkerPath.trim().isEmpty()) {
            command.add(linkerPath);
        }
        command.add(binaryPath);
        if (args != null) {
            command.addAll(Arrays.asList(args));
        }
        return command;
    }

    private boolean runProbeCommand(List<String> command) {
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            process = builder.start();
            boolean finished = process.waitFor(4, TimeUnit.SECONDS);
            if (!finished) {
                process.destroy();
                try { process.destroyForcibly(); } catch (Exception ignored) {}
                return false;
            }
            return process.exitValue() == 0 || process.exitValue() == 1;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (process != null) {
                try { process.destroy(); } catch (Exception ignored) {}
            }
        }
    }

    private String linkerPathForAbi(String abi) {
        boolean is64 = "arm64-v8a".equals(abi) || "x86_64".equals(abi);
        if (is64) {
            File apexLinker = new File("/apex/com.android.runtime/bin/linker64");
            if (apexLinker.exists()) return apexLinker.getAbsolutePath();
            return "/system/bin/linker64";
        }
        File apexLinker = new File("/apex/com.android.runtime/bin/linker");
        if (apexLinker.exists()) return apexLinker.getAbsolutePath();
        return "/system/bin/linker";
    }

    private List<String> buildExecutionCommand(String binaryPath, IperfConfig cfg) {
        List<String> iperfArgs = buildIperfArgs(cfg);
        List<String> command = new ArrayList<>();
        if (preferLinkerExecution || Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            command.add(linkerPathForAbi(selectedAbi()));
            command.add(binaryPath);
            command.addAll(iperfArgs);
            return command;
        }
        command.add(binaryPath);
        command.addAll(iperfArgs);
        return command;
    }

    private List<String> buildIperfArgs(IperfConfig cfg) {
        List<String> args = new ArrayList<>();
        args.add("-c");
        args.add(cfg.server);
        args.add("-p");
        args.add(String.valueOf(cfg.port));
        args.add("-t");
        args.add(String.valueOf(cfg.durationSeconds));
        args.add("-i");
        args.add(String.valueOf(cfg.intervalSeconds));
        args.add("-J");

        if (cfg.streams > 1) {
            args.add("-P");
            args.add(String.valueOf(cfg.streams));
        }

        if ("UDP".equalsIgnoreCase(cfg.protocol)) {
            args.add("-u");
            args.add("-b");
            args.add(cfg.udpBitrateMbps + "M");
        }

        if (cfg.bidirMode) {
            args.add("--bidir");
        } else if (cfg.reverseMode) {
            args.add("-R");
        }

        return args;
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
            applyBinaryPermissions(output);
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

    private File internalBinaryFile(String abi) {
        File dir = new File(getContext().getFilesDir(), "babydragon/iperf3/" + abi);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return new File(dir, BINARY_NAME);
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
            parseIperfIntervals(json, result);
        } catch (Exception ex) {
            result.put("json_parse_warning", ex.getMessage());
        }
    }

    private void parseIperfIntervals(JSONObject json, JSObject result) {
        try {
            org.json.JSONArray intervals = json.optJSONArray("intervals");
            if (intervals == null) return;

            JSArray intervalRows = new JSArray();
            for (int i = 0; i < intervals.length(); i += 1) {
                JSONObject item = intervals.optJSONObject(i);
                if (item == null) continue;

                JSObject row = new JSObject();
                row.put("index", i + 1);

                JSONObject sumSent = item.optJSONObject("sum_sent");
                JSONObject sumReceived = item.optJSONObject("sum_received");
                JSONObject sum = item.optJSONObject("sum");

                if (sumSent != null) {
                    row.put("sent_mbps", bitsPerSecondToMbps(sumSent.optDouble("bits_per_second", 0.0)));
                    row.put("sent_bytes", sumSent.optLong("bytes", 0L));
                    row.put("start", sumSent.optDouble("start", 0.0));
                    row.put("end", sumSent.optDouble("end", 0.0));
                    row.put("seconds", sumSent.optDouble("seconds", 0.0));
                }

                if (sumReceived != null) {
                    row.put("received_mbps", bitsPerSecondToMbps(sumReceived.optDouble("bits_per_second", 0.0)));
                    row.put("received_bytes", sumReceived.optLong("bytes", 0L));
                    if (!row.has("start")) row.put("start", sumReceived.optDouble("start", 0.0));
                    if (!row.has("end")) row.put("end", sumReceived.optDouble("end", 0.0));
                    if (!row.has("seconds")) row.put("seconds", sumReceived.optDouble("seconds", 0.0));
                }

                if (sum != null) {
                    row.put("sum_mbps", bitsPerSecondToMbps(sum.optDouble("bits_per_second", 0.0)));
                    row.put("sum_bytes", sum.optLong("bytes", 0L));
                    if (!row.has("start")) row.put("start", sum.optDouble("start", 0.0));
                    if (!row.has("end")) row.put("end", sum.optDouble("end", 0.0));
                    if (!row.has("seconds")) row.put("seconds", sum.optDouble("seconds", 0.0));
                }

                intervalRows.put(row);
            }

            result.put("intervals", intervalRows);
        } catch (Exception ignored) {
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

    /** Prefer stdout JSON "error" when stderr is empty (common for iperf3 -J failures). */
    private String safeErrorMessage(String stderr, String stdout, int exitCode) {
        if (stderr != null && !stderr.trim().isEmpty()) {
            return stderr.trim();
        }
        if (stdout != null && !stdout.trim().isEmpty()) {
            try {
                JSONObject json = new JSONObject(stdout);
                String error = json.optString("error", "").trim();
                if (!error.isEmpty()) {
                    return error;
                }
            } catch (Exception ignored) {
                // not JSON — fall through
            }
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
        boolean bidirMode;
        int udpBitrateMbps;
        int timeoutSeconds;

        static IperfConfig from(PluginCall call) {
            IperfConfig cfg = new IperfConfig();
            cfg.server = getString(call, "server", "");
            cfg.port = clamp(getInt(call, "port", 5201), 1, 65535);
            cfg.protocol = getString(call, "protocol", "TCP").toUpperCase(Locale.US);
            cfg.direction = normalizeDirection(getString(call, "direction", "ul"));
            cfg.durationSeconds = clamp(getInt(call, "durationSeconds", 10), 1, 3600);
            cfg.intervalSeconds = clamp(getInt(call, "intervalSeconds", 1), 1, 60);
            cfg.streams = clamp(getInt(call, "streams", 1), 1, 128);
            cfg.reverseMode = getBool(call, "reverseMode", false);
            cfg.bidirMode = getBool(call, "bidirMode", false);
            cfg.udpBitrateMbps = clamp(getInt(call, "udpBitrateMbps", 10), 1, 100000);
            cfg.timeoutSeconds = cfg.durationSeconds + 25;

            if (cfg.server.trim().isEmpty()) {
                throw new IllegalArgumentException("iPerf3 server is required.");
            }

            return cfg;
        }

        static String normalizeDirection(String raw) {
            String d = raw == null ? "ul" : raw.trim().toLowerCase(Locale.US);
            if (d.contains("ul") && d.contains("dl")) return "dl_ul";
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
