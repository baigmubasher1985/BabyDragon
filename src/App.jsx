import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import AdminDashboard from "./AdminDashboard";
import FEDashboard from "./FEDashboard";
import "leaflet/dist/leaflet.css";
import "./App.css";

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchRole(userId) {
		if (!role) setLoading(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error) {
      console.error(error);
      alert("Failed to fetch role");
      setLoading(false);
      return;
    }

    setRole(data.role);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUser(data.session.user);
        fetchRole(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchRole(session.user.id);
      } else {
        setUser(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) alert(error.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
  }

  if (!user) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">🐉</div>
          <h1>BabyDragon</h1>
          <p>RF Drive Test Management Platform</p>

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

          <button type="submit">Login</button>
        </form>
      </div>
    );
  }

  if (loading || !role) {
    return <div className="loading-page">Loading BabyDragon...</div>;
  }

  if (role === "admin" || role === "super_admin") {
  return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (role === "fe") {
    return <FEDashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <div className="loading-page">
      <h2>Unknown role</h2>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}