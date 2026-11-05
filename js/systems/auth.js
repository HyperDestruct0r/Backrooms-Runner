/* Backrooms Runner — Supabase authentication + run persistence.
 * The browser uses only the Supabase anon/publishable key. Never put a service-role key here.
 * Staff role changes are performed by the database RPC in supabase/moderator-hierarchy.sql.
 */
"use strict";

const SUPABASE_CONFIG = {
  url: "https://xinnkkbdljvvbksygtel.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhpbm5ra2JkbGp2dmJrc3lndGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDI4NzIsImV4cCI6MjEwODcxODg3Mn0.0d7vYAeJRsZQ4QkI3n-aImMq1whXw0o-L8aowWf3bG8"
};

const AuthSystem = {
  client: null,
  user: null,
  profile: null,
  ready: false,
  _adminEventsBound: false,

  async init() {
    if (!window.supabase || SUPABASE_CONFIG.url.startsWith("YOUR_")) {
      console.warn("AuthSystem: Supabase is not configured yet. Guest mode remains available.");
      this.updateUI();
      return;
    }
    this.client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    const { data } = await this.client.auth.getSession();
    await this.applySession(data && data.session ? data.session : null);
    this.client.auth.onAuthStateChange((event, session) => {
      // Defer database work out of the auth callback to avoid auth-lock issues.
      setTimeout(() => this.applySession(session), 0);
    });
    this.ready = true;
    this.bindAdminEvents();
    this.updateUI();
  },

  async applySession(session) {
    this.user = session ? session.user : null;
    this.profile = null;
    if (this.user && this.client) {
      const { data, error } = await this.client.from("profiles")
        .select("username, role, owner").eq("id", this.user.id).maybeSingle();
      if (!error) this.profile = data;
      else console.warn("AuthSystem: could not load profile", error.message);
    }
    this.updateUI();
    const chatPage = document.getElementById("menu-page-chat");
    if (chatPage && chatPage.classList.contains("is-open") && typeof ChatSystem !== "undefined") ChatSystem.open();
  },

  role() { return (this.profile && this.profile.role) || "user"; },
  isOwner() { return !!(this.profile && this.profile.owner); },
  roleLabel(role) {
    if (role === "developer" && this.isOwner()) return "Owner";
    return ({ user: "User", tester: "Tester", moderator: "Moderator", developer: "Developer" })[role] || "User";
  },
  canUseConsole() { return ["tester", "moderator", "developer"].includes(this.role()) || this.isOwner(); },
  isStaff() { return this.role() === "moderator" || this.role() === "developer" || this.isOwner(); },
  canModerate() { return this.isStaff(); },
  canAdmin() { return this.role() === "developer" || this.isOwner(); },

  async listUsers(q) {
    if (!this.canAdmin()) throw new Error("Only developers and the owner can manage roles.");
    if (!this.client) throw new Error("Supabase is not connected.");
    const { data, error } = await this.client.rpc("admin_list_profiles", { p_search: q || "" });
    if (error) throw error;
    return data || [];
  },

  async setRoles(usernames, role) {
    if (!this.canAdmin()) throw new Error("Only developers and the owner can manage roles.");
    if (!["user", "tester", "moderator", "developer"].includes(role)) throw new Error("Invalid role.");
    if (role === "developer" && !this.isOwner()) throw new Error("Only the owner can promote developers.");
    if (!this.client) throw new Error("Supabase is not connected.");
    const { data, error } = await this.client.rpc("admin_set_profile_roles", {
      p_usernames: usernames,
      p_role: role
    });
    if (error) throw error;
    return data || [];
  },

  username() {
    return (this.profile && this.profile.username) ||
      (this.user && this.user.user_metadata && this.user.user_metadata.username) ||
      (this.user && this.user.email ? this.user.email.split("@")[0] : "Guest");
  },

  async signUp(email, password, username) {
    if (!this.client) throw new Error("Supabase is not configured yet.");
    username = username.trim();
    if (username.length < 3 || username.length > 20) throw new Error("Username must be 3–20 characters.");
    if (!/^[A-Za-z0-9_]+$/.test(username)) throw new Error("Username may contain letters, numbers, and underscores only.");
    const { data, error } = await this.client.auth.signUp({
      email: email.trim(), password, options: { data: { username } }
    });
    if (error) throw error;
    if (data.user) {
      const { error: profileError } = await this.client.from("profiles").upsert({
        id: data.user.id, username, role: "user", owner: false
      });
      if (profileError) console.warn("AuthSystem: profile creation will need to be retried", profileError.message);
    }
    if (data.session) await this.applySession(data.session);
    return data;
  },

  async signIn(email, password) {
    if (!this.client) throw new Error("Supabase is not configured yet.");
    const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    await this.applySession(data.session);
    return data;
  },

  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.profile = null;
    if (typeof ChatSystem !== "undefined") { ChatSystem.teardownSubscriptions(); ChatSystem.showSignedOut(); }
    this.updateUI();
  },

  async recordRun(result) {
    if (!this.client || !this.user) return;
    const payload = {
      user_id: this.user.id, level: Number(result.level || 0),
      outcome: result.outcome || "complete", time_seconds: Number(result.time || 0),
      distance_meters: Number(result.distance || 0), seed: String(result.seed || "")
    };
    const { error } = await this.client.from("runs").insert(payload);
    if (error) console.warn("AuthSystem: could not save run", error);
  },

  openModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "flex";
    const status = document.getElementById("auth-status");
    if (status) status.textContent = this.client ? "" : "Supabase is not configured yet — guest mode is available.";
  },
  closeModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "none";
  },

  async loadStats() {
    if (!this.client || !this.user) return { count: 0, time: 0, dist: 0, max: 0, runs: [] };
    const { data } = await this.client.from("runs").select("level, outcome, time_seconds, distance_meters")
      .eq("user_id", this.user.id).order("id", { ascending: false }).limit(10);
    const runs = data || [];
    const { data: all } = await this.client.from("runs").select("level, time_seconds, distance_meters").eq("user_id", this.user.id);
    const rows = all || [];
    return {
      count: rows.length, time: rows.reduce((s, r) => s + (r.time_seconds || 0), 0),
      dist: rows.reduce((s, r) => s + (r.distance_meters || 0), 0),
      max: rows.reduce((m, r) => Math.max(m, r.level || 0), 0), runs
    };
  },
  fmt(s) { const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? h + "h " + (m % 60) + "m" : m + "m " + Math.floor(s % 60) + "s"; },

  bindAdminEvents() {
    if (this._adminEventsBound) return;
    this._adminEventsBound = true;
    const load = async (q) => {
      const list = document.getElementById("admin-list");
      const status = document.getElementById("admin-status");
      if (!list) return;
      try {
        const rows = await this.listUsers(q);
        list.replaceChildren();
        rows.forEach((r) => {
          const label = document.createElement("label");
          label.style.display = "block";
          const check = document.createElement("input");
          check.type = "checkbox"; check.value = r.username;
          const name = document.createTextNode(" " + r.username + " ");
          const role = document.createElement("em");
          role.textContent = "(" + (r.owner ? "Owner" : this.roleLabel(r.role)) + ")";
          label.append(check, name, role); list.appendChild(label);
        });
        if (status) status.textContent = rows.length ? "" : "No matching accounts.";
      } catch (err) { list.textContent = err.message || "Failed to load accounts."; }
    };
    const show = document.getElementById("admin-show");
    if (show) show.addEventListener("click", () => load(""));
    const search = document.getElementById("admin-search");
    if (search) search.addEventListener("input", () => load(search.value.trim()));
    const set = document.getElementById("admin-set");
    if (set) set.addEventListener("click", async () => {
      const list = document.getElementById("admin-list");
      const names = list ? [...list.querySelectorAll("input:checked")].map(c => c.value) : [];
      const role = document.getElementById("admin-role").value;
      const status = document.getElementById("admin-status");
      if (!names.length) { if (status) status.textContent = "Select at least one account."; return; }
      try {
        const result = await this.setRoles(names, role);
        if (status) status.textContent = result.length + " account(s) set to " + this.roleLabel(role) + ".";
        await load(search ? search.value.trim() : "");
      } catch (err) { if (status) status.textContent = err.message || "Role update failed."; }
    });
  },

  updateUI() {
    const login = document.getElementById("auth-login");
    const signed = document.getElementById("auth-signed");
    const shell = document.getElementById("admin-shell");
    if (login) login.style.display = this.user ? "none" : "block";
    if (signed) signed.style.display = this.user ? "block" : "none";
    if (shell) shell.style.display = this.canAdmin() ? "block" : "none";
    if (this.user) {
      const hello = document.getElementById("auth-hello");
      if (hello) hello.textContent = "Logged in as " + this.username() + " · " + (this.isOwner() ? "Owner" : this.roleLabel(this.role()));
      this.loadStats().then(s => {
        const box = document.getElementById("auth-stats");
        if (box) box.innerHTML = "<div>Runs</div><b>" + s.count + "</b><div>Time</div><b>" + this.fmt(s.time) + "</b><div>Distance</div><b>" + Math.round(s.dist) + " m</b><div>Furthest</div><b>Level " + s.max + "</b><div>Id</div><b style='font-size:11px'>" + this.user.id.slice(0, 8) + "</b>";
        const list = document.getElementById("auth-runs");
        if (list) list.innerHTML = s.runs.map(r => {
          const ok = r.outcome === "complete";
          return '<div class="run-row"><span>Level ' + r.level + '</span><span>' + this.fmt(r.time_seconds || 0) + '</span><span class="' + (ok ? "run-ok" : "run-fail") + '">' + (ok ? "COMPLETE" : "GAME OVER") + '</span></div>';
        }).join("") || "<div>No runs yet</div>";
      });
    }
    const label = document.getElementById("account-label");
    if (label) label.textContent = this.user ? this.username() : "Account";
    const signOut = document.getElementById("auth-signout");
    if (signOut) signOut.style.display = this.user ? "inline-block" : "none";
    document.querySelectorAll("[data-auth-action]").forEach(btn => btn.style.display = this.user ? "none" : "inline-block");
  }
};

window.addEventListener("load", () => AuthSystem.init());
window.addEventListener("DOMContentLoaded", () => {
  const account = document.getElementById("account-button");
  if (account) account.addEventListener("click", () => AuthSystem.openModal());
  const close = document.getElementById("auth-close");
  if (close) close.addEventListener("click", () => AuthSystem.closeModal());
  const modal = document.getElementById("auth-modal");
  const panel = document.getElementById("auth-panel");
  // Clicking the dimmed backdrop closes the account panel; clicks inside do not.
  if (modal) modal.addEventListener("click", (event) => {
    if (event.target === modal) AuthSystem.closeModal();
  });
  if (panel) panel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && modal.style.display !== "none") {
      AuthSystem.closeModal();
    }
  });
  const form = document.getElementById("auth-form");
  if (form) form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = document.getElementById("auth-mode").value;
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    const username = document.getElementById("auth-username").value;
    const status = document.getElementById("auth-status");
    try {
      status.textContent = "Working...";
      if (mode === "signup") {
        await AuthSystem.signUp(email, password, username);
        status.textContent = "Account created. Check your email if confirmation is enabled.";
      } else {
        await AuthSystem.signIn(email, password);
        status.textContent = "Signed in.";
      }
    } catch (err) { status.textContent = err && err.message ? err.message : "Authentication failed."; }
  });
  const mode = document.getElementById("auth-mode");
  const usernameWrap = document.getElementById("auth-username-wrap");
  const submit = document.getElementById("auth-submit");
  const refreshMode = () => {
    if (!mode || !usernameWrap || !submit) return;
    const signup = mode.value === "signup";
    usernameWrap.style.display = signup ? "block" : "none";
    submit.textContent = signup ? "Create account" : "Sign in";
  };
  if (mode) { mode.addEventListener("change", refreshMode); refreshMode(); }
  const signOut = document.getElementById("auth-signout");
  if (signOut) signOut.addEventListener("click", async () => {
    try { await AuthSystem.signOut(); } catch (err) { console.warn(err); }
  });
});
