/* Backrooms Runner — Supabase authentication + run persistence.
 * IMPORTANT: replace the two values below with your Supabase project's
 * Project URL and anon/publishable key. Never put a service-role key here.
 */
"use strict";

const SUPABASE_CONFIG = {
  url: "https://lccastfpjhjvcndbcwzy.supabase.co/rest/v1/",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjY2FzdGZwamhqdmNuZGJjd3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjg2NTEsImV4cCI6MjEwMzk0NDY1MX0.AO6-wVPLLZw_Ztsdg5oYEeJffIOI4RnFbtS4SwNTTbk"
};

const AuthSystem = {
  client: null,
  user: null,
  profile: null,
  ready: false,

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
    this.updateUI();
  },

  async applySession(session) {
    this.user = session ? session.user : null;
    this.profile = null;

    if (this.user && this.client) {
      const { data, error } = await this.client
        .from("profiles")
        .select("username")
        .eq("id", this.user.id)
        .maybeSingle();
      if (!error) this.profile = data;
    }

    this.updateUI();
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
      email: email.trim(),
      password,
      options: { data: { username } }
    });
    if (error) throw error;

    // If email confirmation is disabled, a session may already exist.
    if (data.session) await this.applySession(data.session);
    return data;
  },

  async signIn(email, password) {
    if (!this.client) throw new Error("Supabase is not configured yet.");
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(), password
    });
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
    this.updateUI();
  },

  async recordRun(result) {
    if (!this.client || !this.user) return;
    const payload = {
      user_id: this.user.id,
      level: Number(result.level || 0),
      outcome: result.outcome || "complete",
      time_seconds: Number(result.time || 0),
      distance_meters: Number(result.distance || 0),
      seed: String(result.seed || "")
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

  updateUI() {
    const label = document.getElementById("account-label");
    if (label) label.textContent = this.user ? this.username() : "Account";
    const signOut = document.getElementById("auth-signout");
    if (signOut) signOut.style.display = this.user ? "inline-block" : "none";
    const authButtons = document.querySelectorAll("[data-auth-action]");
    authButtons.forEach(btn => btn.style.display = this.user ? "none" : "inline-block");
  }
};

window.addEventListener("load", () => AuthSystem.init());

window.addEventListener("DOMContentLoaded", () => {
  const account = document.getElementById("account-button");
  if (account) account.addEventListener("click", () => AuthSystem.openModal());

  const close = document.getElementById("auth-close");
  if (close) close.addEventListener("click", () => AuthSystem.closeModal());

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
    } catch (err) {
      status.textContent = err && err.message ? err.message : "Authentication failed.";
    }
  });

  const mode = document.getElementById("auth-mode");
  const usernameWrap = document.getElementById("auth-username-wrap");
  const submit = document.getElementById("auth-submit");
  const refreshMode = () => {
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
