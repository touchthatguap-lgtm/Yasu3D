import { register, login, validateUsername, supabaseReady } from "./auth.js";

// Full-screen login / register gate shown before the menu. You must have an
// account (and be signed in) to reach the game. Calls onAuthed(username) on
// success — main.js then reveals the menu.
export class AuthScreen {
  constructor({ onAuthed }) {
    this.onAuthed = onAuthed;
    this.mode = "login"; // "login" | "register"
    this.busy = false;

    this._injectStyles();
    this.root = document.createElement("div");
    this.root.id = "auth";
    this.root.style.display = "none";
    document.body.appendChild(this.root);
    this._render();
  }

  show() {
    this.root.style.display = "flex";
    const u = this.root.querySelector("#a-user");
    if (u) u.focus();
  }
  hide() {
    this.root.style.display = "none";
  }

  _setMode(mode) {
    this.mode = mode;
    this._render();
  }

  _render() {
    const reg = this.mode === "register";
    this.root.innerHTML = `
      <div class="a-card">
        <div class="a-logo">YASU<span>3D</span></div>
        <div class="a-sub">${reg ? "create an account to play" : "sign in to play"}</div>
        <div class="a-tabs">
          <button data-mode="login" class="${reg ? "" : "on"}">Log in</button>
          <button data-mode="register" class="${reg ? "on" : ""}">Register</button>
        </div>
        <form class="a-form" autocomplete="on">
          <label>USERNAME</label>
          <input id="a-user" autocomplete="username" maxlength="16" placeholder="3–16 letters, numbers, _" />
          <label>PASSWORD</label>
          <input id="a-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="at least 6 characters" />
          ${reg ? `<label>CONFIRM PASSWORD</label><input id="a-pass2" type="password" autocomplete="new-password" placeholder="re-enter password" />` : ""}
          <button type="submit" class="a-go">${reg ? "✦ CREATE ACCOUNT" : "▶ LOG IN"}</button>
        </form>
        <div class="a-msg"></div>
        ${
          supabaseReady
            ? ""
            : `<div class="a-msg err">⚠ Supabase isn't configured — accounts can't be created. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart the dev server.</div>`
        }
        <div class="a-foot">${reg ? "Already have an account? <a data-mode=\"login\">Log in</a>" : "New here? <a data-mode=\"register\">Create an account</a>"}</div>
      </div>
    `;

    this.root.querySelectorAll("[data-mode]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        this._setMode(el.dataset.mode);
      })
    );
    this.root.querySelector(".a-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this._submit();
    });

    const u = this.root.querySelector("#a-user");
    if (this.root.style.display !== "none") u.focus();
  }

  _msg(text, err = false) {
    const el = this.root.querySelector(".a-msg");
    if (el) {
      el.textContent = text;
      el.className = "a-msg " + (err ? "err" : "ok");
    }
  }

  async _submit() {
    if (this.busy) return;
    if (!supabaseReady) return this._msg("Supabase isn't configured — can't sign in.", true);

    const reg = this.mode === "register";
    const username = this.root.querySelector("#a-user").value.trim();
    const password = this.root.querySelector("#a-pass").value;

    const vErr = validateUsername(username);
    if (vErr) return this._msg(vErr, true);
    if (password.length < 6) return this._msg("Password must be at least 6 characters.", true);
    if (reg) {
      const p2 = this.root.querySelector("#a-pass2").value;
      if (password !== p2) return this._msg("Passwords don't match.", true);
    }

    this.busy = true;
    this._msg(reg ? "Creating account…" : "Signing in…");
    try {
      if (reg) {
        const data = await register(username, password);
        // If confirmation is disabled we already have a session; otherwise a
        // sign-in attempt surfaces the "confirm email" error with guidance.
        if (!data.session) await login(username, password);
      } else {
        await login(username, password);
      }
      this._msg(`✅ Welcome, ${username}!`);
      this.onAuthed(username);
    } catch (err) {
      this._msg(translateError(err), true);
    } finally {
      this.busy = false;
    }
  }

  _injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #auth {
        position: fixed; inset: 0; z-index: 60;
        display: none; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 25%, rgba(20,30,48,0.9), rgba(8,11,18,0.98));
        font-family: ui-monospace, "Cascadia Code", Menlo, monospace; color: #e6edf3;
        backdrop-filter: blur(4px);
      }
      #auth .a-card {
        width: 100%; max-width: 380px; margin: 20px;
        background: rgba(13,17,23,0.92); border: 1px solid #2a3a52; border-radius: 16px;
        padding: 34px 30px; box-shadow: 0 20px 60px rgba(0,0,0,0.55);
        display: flex; flex-direction: column;
      }
      #auth .a-logo { font-size: 40px; font-weight: 800; letter-spacing: 4px; text-align: center; }
      #auth .a-logo span { color: #4c9aff; }
      #auth .a-sub { text-align: center; color: #8b949e; font-size: 13px; margin: 6px 0 22px; }
      #auth .a-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
      #auth .a-tabs button {
        flex: 1; padding: 11px; border: 1px solid #2a3a52; border-radius: 9px; cursor: pointer;
        background: #0d1117; color: #8b949e; font-family: inherit; font-weight: 700; font-size: 14px;
      }
      #auth .a-tabs button:hover { border-color: #4c9aff; color: #cfe0ff; }
      #auth .a-tabs button.on { background: #1f6feb; color: #fff; border-color: #1f6feb; }
      #auth .a-form { display: flex; flex-direction: column; }
      #auth label { color: #8b949e; font-size: 11px; letter-spacing: 1px; margin: 10px 0 5px; }
      #auth input {
        background: #0d1117; color: #e6edf3; border: 1px solid #2a3a52; border-radius: 9px;
        padding: 13px 14px; font-family: inherit; font-size: 15px;
      }
      #auth input:focus { outline: none; border-color: #4c9aff; }
      #auth .a-go {
        margin-top: 20px; padding: 15px; border: none; border-radius: 11px; cursor: pointer;
        background: linear-gradient(180deg,#2ea043,#1f7a33); color: #fff;
        font-family: inherit; font-weight: 800; font-size: 17px; letter-spacing: 1px;
      }
      #auth .a-go:hover { filter: brightness(1.08); }
      #auth .a-msg { min-height: 18px; margin-top: 14px; font-size: 13px; text-align: center; }
      #auth .a-msg.ok { color: #7ee787; }
      #auth .a-msg.err { color: #ff7b72; }
      #auth .a-foot { text-align: center; color: #6f7d8c; font-size: 12px; margin-top: 16px; }
      #auth .a-foot a { color: #4c9aff; cursor: pointer; text-decoration: none; }
      #auth .a-foot a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(s);
  }
}

function translateError(err) {
  const m = (err && err.message) || String(err);
  if (/already registered|already exists|user_already/i.test(m))
    return "That username is taken — try logging in instead.";
  if (/invalid login credentials/i.test(m)) return "Wrong username or password.";
  if (/email not confirmed/i.test(m))
    return "Email confirmation must be disabled in Supabase (Authentication → Providers → Email → turn off “Confirm email”).";
  if (/rate limit|too many/i.test(m)) return "Too many attempts — wait a moment and try again.";
  return m;
}
