export default function MobileLogin({ error, loginForm, loginLoading, onLogin, onLoginFormChange }) {
  return (
    <main className="bd-mobile-screen">
      <section className="bd-mobile-hero">
        <div>
          <p className="bd-mobile-eyebrow">MobbiTech Global LLC</p>
          <h1>BabyDragon Mobile</h1>
          <p>Field Engineer APK shell</p>
        </div>
      </section>

      <section className="bd-mobile-card">
        <h2>FE Login</h2>
        <p className="bd-mobile-muted">Login with your existing BabyDragon FE account.</p>

        {error && <div className="bd-mobile-alert">{error}</div>}

        <form onSubmit={onLogin} className="bd-mobile-form">
          <label>
            Email
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) => onLoginFormChange({ email: event.target.value })}
              placeholder="fe@example.com"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => onLoginFormChange({ password: event.target.value })}
              placeholder="Password"
              required
            />
          </label>

          <button type="submit" className="bd-mobile-primary" disabled={loginLoading}>
            {loginLoading ? "Logging in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
