import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import AdminDashboard from "./AdminDashboard";
import FEDashboard from "./FEDashboard";
import "leaflet/dist/leaflet.css";
import "./App.css";
import MobileApp from "./mobile/MobileApp";

const AUTH_CACHE_KEY = "babydragon_cached_auth_v1";
const SUPABASE_TIMEOUT_MS = 7000;

function withTimeout(promise, timeoutMs, label = "Request timed out") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readCachedAuth() {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw);
    if (!cached?.user?.id || !cached?.role) return null;

    return cached;
  } catch (error) {
    console.warn("Failed to read BabyDragon auth cache:", error);
    return null;
  }
}

function saveCachedAuth(user, role) {
  if (!user?.id || !role) return;

  try {
    localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email || "",
          aud: user.aud || "authenticated",
          role: user.role || "authenticated",
        },
        role,
        cached_at: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn("Failed to save BabyDragon auth cache:", error);
  }
}

function clearCachedAuth() {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch (error) {
    console.warn("Failed to clear BabyDragon auth cache:", error);
  }
}

export default function App() {
  const isMobileRoute = window.location.pathname.startsWith("/mobile");
	const isCapacitorApp =
	  window.location.protocol === "capacitor:" ||
	  window.Capacitor?.isNativePlatform?.();

	if (isMobileRoute || isCapacitorApp) {
	  return <MobileApp />;
	}

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineMode, setOfflineMode] = useState(() => !navigator.onLine);
  const [bootMessage, setBootMessage] = useState("Loading BabyDragon...");

  function loadCachedSession(reason = "Offline mode") {
    const cached = readCachedAuth();

    if (!cached) return false;

    setUser(cached.user);
    setRole(cached.role);
    setOfflineMode(true);
    setBootMessage(`${reason}: opening last saved BabyDragon session.`);
    setLoading(false);
    return true;
  }

  async function fetchRole(userId, options = {}) {
    const { userForCache = null, allowCachedFallback = true, quiet = false } = options;

    if (!userId) {
      setLoading(false);
      return null;
    }

    try {
      const { data, error } = await withTimeout(
        supabase.from("profiles").select("role").eq("id", userId).single(),
        SUPABASE_TIMEOUT_MS,
        "Role load timed out"
      );

      if (error) throw error;
      if (!data?.role) throw new Error("No role found for this user.");

      setRole(data.role);
      setOfflineMode(false);
      saveCachedAuth(userForCache || user, data.role);
      setLoading(false);
      return data.role;
    } catch (error) {
      console.error("Failed to fetch role:", error);

      const cached = readCachedAuth();
      const cacheMatchesUser = cached?.user?.id === userId;

      if (allowCachedFallback && cacheMatchesUser) {
        setUser(cached.user);
        setRole(cached.role);
        setOfflineMode(true);
        setBootMessage("Offline mode: using last saved role.");
        setLoading(false);
        return cached.role;
      }

      if (!quiet) alert("Failed to fetch role");
      setLoading(false);
      return null;
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootBabyDragon() {
      setLoading(true);
      setBootMessage("Loading BabyDragon...");

      if (!navigator.onLine) {
        if (loadCachedSession("No internet connection")) return;

        setLoading(false);
        return;
      }

      try {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          SUPABASE_TIMEOUT_MS,
          "Session load timed out"
        );

        if (!mounted) return;

        if (data.session?.user) {
          setUser(data.session.user);
          await fetchRole(data.session.user.id, {
            userForCache: data.session.user,
            allowCachedFallback: true,
            quiet: true,
          });
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("BabyDragon boot error:", error);

        if (!mounted) return;

        if (!loadCachedSession("Supabase did not respond")) {
          setLoading(false);
        }
      }
    }

    bootBabyDragon();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session?.user) {
        setUser(session.user);
        fetchRole(session.user.id, {
          userForCache: session.user,
          allowCachedFallback: true,
          quiet: true,
        });
      } else {
        if (!navigator.onLine && loadCachedSession("No internet connection")) return;

        setUser(null);
        setRole(null);
        setLoading(false);
      }
    });

    const handleOnline = () => setOfflineMode(false);
    const handleOffline = () => setOfflineMode(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      sub?.subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        SUPABASE_TIMEOUT_MS,
        "Login timed out"
      );

      if (error) {
        alert(error.message);
        setLoading(false);
      }
    } catch (error) {
      alert(error.message || "Login failed.");
      setLoading(false);
    }
  }

  async function handleLogout() {
    clearCachedAuth();

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("Logout request failed, clearing local session anyway:", error);
    }

    setUser(null);
    setRole(null);
    setOfflineMode(!navigator.onLine);
  }

  if (!user) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">🐉</div>
          <h1>BabyDragon</h1>
          <p>RF Drive Test Management Platform</p>

          {!navigator.onLine && (
            <p style={{ color: "#f59e0b", fontWeight: 800 }}>
              Offline. Login needs internet unless a saved session is available.
            </p>
          )}

          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" disabled={loading && !!email && !!password}>
            {loading ? "Loading..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  if (loading || !role) {
    return (
      <div className="loading-page">
        <div>{bootMessage}</div>
        {!navigator.onLine && (
          <p style={{ marginTop: 10, color: "#93c5fd" }}>
            Checking offline cache...
          </p>
        )}
      </div>
    );
  }

  if (role === "admin" || role === "super_admin") {
    return (
      <AdminDashboard
        user={user}
        onLogout={handleLogout}
        offlineMode={offlineMode}
      />
    );
  }

  if (role === "fe") {
    return (
      <FEDashboard
        user={user}
        onLogout={handleLogout}
        offlineMode={offlineMode}
      />
    );
  }

  return (
    <div className="loading-page">
      <h2>Unknown role</h2>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}
