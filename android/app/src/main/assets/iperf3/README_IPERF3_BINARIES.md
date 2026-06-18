BabyDragon iPerf3 Binary Assets
===============================

Step 1G4A creates the ABI folder structure only. It does NOT include iPerf3 binaries.

Place verified Android/Linux executable binaries here:

android/app/src/main/assets/iperf3/arm64-v8a/iperf3
android/app/src/main/assets/iperf3/armeabi-v7a/iperf3
android/app/src/main/assets/iperf3/x86/iperf3
android/app/src/main/assets/iperf3/x86_64/iperf3

Do not place Windows/macOS binaries here.
Do not rename the binary to iperf3.exe or iperf3.bin.
Final filename must be exactly: iperf3

Minimum recommended customer server command:
iperf3 -s -p 5201

BabyDragon client-side examples after Step 1G4B:
UL TCP:
iperf3 -c <server> -p 5201 -t 10 -P 1 -J

DL TCP:
iperf3 -c <server> -p 5201 -t 10 -P 1 -R -J

UDP UL:
iperf3 -c <server> -p 5201 -u -b 10M -t 10 -J

UDP DL:
iperf3 -c <server> -p 5201 -u -b 10M -t 10 -R -J
