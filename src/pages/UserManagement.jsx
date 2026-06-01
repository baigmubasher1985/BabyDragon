import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ROLE_OPTIONS = [
  { value: "fe", label: "FE" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role || "FE";
}

function formatDate(value) {
  if (!value) return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return date.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("fe");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [creating, setCreating] = useState(false);

  const [showCreateTools, setShowCreateTools] = useState(false);
  const [showUserRecords, setShowUserRecords] = useState(false);

  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    setNotice("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id || null);

    const { data, error } = await supabase.from("profiles").select("*");

    if (error) {
      setNotice(`Could not load users: ${error.message}`);
      setUsers([]);
      setLoading(false);
      return;
    }

    const sortedUsers = [...(data || [])].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

    setUsers(sortedUsers);
    setLoading(false);
  }

  async function createUser() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setNotice("Please enter email and password before creating a user.");
      return;
    }

    if (password.length < 6) {
      setNotice("Password should be at least 6 characters.");
      return;
    }

    setCreating(true);
    setNotice("");

    const { error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email: cleanEmail,
        password,
        role,
      },
    });

    setCreating(false);

    if (error) {
      setNotice(
        `Create User is not ready or failed: ${error.message}. For now, use Supabase Authentication → Users.`
      );
      return;
    }

    setNotice("User created successfully.");
    setEmail("");
    setPassword("");
    setRole("fe");
    fetchUsers();
  }

  async function resetPassword(userEmail) {
    if (!userEmail) return;

    const newPassword = window.prompt(`Enter new password for ${userEmail}`);
    if (!newPassword) return;

    if (newPassword.length < 6) {
      setNotice("Password should be at least 6 characters.");
      return;
    }

    setBusyId(userEmail);
    setNotice("");

    const { error } = await supabase.functions.invoke("admin-reset-password", {
      body: {
        email: userEmail,
        password: newPassword,
      },
    });

    setBusyId("");

    if (error) {
      setNotice(
        `Reset Password is not ready or failed: ${error.message}. For now, use Supabase Authentication → Users.`
      );
      return;
    }

    setNotice("Password updated successfully.");
  }

  async function toggleActive(user) {
    if (!user?.id) return;

    if (user.id === currentUserId) {
      setNotice("Safety lock: you cannot deactivate the account you are signed in with.");
      return;
    }

    const nextActive = user.is_active === false;

    setBusyId(user.id);
    setNotice("");

    const { error } = await supabase
      .from("profiles")
      .update({ is_active: nextActive })
      .eq("id", user.id);

    setBusyId("");

    if (error) {
      setNotice(`Could not update account status: ${error.message}`);
      return;
    }

    setNotice(nextActive ? "User activated." : "User deactivated.");
    fetchUsers();
  }

  async function updateRole(user, nextRole) {
    if (!user?.id || !nextRole || nextRole === user.role) return;

    if (user.id === currentUserId && nextRole !== "super_admin") {
      setNotice("Safety lock: do not downgrade your own Super Admin role.");
      return;
    }

    const confirmed = window.confirm(
      `Change ${user.email} role from ${roleLabel(user.role)} to ${roleLabel(nextRole)}?`
    );

    if (!confirmed) return;

    setBusyId(user.id);
    setNotice("");

    const { error } = await supabase
      .from("profiles")
      .update({ role: nextRole })
      .eq("id", user.id);

    setBusyId("");

    if (error) {
      setNotice(`Could not update role: ${error.message}`);
      return;
    }

    setNotice("User role updated.");
    fetchUsers();
  }

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => user.is_active !== false).length;
    const inactive = users.filter((user) => user.is_active === false).length;
    const admins = users.filter(
      (user) => user.role === "admin" || user.role === "super_admin"
    ).length;
    const fieldEngineers = users.filter((user) => user.role === "fe").length;

    return {
      total,
      active,
      inactive,
      admins,
      fieldEngineers,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !term ||
        user.email?.toLowerCase().includes(term) ||
        user.full_name?.toLowerCase().includes(term) ||
        user.role?.toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && user.is_active !== false) ||
        (statusFilter === "inactive" && user.is_active === false);

      const matchesRole = roleFilter === "all" || user.role === roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [users, search, statusFilter, roleFilter]);

  return (
    <div className="bd-user-management">
      <style>{`
        .bd-user-management,
        .bd-user-management * {
          box-sizing: border-box;
        }

        .bd-user-management {
          --um-page-text: #071a33;
          --um-muted: #34506f;
          --um-card: #ffffff;
          --um-card-soft: #f6fbff;
          --um-card-subtle: #eef6ff;
          --um-border: #b8d2ff;
          --um-border-strong: #7eb0ff;
          --um-blue: #1167ff;
          --um-cyan: #07b7d8;
          --um-green: #16bd72;
          --um-red: #f04452;
          --um-orange: #f59e0b;
          --um-shadow: 0 10px 24px rgba(37, 91, 166, 0.08);

          width: 100%;
          color: var(--um-page-text);
          display: grid;
          gap: 8px;
          font-size: 12px;
          line-height: 1.25;
          text-align: left;
        }

        :where(.theme-night, .bd-theme-night, body.bd-theme-night, html.bd-theme-night, body.night, html.night, body.dark, html.dark, .dark, .night) .bd-user-management {
          --um-page-text: #f3f8ff;
          --um-muted: #a9caef;
          --um-card: #0c1b2f;
          --um-card-soft: #091726;
          --um-card-subtle: #102642;
          --um-border: #24466d;
          --um-border-strong: #2f72bd;
          --um-shadow: none;
        }

        .bd-user-management .um-panel {
          width: 100%;
          margin: 0;
          padding: 10px 12px;
          background: var(--um-card);
          border: 1px solid var(--um-border);
          border-radius: 14px;
          box-shadow: var(--um-shadow);
          text-align: left;
        }

        .bd-user-management .um-panel.compact {
          padding: 9px 12px;
        }

        .bd-user-management .um-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          min-height: 74px;
        }

        .bd-user-management .um-kicker {
          margin: 0 0 4px;
          color: var(--um-blue);
          font-size: 10px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          text-align: left;
        }

        .bd-user-management .um-title,
        .bd-user-management .um-panel-title {
          margin: 0;
          color: var(--um-page-text);
          font-weight: 900;
          letter-spacing: -0.015em;
          text-align: left;
        }

        .bd-user-management .um-title {
          font-size: 18px;
          line-height: 1.12;
        }

        .bd-user-management .um-panel-title {
          font-size: 15px;
          line-height: 1.12;
        }

        .bd-user-management .um-subtitle,
        .bd-user-management .um-panel-copy,
        .bd-user-management .um-small-copy {
          margin: 4px 0 0;
          color: var(--um-muted);
          font-weight: 650;
          text-align: left;
        }

        .bd-user-management .um-subtitle {
          font-size: 12px;
          line-height: 1.25;
        }

        .bd-user-management .um-panel-copy {
          font-size: 11.5px;
          line-height: 1.25;
        }

        .bd-user-management .um-small-copy {
          font-size: 11px;
          line-height: 1.25;
        }

        .bd-user-management .um-flow-pill {
          border: 1px solid var(--um-border-strong);
          border-radius: 999px;
          padding: 10px 16px;
          color: var(--um-blue);
          background: rgba(17, 103, 255, 0.06);
          font-size: 14px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
          text-align: center;
        }

        :where(.theme-night, .bd-theme-night, body.bd-theme-night, html.bd-theme-night, body.night, html.night, body.dark, html.dark, .dark, .night) .bd-user-management .um-flow-pill {
          color: #7db7ff;
          background: rgba(17, 103, 255, 0.13);
        }

        .bd-user-management .um-stats-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
        }

        .bd-user-management .um-stat-card {
          min-height: 54px;
          background: var(--um-card);
          border: 1px solid var(--um-border);
          border-radius: 12px;
          padding: 8px 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .bd-user-management .um-stat-label {
          margin: 0 0 4px;
          color: var(--um-blue);
          font-size: 10.5px;
          line-height: 1.05;
          font-weight: 900;
          text-align: center;
        }

        .bd-user-management .um-stat-value {
          margin: 0;
          color: var(--um-page-text);
          font-size: 20px;
          line-height: 1;
          font-weight: 950;
          text-align: center;
        }

        .bd-user-management .um-stat-value.green {
          color: var(--um-green);
        }

        .bd-user-management .um-stat-value.orange {
          color: var(--um-orange);
        }

        .bd-user-management .um-tools-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 8px;
          align-items: start;
        }

        .bd-user-management .um-panel-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
          gap: 10px;
          border-bottom: 1px solid rgba(126, 176, 255, 0.28);
          padding-bottom: 8px;
          margin-bottom: 8px;
          text-align: left;
        }

        .bd-user-management .um-hidden-message,
        .bd-user-management .um-note {
          width: 100%;
          border: 1px dashed var(--um-border-strong);
          border-radius: 12px;
          padding: 10px 12px;
          background: rgba(17, 103, 255, 0.05);
          color: var(--um-muted);
          font-size: 11.5px;
          line-height: 1.2;
          font-weight: 850;
          text-align: left;
        }

        .bd-user-management .um-note {
          margin-top: 8px;
          font-size: 11.5px;
          font-weight: 750;
        }

        .bd-user-management .um-notice {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          border: 1px solid var(--um-border-strong);
          border-radius: 12px;
          padding: 8px 10px;
          background: rgba(17, 103, 255, 0.07);
          color: var(--um-page-text);
          font-size: 12px;
          line-height: 1.25;
          font-weight: 800;
          text-align: left;
        }

        .bd-user-management .um-form-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 8px;
        }

        .bd-user-management .um-filter-row {
          display: grid;
          grid-template-columns: minmax(200px, 1fr) 150px 150px auto;
          gap: 8px;
          margin-bottom: 8px;
          align-items: center;
        }

        .bd-user-management .um-input,
        .bd-user-management .um-select {
          width: 100%;
          min-height: 32px;
          border: 1px solid var(--um-border);
          border-radius: 10px;
          padding: 8px 10px;
          background: var(--um-card-soft);
          color: var(--um-page-text);
          outline: none;
          font-size: 12px;
          line-height: 1.1;
          font-weight: 750;
          text-align: left;
        }

        .bd-user-management .um-input::placeholder {
          color: rgba(49, 82, 116, 0.72);
        }

        :where(.theme-night, .bd-theme-night, body.bd-theme-night, html.bd-theme-night, body.night, html.night, body.dark, html.dark, .dark, .night) .bd-user-management .um-input::placeholder {
          color: rgba(169, 202, 239, 0.7);
        }

        .bd-user-management .um-input:focus,
        .bd-user-management .um-select:focus {
          border-color: var(--um-blue);
          box-shadow: 0 0 0 3px rgba(17, 103, 255, 0.13);
        }

        .bd-user-management .um-btn {
          min-height: 32px;
          border: 1px solid var(--um-border);
          border-radius: 10px;
          padding: 8px 12px;
          color: var(--um-page-text);
          background: var(--um-card-soft);
          cursor: pointer;
          font-size: 11.5px;
          line-height: 1.05;
          font-weight: 900;
          white-space: nowrap;
          transition: transform 0.12s ease, opacity 0.12s ease, filter 0.12s ease;
        }

        .bd-user-management .um-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.02);
        }

        .bd-user-management .um-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }

        .bd-user-management .um-btn.primary {
          border-color: transparent;
          background: linear-gradient(90deg, #2563eb, #06b6d4);
          color: #ffffff;
        }

        .bd-user-management .um-btn.danger {
          border-color: transparent;
          background: linear-gradient(90deg, #ff5f6d, #ff8a3d);
          color: #ffffff;
        }

        .bd-user-management .um-btn.success {
          border-color: transparent;
          background: linear-gradient(90deg, #0f9f67, #10b981);
          color: #ffffff;
        }

        .bd-user-management .um-btn.small {
          min-height: 30px;
          padding: 7px 10px;
          font-size: 11px;
        }

        .bd-user-management .um-user-list {
          display: grid;
          gap: 7px;
          width: 100%;
          max-height: 238px;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 2px;
        }

        .bd-user-management .um-user-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 7px;
          align-items: stretch;
          width: 100%;
          max-width: 100%;
          background: var(--um-card-soft);
          border: 1px solid var(--um-border);
          border-radius: 12px;
          padding: 8px 10px;
          text-align: left;
          overflow: hidden;
        }

        .bd-user-management .um-user-row .um-select {
          max-width: 100%;
        }

        .bd-user-management .um-user-email {
          color: var(--um-page-text);
          font-size: 13px;
          line-height: 1.15;
          font-weight: 950;
          word-break: break-word;
          text-align: left;
        }

        .bd-user-management .um-user-meta {
          margin-top: 4px;
          color: var(--um-muted);
          font-size: 11px;
          line-height: 1.2;
          font-weight: 750;
          text-align: left;
        }

        .bd-user-management .um-status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 68px;
          border: 1px solid var(--um-border);
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 11px;
          line-height: 1;
          font-weight: 950;
          text-align: center;
        }

        .bd-user-management .um-status-pill.active {
          background: rgba(24, 201, 121, 0.13);
          color: var(--um-green);
          border-color: rgba(24, 201, 121, 0.55);
        }

        .bd-user-management .um-status-pill.inactive {
          background: rgba(240, 68, 82, 0.12);
          color: var(--um-red);
          border-color: rgba(240, 68, 82, 0.55);
        }

        .bd-user-management .um-actions {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          max-width: 100%;
        }

        @media (max-width: 1200px) {
          .bd-user-management .um-tools-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 950px) {
          .bd-user-management .um-hero,
          .bd-user-management .um-panel-head,
          .bd-user-management .um-form-grid,
          .bd-user-management .um-filter-row,
          .bd-user-management .um-user-row {
            grid-template-columns: 1fr;
          }

          .bd-user-management .um-flow-pill {
            width: 100%;
          }

          .bd-user-management .um-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bd-user-management .um-actions {
            justify-content: flex-start;
          }
        }
      `}</style>

      <section className="um-panel um-hero">
        <div>
          <div className="um-kicker">Administration</div>
          <h2 className="um-title">User Management</h2>
          <p className="um-subtitle">
            Create users, manage roles, activate/deactivate accounts, and prepare secure password reset control.
          </p>
        </div>

        <div className="um-flow-pill">Super Admin → Admin → FE</div>
      </section>

      <section className="um-stats-grid" aria-label="User summary">
        <div className="um-stat-card">
          <div className="um-stat-label">Total Users</div>
          <div className="um-stat-value">{stats.total}</div>
        </div>

        <div className="um-stat-card">
          <div className="um-stat-label">Active</div>
          <div className="um-stat-value green">{stats.active}</div>
        </div>

        <div className="um-stat-card">
          <div className="um-stat-label">Inactive</div>
          <div className="um-stat-value orange">{stats.inactive}</div>
        </div>

        <div className="um-stat-card">
          <div className="um-stat-label">Admins</div>
          <div className="um-stat-value">{stats.admins}</div>
        </div>

        <div className="um-stat-card">
          <div className="um-stat-label">Field Engineers</div>
          <div className="um-stat-value">{stats.fieldEngineers}</div>
        </div>
      </section>

      {notice && (
        <div className="um-notice">
          <span>{notice}</span>
          <button className="um-btn small" type="button" onClick={() => setNotice("")}>Clear</button>
        </div>
      )}

      <div className="um-tools-grid">
        <section className="um-panel compact">
          <div className="um-panel-head">
            <div>
              <div className="um-kicker">User Tools</div>
              <h3 className="um-panel-title">Create User</h3>
              <p className="um-panel-copy">
                Keep closed unless adding a new account. Secure creation should use Edge Functions.
              </p>
            </div>

            <button
              className="um-btn small"
              type="button"
              onClick={() => setShowCreateTools((value) => !value)}
            >
              {showCreateTools ? "Hide Create Tools" : "Show Create Tools"}
            </button>
          </div>

          {showCreateTools ? (
            <>
              <div className="um-form-grid">
                <input
                  className="um-input"
                  placeholder="Email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />

                <input
                  className="um-input"
                  placeholder="Temporary password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />

                <select
                  className="um-select"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  {ROLE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <button
                  className="um-btn primary"
                  type="button"
                  onClick={createUser}
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create User"}
                </button>
              </div>

              <div className="um-note">
                If Edge Functions are not deployed yet, use Supabase Authentication → Users for create/reset.
              </div>
            </>
          ) : (
            <div className="um-hidden-message">
              Create User tools are hidden. Open only when adding a new FE/Admin.
            </div>
          )}
        </section>

        <section className="um-panel compact">
          <div className="um-panel-head">
            <div>
              <div className="um-kicker">User Directory</div>
              <h3 className="um-panel-title">User Records</h3>
              <p className="um-panel-copy">
                Manage FE/Admin roles and account activity. Records stay closed for a clean screen.
              </p>
            </div>

            <button
              className="um-btn small"
              type="button"
              onClick={() => setShowUserRecords((value) => !value)}
            >
              {showUserRecords ? "Hide User Records" : `Show User Records (${filteredUsers.length})`}
            </button>
          </div>

          {!showUserRecords ? (
            <div className="um-hidden-message">
              User records are hidden. {filteredUsers.length} record(s) available.
            </div>
          ) : (
            <>
              <div className="um-filter-row">
                <input
                  className="um-input"
                  placeholder="Search user, email, role..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />

                <select
                  className="um-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>

                <select
                  className="um-select"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <option value="all">All Roles</option>
                  {ROLE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <button className="um-btn" type="button" onClick={fetchUsers}>Refresh</button>
              </div>

              {loading ? (
                <div className="um-hidden-message">Loading users...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="um-hidden-message">No users match the current filters.</div>
              ) : (
                <div className="um-user-list">
                  {filteredUsers.map((user) => {
                    const isSelf = user.id === currentUserId;
                    const isBusy = busyId === user.id || busyId === user.email;

                    return (
                      <div className="um-user-row" key={user.id || user.email}>
                        <div>
                          <div className="um-user-email">{user.email || "No email"}</div>
                          <div className="um-user-meta">
                            {isSelf ? "Signed-in account • " : ""}
                            Created: {formatDate(user.created_at)}
                          </div>
                        </div>

                        <div>
                          <span className={`um-status-pill ${user.is_active === false ? "inactive" : "active"}`}>
                            {user.is_active === false ? "Inactive" : "Active"}
                          </span>
                        </div>

                        <select
                          className="um-select"
                          value={user.role || "fe"}
                          onChange={(event) => updateRole(user, event.target.value)}
                          disabled={isBusy}
                        >
                          {ROLE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>

                        <div className="um-actions">
                          <button
                            className={`um-btn small ${user.is_active === false ? "success" : "danger"}`}
                            type="button"
                            onClick={() => toggleActive(user)}
                            disabled={isBusy || isSelf}
                            title={isSelf ? "You cannot deactivate your own account" : ""}
                          >
                            {user.is_active === false ? "Activate" : "Deactivate"}
                          </button>

                          <button
                            className="um-btn primary small"
                            type="button"
                            onClick={() => resetPassword(user.email)}
                            disabled={isBusy}
                          >
                            Reset Password
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
