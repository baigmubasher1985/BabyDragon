Find MainActivity.java
======================

Method 1 - Android Studio:
1. Press Ctrl + Shift + N
2. Search: MainActivity.java

Method 2:
1. Press Shift twice
2. Search: MainActivity

Method 3:
1. Change left tree from Android to Project
2. Open android/app/src/main/java/
3. Open your package folder, usually:
   com/mobbitechglobal/babydragon/MainActivity.java

What to add
-----------
Add this line before super.onCreate(savedInstanceState):

registerPlugin(BabyDragonIperfPlugin.class);

Example:

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BabyDragonRfKpiPlugin.class);
        registerPlugin(BabyDragonFtpPlugin.class);
        registerPlugin(BabyDragonIperfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

If your MainActivity has no manual registerPlugin lines, send a screenshot first.
