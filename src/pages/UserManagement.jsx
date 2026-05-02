import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("fe");
  const [password, setPassword] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    const { data } = await supabase.from("profiles").select("*");
    setUsers(data || []);
  }

  async function createUser() {
    const { error } = await supabase.functions.invoke("admin-create-user", {
      body: { email, password, role },
    });

    if (error) {
      alert(error.message);
    } else {
      alert("User created");
      fetchUsers();
    }
  }

  async function resetPassword(userEmail) {
    const newPassword = prompt("Enter new password");

    if (!newPassword) return;

    const { error } = await supabase.functions.invoke(
      "admin-reset-password",
      {
        body: { email: userEmail, password: newPassword },
      }
    );

    if (error) {
      alert(error.message);
    } else {
      alert("Password updated");
    }
  }

  async function toggleActive(user) {
    await supabase
      .from("profiles")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);

    fetchUsers();
  }

  return (
    <div>
      <h2>User Management</h2>

      {/* CREATE USER */}
      <div style={{ marginBottom: "20px" }}>
        <input
          placeholder="Email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Password"
          type="password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <select onChange={(e) => setRole(e.target.value)}>
          <option value="fe">FE</option>
          <option value="admin">Admin</option>
        </select>

        <button onClick={createUser}>Create User</button>
      </div>

      {/* USERS LIST */}
      {users.map((u) => (
        <div key={u.id} style={{ marginBottom: "12px" }}>
          {u.email} | {u.role} | {u.is_active ? "Active" : "Inactive"}

          <button onClick={() => toggleActive(u)}>
            Toggle Active
          </button>

          <button onClick={() => resetPassword(u.email)}>
            Reset Password
          </button>
        </div>
      ))}
    </div>
  );
}