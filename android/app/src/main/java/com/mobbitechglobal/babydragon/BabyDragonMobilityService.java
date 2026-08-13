package com.mobbitechglobal.babydragon;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

/**
 * Foreground mobility service that owns native GPS + RF sampling.
 *
 * RF ticker must run even when GPS has no fix. GPS may remain unavailable
 * with an explicit reason while RF samples continue into the shared buffer.
 */
public class BabyDragonMobilityService extends Service {
    private static final String TAG = "BabyDragonMobilityService";

    public static final String CHANNEL_ID = "babydragon_mobility_session";
    public static final int NOTIFICATION_ID = 174201;
    public static final String ACTION_STOP = "com.mobbitechglobal.babydragon.ACTION_STOP_MOBILITY";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_SESSION_ID = "sessionId";

    private static final long GPS_MIN_TIME_MS = 1000L;
    private static final float GPS_MIN_DISTANCE_M = 0f;
    private static final long RF_TICK_MS = 1000L;

    private static volatile boolean running = false;
    private static volatile boolean rfTickerActive = false;
    private static volatile boolean locationSubscriptionActive = false;
    private static volatile String locationSubscriptionReason = "not_started";
    private static volatile String lastServiceError = "";
    private static volatile String lastTitle = "BabyDragon mobility test";
    private static volatile String lastText = "Recording RF / GPS / data test";
    private static volatile String lastStatus = "running";
    private static volatile String lastSessionId = "";
    private static volatile long startedAtElapsed = 0L;
    private static volatile long sessionStartedAtWallMs = 0L;
    private static volatile Location latestLocation = null;
    private static volatile long latestLocationElapsedRealtimeNs = 0L;
    private static volatile long lastNativeLocationTimestamp = 0L;
    private static volatile String lastNativeLocationProvider = "";
    private static volatile long lastNativeRfTimestamp = 0L;

    private LocationManager locationManager;
    private LocationListener locationListener;
    private Handler rfHandler;
    private Runnable rfTick;
    private boolean collectorsStarted = false;

    public static boolean isRunning() {
        return running;
    }

    public static String getSessionId() {
        return lastSessionId != null ? lastSessionId : "";
    }

    public static boolean isRfTickerActive() {
        return rfTickerActive && running;
    }

    public static boolean isLocationSubscriptionActive() {
        return locationSubscriptionActive;
    }

    public static Location getLatestLocation() {
        return latestLocation;
    }

    public static JSObject buildDiagnostics(Context context) {
        JSObject result = BabyDragonMobilityBuffer.status();
        Context app = context != null ? context.getApplicationContext() : null;
        boolean fine = false;
        boolean coarse = false;
        boolean gpsEnabled = false;
        boolean networkEnabled = false;
        boolean locationMaster = false;
        if (app != null) {
            fine = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
            coarse = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
            try {
                LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
                if (lm != null) {
                    gpsEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
                    networkEnabled = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        locationMaster = lm.isLocationEnabled();
                    } else {
                        locationMaster = gpsEnabled || networkEnabled;
                    }
                }
            } catch (Exception exception) {
                lastServiceError = "location_manager_probe: " + exception.getMessage();
            }
        }

        long now = System.currentTimeMillis();
        long ageMs = lastNativeLocationTimestamp > 0L ? Math.max(0L, now - lastNativeLocationTimestamp) : -1L;

        result.put("serviceRunning", running);
        result.put("sessionId", lastSessionId != null ? lastSessionId : "");
        result.put("sessionStartedAt", sessionStartedAtWallMs);
        result.put("locationPermission", fine || coarse);
        result.put("preciseLocationGranted", fine);
        result.put("gpsProviderEnabled", gpsEnabled);
        result.put("networkProviderEnabled", networkEnabled);
        result.put("locationMasterEnabled", locationMaster);
        result.put("locationSubscriptionActive", locationSubscriptionActive);
        result.put("locationSubscriptionReason", locationSubscriptionReason != null ? locationSubscriptionReason : "");
        result.put("lastNativeLocationTimestamp", lastNativeLocationTimestamp);
        result.put("lastNativeLocationAgeMs", ageMs);
        result.put("lastNativeLocationProvider", lastNativeLocationProvider != null ? lastNativeLocationProvider : "");
        result.put("rfTickerActive", rfTickerActive && running);
        result.put("lastNativeRfTimestamp", lastNativeRfTimestamp);
        result.put("lastServiceError", lastServiceError != null ? lastServiceError : "");
        result.put("bufferSingleton", "BabyDragonMobilityBuffer");
        return result;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        rfHandler = new Handler(Looper.getMainLooper());
        Log.i(TAG, "onCreate");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, "ACTION_STOP");
            stopCollectors();
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            if (intent.hasExtra(EXTRA_TITLE)) {
                lastTitle = intent.getStringExtra(EXTRA_TITLE);
            }
            if (intent.hasExtra(EXTRA_TEXT)) {
                lastText = intent.getStringExtra(EXTRA_TEXT);
            }
            if (intent.hasExtra(EXTRA_STATUS)) {
                lastStatus = intent.getStringExtra(EXTRA_STATUS);
            }
            if (intent.hasExtra(EXTRA_SESSION_ID)) {
                String sid = intent.getStringExtra(EXTRA_SESSION_ID);
                if (sid != null && !sid.equals(lastSessionId)) {
                    lastSessionId = sid;
                    latestLocation = null;
                    latestLocationElapsedRealtimeNs = 0L;
                    lastNativeLocationTimestamp = 0L;
                    lastNativeLocationProvider = "";
                    BabyDragonMobilityBuffer.reset(sid);
                } else if (sid != null) {
                    lastSessionId = sid;
                }
            }
        }

        if (startedAtElapsed <= 0L) {
            startedAtElapsed = SystemClock.elapsedRealtime();
            sessionStartedAtWallMs = System.currentTimeMillis();
        }

        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                    | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                startForeground(NOTIFICATION_ID, notification, type);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            running = true;
            lastServiceError = "";
            Log.i(TAG, "startForeground ok sessionId=" + lastSessionId);
        } catch (Exception exception) {
            Log.e(TAG, "startForeground primary failed: " + exception.getMessage(), exception);
            lastServiceError = "startForeground: " + exception.getMessage();
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                running = true;
                lastServiceError = "startForeground_fallback_ok_after: " + exception.getMessage();
                Log.i(TAG, "startForeground fallback ok");
            } catch (Exception ignored) {
                running = false;
                rfTickerActive = false;
                lastServiceError = "startForeground_failed: " + ignored.getMessage();
                Log.e(TAG, "startForeground failed completely: " + ignored.getMessage(), ignored);
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        startCollectors();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy");
        stopCollectors();
        running = false;
        startedAtElapsed = 0L;
        sessionStartedAtWallMs = 0L;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startCollectors() {
        if (collectorsStarted) {
            Log.i(TAG, "collectors already started");
            return;
        }
        collectorsStarted = true;
        startNativeGps();
        startRfTicker();
        Log.i(TAG, "collectors started locationSubscriptionActive=" + locationSubscriptionActive
            + " rfTickerActive=" + rfTickerActive
            + " reason=" + locationSubscriptionReason);
    }

    private void stopCollectors() {
        collectorsStarted = false;
        stopNativeGps();
        if (rfHandler != null && rfTick != null) {
            rfHandler.removeCallbacks(rfTick);
        }
        rfTick = null;
        rfTickerActive = false;
        latestLocation = null;
        latestLocationElapsedRealtimeNs = 0L;
        Log.i(TAG, "collectors stopped");
    }

    private void startNativeGps() {
        locationSubscriptionActive = false;
        if (locationManager == null) {
            locationSubscriptionReason = "location_manager_null";
            Log.e(TAG, locationSubscriptionReason);
            return;
        }
        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) {
            locationSubscriptionReason = "permission_denied";
            Log.e(TAG, "SecurityException risk: " + locationSubscriptionReason);
            return;
        }

        boolean gpsEnabled = false;
        boolean networkEnabled = false;
        try {
            gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
            networkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception exception) {
            locationSubscriptionReason = "provider_probe_failed: " + exception.getMessage();
            Log.e(TAG, locationSubscriptionReason, exception);
            return;
        }

        if (!gpsEnabled && !networkEnabled) {
            locationSubscriptionReason = "location_services_disabled";
            Log.w(TAG, locationSubscriptionReason + " — RF ticker continues without GPS");
            return;
        }

        if (locationListener == null) {
            locationListener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    if (location == null) return;
                    latestLocation = location;
                    latestLocationElapsedRealtimeNs = SystemClock.elapsedRealtimeNanos();
                    long fixMs = location.getTime() > 0L ? location.getTime() : System.currentTimeMillis();
                    lastNativeLocationTimestamp = fixMs;
                    lastNativeLocationProvider = location.getProvider() != null
                        ? ("android_" + location.getProvider())
                        : "android_location_manager";
                    BabyDragonMobilityBuffer.noteGpsFix(fixMs);
                    Log.i(TAG, "location LocationManager fix provider=" + lastNativeLocationProvider
                        + " fixMs=" + fixMs);
                }

                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(String provider) {}

                @Override
                public void onProviderDisabled(String provider) {}
            };
        }

        boolean subscribed = false;
        StringBuilder reasons = new StringBuilder();

        try {
            if (fine && gpsEnabled) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    GPS_MIN_TIME_MS,
                    GPS_MIN_DISTANCE_M,
                    locationListener,
                    Looper.getMainLooper()
                );
                subscribed = true;
                reasons.append("gps");
            } else if (!gpsEnabled) {
                reasons.append("gps_disabled");
            } else {
                reasons.append("gps_needs_fine");
            }
        } catch (SecurityException securityException) {
            locationSubscriptionReason = "SecurityException: " + securityException.getMessage();
            Log.e(TAG, locationSubscriptionReason, securityException);
            return;
        } catch (Exception exception) {
            reasons.append("gps_error:").append(exception.getMessage());
            Log.e(TAG, "GPS provider subscribe failed", exception);
        }

        try {
            if ((fine || coarse) && networkEnabled) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    GPS_MIN_TIME_MS,
                    GPS_MIN_DISTANCE_M,
                    locationListener,
                    Looper.getMainLooper()
                );
                subscribed = true;
                if (reasons.length() > 0) reasons.append("+");
                reasons.append("network");
            } else if (!networkEnabled) {
                if (reasons.length() > 0) reasons.append("+");
                reasons.append("network_disabled");
            }
        } catch (SecurityException securityException) {
            locationSubscriptionReason = "SecurityException: " + securityException.getMessage();
            Log.e(TAG, locationSubscriptionReason, securityException);
            return;
        } catch (Exception exception) {
            if (reasons.length() > 0) reasons.append("+");
            reasons.append("network_error:").append(exception.getMessage());
            Log.e(TAG, "NETWORK provider subscribe failed", exception);
        }

        locationSubscriptionActive = subscribed;
        locationSubscriptionReason = subscribed
            ? ("active:" + reasons)
            : ("unavailable:" + reasons);
        Log.i(TAG, "location subscription " + locationSubscriptionReason);
        // Intentionally do NOT seed latestLocation from getLastKnownLocation.
    }

    private void stopNativeGps() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (Exception ignored) {
            }
        }
        locationListener = null;
        locationSubscriptionActive = false;
        if (!"permission_denied".equals(locationSubscriptionReason)
            && !"location_services_disabled".equals(locationSubscriptionReason)
            && locationSubscriptionReason != null
            && !locationSubscriptionReason.startsWith("unavailable")) {
            locationSubscriptionReason = "stopped";
        }
    }

    private void startRfTicker() {
        if (rfHandler == null) rfHandler = new Handler(Looper.getMainLooper());
        if (rfTick != null) {
            rfHandler.removeCallbacks(rfTick);
        }
        rfTickerActive = true;
        rfTick = new Runnable() {
            @Override
            public void run() {
                if (!running || !collectorsStarted) {
                    rfTickerActive = false;
                    Log.w(TAG, "RF ticker stopped running=" + running + " collectors=" + collectorsStarted);
                    return;
                }
                collectOneSample();
                rfHandler.postDelayed(this, RF_TICK_MS);
            }
        };
        rfHandler.post(rfTick);
        Log.i(TAG, "RF ticker started intervalMs=" + RF_TICK_MS);
    }

    private void collectOneSample() {
        try {
            long nowMs = System.currentTimeMillis();
            long elapsedRealtimeMs = SystemClock.elapsedRealtime();
            // RF collection must not depend on a GPS fix.
            JSObject snapshot = BabyDragonRfKpiPlugin.buildMobilityRfSnapshot(getApplicationContext());
            if (snapshot == null) {
                snapshot = new JSObject();
                snapshot.put("ok", false);
                snapshot.put("status", "snapshot_unavailable");
            }
            snapshot.put("babyDragonReadAt", nowMs);
            snapshot.put("mobilityOwned", true);
            snapshot.put("mobilityElapsedRealtimeMs", elapsedRealtimeMs);

            JSObject sample = new JSObject();
            sample.put("timestamp", nowMs);
            sample.put("elapsedRealtimeMs", elapsedRealtimeMs);
            sample.put("sessionId", lastSessionId);
            sample.put("recordState", "active");
            sample.put("source", "android_mobility_service");
            sample.put("snapshot", snapshot);
            JSObject gps = locationToJs(latestLocation, nowMs, elapsedRealtimeMs);
            sample.put("gps", gps);
            sample.put("gps_status", gps != null ? gps.getString("gps_status", "unavailable") : "unavailable");
            BabyDragonMobilityBuffer.add(sample);
            lastNativeRfTimestamp = nowMs;

            boolean snapOk = false;
            try { snapOk = snapshot.getBoolean("ok"); } catch (Exception ignored) {}
            Log.i(TAG, "RF sample buffered ok=" + snapOk
                + " status=" + snapshot.getString("status", "")
                + " gps_status=" + sample.getString("gps_status", "unavailable")
                + " ts=" + nowMs);

            BabyDragonRfKpiPlugin.emitMobilitySampleHint();
        } catch (Exception exception) {
            lastServiceError = "collectOneSample: " + exception.getMessage();
            Log.e(TAG, lastServiceError, exception);
            // Keep service alive; next tick retries. RF must not die because of GPS.
        }
    }

    private static JSObject locationToJs(Location location, long nowMs, long elapsedRealtimeMs) {
        JSObject gps = new JSObject();
        gps.put("gps_freshness_source", "android_location_manager");
        gps.put("sample_wall_timestamp_ms", nowMs);
        gps.put("sample_elapsed_realtime_ms", elapsedRealtimeMs);
        if (location == null) {
            gps.put("lat", (Object) null);
            gps.put("lng", (Object) null);
            gps.put("provider", (Object) null);
            gps.put("gps_status", "unavailable");
            gps.put("location_fix_timestamp_ms", (Object) null);
            gps.put("location_fix_timestamp_iso", (Object) null);
            gps.put("gps_fix_age_ms", (Object) null);
            String reason = locationSubscriptionReason != null ? locationSubscriptionReason : "waiting_for_fix";
            if ("permission_denied".equals(reason)) {
                gps.put("gps_unavailable_reason", "permission_denied");
            } else if ("location_services_disabled".equals(reason)) {
                gps.put("gps_unavailable_reason", "location_services_disabled");
            } else if (reason.startsWith("active:")) {
                gps.put("gps_unavailable_reason", "waiting_for_native_gps_fix");
            } else {
                gps.put("gps_unavailable_reason", reason);
            }
            return gps;
        }

        long fixMs = location.getTime() > 0L ? location.getTime() : nowMs;
        long ageMs = Math.max(0L, nowMs - fixMs);
        gps.put("lat", location.getLatitude());
        gps.put("lng", location.getLongitude());
        gps.put("latitude", location.getLatitude());
        gps.put("longitude", location.getLongitude());
        if (location.hasAccuracy()) {
            gps.put("accuracy", location.getAccuracy());
            gps.put("accuracy_m", location.getAccuracy());
        }
        if (location.hasSpeed()) {
            gps.put("speed", location.getSpeed());
            gps.put("speed_mps", location.getSpeed());
        }
        if (location.hasBearing()) {
            gps.put("bearing", location.getBearing());
            gps.put("bearing_deg", location.getBearing());
            gps.put("heading", location.getBearing());
        }
        if (location.hasAltitude()) {
            gps.put("altitude", location.getAltitude());
            gps.put("altitude_m", location.getAltitude());
        }
        gps.put("provider", location.getProvider() != null
            ? ("android_" + location.getProvider())
            : "android_location_manager");
        gps.put("location_fix_timestamp_ms", fixMs);
        gps.put("location_fix_timestamp_iso", iso(fixMs));
        gps.put("gps_fix_age_ms", ageMs);
        gps.put("elapsed_realtime_nanos", location.getElapsedRealtimeNanos());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            gps.put("gps_is_mock", location.isMock());
        } else {
            gps.put("gps_is_mock", location.isFromMockProvider());
        }
        if (ageMs <= 5000L) gps.put("gps_status", "fresh");
        else if (ageMs <= 30000L) gps.put("gps_status", "stale");
        else gps.put("gps_status", "lost");
        return gps;
    }

    private static String iso(long ms) {
        try {
            java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                java.util.Locale.US
            );
            fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return fmt.format(new java.util.Date(ms));
        } catch (Exception error) {
            return null;
        }
    }

    private void stopSelfSafely() {
        running = false;
        rfTickerActive = false;
        startedAtElapsed = 0L;
        sessionStartedAtWallMs = 0L;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "BabyDragon Mobility Session",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps RF/GPS/data recording active during mobility tests.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launchIntent != null) {
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            contentIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        Intent stopIntent = new Intent(this, BabyDragonMobilityService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        long elapsedMs = startedAtElapsed > 0L
            ? Math.max(0L, SystemClock.elapsedRealtime() - startedAtElapsed)
            : 0L;
        String elapsed = formatElapsed(elapsedMs);
        JSObject buf = BabyDragonMobilityBuffer.status();
        int buffered = 0;
        try { buffered = buf.getInt("bufferedCount"); } catch (Exception ignored) {}
        String body = (lastText != null ? lastText : "Recording")
            + " · " + (lastStatus != null ? lastStatus : "running")
            + " · " + elapsed
            + " · buf " + buffered
            + " · rf " + (rfTickerActive ? "on" : "off");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(lastTitle != null ? lastTitle : "BabyDragon mobility test")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body
                + (lastSessionId != null && lastSessionId.length() > 0 ? "\nSession: " + lastSessionId : "")))
            .setSmallIcon(getApplicationInfo().icon)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Stop", stopPending);

        if (contentIntent != null) {
            builder.setContentIntent(contentIntent);
        }
        return builder.build();
    }

    private static String formatElapsed(long ms) {
        long totalSec = ms / 1000L;
        long hours = totalSec / 3600L;
        long minutes = (totalSec % 3600L) / 60L;
        long seconds = totalSec % 60L;
        if (hours > 0) {
            return String.format("%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format("%02d:%02d", minutes, seconds);
    }
}
