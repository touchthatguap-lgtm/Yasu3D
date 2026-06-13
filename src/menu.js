import { WEAPONS, weaponsForSlot } from "./weapons.js";
import { Lobby, generateCode } from "./lobby.js";
import { supabaseReady } from "./supabase.js";
import { GunPreview } from "./gunPreview.js";

// Full-screen tabbed menu:
//   Play tab    -> name, big Play / Create / Join buttons
//   Loadout tab -> Primary/Secondary sub-tabs, big spinning preview, gun picker
// Calls onDeploy({ primary, secondary }, lobby) when the player starts a match.
export class Menu {
  constructor({ onDeploy }) {
    this.onDeploy = onDeploy;
    this.loadout = {
      primary: weaponsForSlot("primary")[0]?.name,
      secondary: weaponsForSlot("secondary")[0]?.name,
    };
    this.playerName = "Player" + Math.floor(1000 + Math.random() * 9000);
    this.lobby = null;

    this.activeTab = "play";
    this.loadoutSlot = "primary";
    this.preview = null;
    this.previewCanvas = null;

    this._injectStyles();
    this.root = document.createElement("div");
    this.root.id = "menu";
    document.body.appendChild(this.root);
    this.showMain();
  }

  show() {
    this.root.style.display = "flex";
  }
  hide() {
    this.root.style.display = "none";
    if (this.preview) this.preview.stop();
  }

  // ------------------------------------------------------------- Main (tabbed)
  showMain() {
    this.root.innerHTML = `
      <div class="m-top">
        <div class="m-logo">YASU<span>3D</span></div>
        <div class="m-tabs">
          <button data-tab="play">Play</button>
          <button data-tab="loadout">Loadout</button>
        </div>
        <div class="m-spacer"></div>
      </div>
      <div class="m-content"></div>
    `;
    this.root.querySelectorAll(".m-tabs button").forEach((b) => {
      b.addEventListener("click", () => this._setTab(b.dataset.tab));
    });
    this._setTab(this.activeTab);
  }

  _setTab(tab) {
    this.activeTab = tab;
    this.root.querySelectorAll(".m-tabs button").forEach((b) =>
      b.classList.toggle("on", b.dataset.tab === tab)
    );
    if (tab === "play") {
      if (this.preview) this.preview.stop();
      this._renderPlay();
    } else {
      this._renderLoadout();
    }
  }

  // ------------------------------------------------------------- Play tab
  _renderPlay() {
    const content = this.root.querySelector(".m-content");
    content.innerHTML = `
      <div class="m-play">
        <div class="m-name">
          <label>NAME</label>
          <input id="m-name-input" maxlength="16" value="${escapeAttr(this.playerName)}" />
        </div>
        <button class="m-big m-go" id="m-solo">▶ PLAY<span class="m-sm">solo practice</span></button>
        <div class="m-or">— or play with friends —</div>
        <button class="m-big m-blue" id="m-create">＋ CREATE LOBBY</button>
        <div class="m-join">
          <input id="m-code" placeholder="ENTER CODE" maxlength="5" />
          <button class="m-big m-join-btn" id="m-join">JOIN</button>
        </div>
        ${supabaseReady ? "" : `<div class="m-warn">⚠ Supabase not configured — online lobbies disabled, solo only.</div>`}
      </div>
    `;
    content.querySelector("#m-name-input").addEventListener("input", (e) => {
      this.playerName = e.target.value.trim() || this.playerName;
    });
    content.querySelector("#m-solo").addEventListener("click", () => this._deploy(null));
    content.querySelector("#m-create").addEventListener("click", () => this._createLobby());
    content.querySelector("#m-join").addEventListener("click", () => {
      const code = content.querySelector("#m-code").value.trim().toUpperCase();
      if (code.length >= 4) this._joinLobby(code);
    });
    content.querySelector("#m-code").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }

  // ------------------------------------------------------------- Loadout tab
  _renderLoadout() {
    const content = this.root.querySelector(".m-content");
    content.innerHTML = `
      <div class="m-loadout">
        <div class="m-subtabs">
          <button data-slot="primary">PRIMARY</button>
          <button data-slot="secondary">SECONDARY</button>
        </div>
        <div class="m-preview-wrap">
          <div id="m-preview-slot"></div>
          <div class="m-preview-name" id="m-preview-name"></div>
        </div>
        <div class="m-guns" id="m-gunlist"></div>
      </div>
    `;

    content.querySelectorAll(".m-subtabs button").forEach((b) => {
      b.addEventListener("click", () => {
        this.loadoutSlot = b.dataset.slot;
        this._refreshLoadout();
      });
    });

    if (!this.preview) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.className = "m-preview";
      this.preview = new GunPreview(this.previewCanvas);
    }
    content.querySelector("#m-preview-slot").appendChild(this.previewCanvas);

    this._refreshLoadout();
    this.preview.start();
  }

  _refreshLoadout() {
    const slot = this.loadoutSlot;
    this.root.querySelectorAll(".m-subtabs button").forEach((b) =>
      b.classList.toggle("on", b.dataset.slot === slot)
    );

    const list = this.root.querySelector("#m-gunlist");
    if (!list) return;
    const guns = weaponsForSlot(slot);
    list.innerHTML = guns.map((w) => this._gunCard(w, slot)).join("");
    list.querySelectorAll(".m-gun").forEach((el) => {
      el.addEventListener("click", () => this._selectGun(slot, el.dataset.name));
    });

    this._loadPreview(this.loadout[slot]);
  }

  _selectGun(slot, name) {
    this.loadout[slot] = name;
    this.root
      .querySelectorAll(`.m-gun[data-slot="${slot}"]`)
      .forEach((x) => x.classList.toggle("sel", x.dataset.name === name));
    this._loadPreview(name);
  }

  _loadPreview(name) {
    const cfg = WEAPONS[name];
    if (!cfg || !this.preview) return;
    const nameEl = this.root.querySelector("#m-preview-name");
    if (nameEl) nameEl.textContent = cfg.displayName;
    this.preview.load(cfg);
  }

  _gunCard(w, slot) {
    const sel = this.loadout[slot] === w.name ? "sel" : "";
    const fire = w.automatic ? "Auto" : "Semi";
    return `
      <div class="m-gun ${sel}" data-slot="${slot}" data-name="${w.name}">
        <div class="m-gun-name">${escapeHtml(w.displayName)}</div>
        <div class="m-gun-stats">${w.bodyDamage} dmg · ${w.magSize} mag · ${fire}</div>
      </div>`;
  }

  // ------------------------------------------------------------- Lobby view
  async _createLobby() {
    const code = generateCode();
    this.lobby = new Lobby(code, this.playerName, { host: true });
    this.lobby.onChange = () => this._renderPlayers();
    this.showLobby();
    await this.lobby.join();
  }

  async _joinLobby(code) {
    this.lobby = new Lobby(code, this.playerName, { host: false });
    this.lobby.onChange = () => this._renderPlayers();
    this.showLobby();
    await this.lobby.join();
  }

  showLobby() {
    if (this.preview) this.preview.stop();
    const l = this.lobby;
    this.root.innerHTML = `
      <div class="m-top">
        <div class="m-logo">LOBBY</div>
        <div class="m-spacer"></div>
      </div>
      <div class="m-content">
        <div class="m-lobby">
          <div class="m-code-box">
            <div class="m-code-label">INVITE CODE</div>
            <div class="m-code">${l.code}</div>
            <button class="m-big m-copy" id="m-copy">⧉ COPY CODE</button>
          </div>
          <div class="m-lobby-right">
            <div class="m-h">PLAYERS (<span id="m-count">1</span>)</div>
            <div class="m-players" id="m-players"></div>
            ${l.online ? "" : `<div class="m-warn">⚠ Offline lobby — others can't join without Supabase configured.</div>`}
          </div>
        </div>
        <div class="m-lobby-actions">
          <button class="m-big" id="m-leave">← LEAVE</button>
          <button class="m-big m-blue" id="m-deploy">🚀 DEPLOY</button>
        </div>
      </div>
    `;
    this.root.querySelector("#m-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(l.code);
      const b = this.root.querySelector("#m-copy");
      b.textContent = "✅ COPIED!";
      setTimeout(() => (b.textContent = "⧉ COPY CODE"), 1500);
    });
    this.root.querySelector("#m-leave").addEventListener("click", () => {
      this.lobby.leave();
      this.lobby = null;
      this.showMain();
    });
    this.root.querySelector("#m-deploy").addEventListener("click", () => {
      this._deploy(this.lobby);
    });
    this._renderPlayers();
  }

  _renderPlayers() {
    const box = this.root.querySelector("#m-players");
    if (!box || !this.lobby) return;
    const players = this.lobby.players;
    this.root.querySelector("#m-count").textContent = String(players.length);
    box.innerHTML = players
      .map(
        (p) => `
        <div class="m-player">
          <span class="m-dot"></span>
          <span class="m-pname">${escapeHtml(p.name)}${p.self ? " (you)" : ""}</span>
          ${p.host ? `<span class="m-host">HOST</span>` : ""}
        </div>`
      )
      .join("");
  }

  _deploy(lobby) {
    this.hide();
    this.onDeploy({ ...this.loadout }, lobby);
  }

  // ------------------------------------------------------------- Styles
  _injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #menu {
        position: fixed; inset: 0; z-index: 30;
        display: flex; flex-direction: column;
        background: radial-gradient(circle at 50% 25%, rgba(20,30,48,0.82), rgba(8,11,18,0.97));
        font-family: ui-monospace, "Cascadia Code", Menlo, monospace; color: #e6edf3;
        backdrop-filter: blur(3px);
      }

      /* Header bar */
      #menu .m-top {
        display: flex; align-items: center; gap: 24px;
        padding: 22px 40px; border-bottom: 1px solid #1c2738;
        background: rgba(10,13,20,0.5);
      }
      #menu .m-logo { font-size: 34px; font-weight: 800; letter-spacing: 4px; }
      #menu .m-logo span { color: #4c9aff; }
      #menu .m-spacer { flex: 1; }
      #menu .m-tabs { display: flex; gap: 10px; }
      #menu .m-tabs button {
        padding: 12px 34px; border: 1px solid #2a3a52; border-radius: 10px; cursor: pointer;
        background: rgba(13,17,23,0.6); color: #8b949e; font-family: inherit; font-weight: 700; font-size: 17px;
      }
      #menu .m-tabs button:hover { border-color: #4c9aff; color: #cfe0ff; }
      #menu .m-tabs button.on { background: #1f6feb; color: #fff; border-color: #1f6feb; }

      /* Content area */
      #menu .m-content {
        flex: 1; min-height: 0; overflow-y: auto;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 30px 40px;
      }

      /* Big buttons */
      #menu .m-big {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 20px 28px; border: 1px solid #2a3a52; border-radius: 14px; cursor: pointer;
        background: #21262d; color: #e6edf3; font-family: inherit; font-weight: 800; font-size: 22px;
        letter-spacing: 1px; transition: .12s; width: 100%;
      }
      #menu .m-big:hover { border-color: #4c9aff; transform: translateY(-2px); }
      #menu .m-big .m-sm { font-size: 12px; font-weight: 600; color: #b9c6d6; letter-spacing: 0; margin-top: 4px; }
      #menu .m-blue { background: #1f6feb; border-color: #1f6feb; }
      #menu .m-go { background: linear-gradient(180deg,#2ea043,#1f7a33); border-color: #2ea043; }

      /* Play tab */
      #menu .m-play { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 14px; }
      #menu .m-name { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
      #menu .m-name label { color: #8b949e; font-size: 13px; letter-spacing: 1px; }
      #menu input {
        background: #0d1117; color: #e6edf3; border: 1px solid #2a3a52; border-radius: 10px;
        padding: 14px 16px; font-family: inherit; font-size: 16px; flex: 1;
      }
      #menu .m-or { text-align: center; color: #6f7d8c; font-size: 12px; margin: 6px 0; }
      #menu .m-join { display: flex; gap: 12px; }
      #menu .m-join input { text-transform: uppercase; letter-spacing: 4px; text-align: center; font-weight: 800; font-size: 20px; }
      #menu .m-join-btn { width: auto; padding-left: 40px; padding-right: 40px; }
      #menu .m-warn { color: #e3b341; font-size: 12px; text-align: center; margin-top: 8px; }

      /* Loadout tab */
      #menu .m-loadout { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 16px; }
      #menu .m-subtabs { display: flex; gap: 12px; justify-content: center; }
      #menu .m-subtabs button {
        padding: 12px 40px; border: 1px solid #2a3a52; border-radius: 10px; cursor: pointer;
        background: #0d1117; color: #8b949e; font-family: inherit; font-weight: 800; font-size: 16px; letter-spacing: 1px;
      }
      #menu .m-subtabs button.on { background: #11233f; color: #fff; border-color: #4c9aff; }
      #menu .m-preview-wrap {
        position: relative; background: radial-gradient(circle at 50% 35%, #16202e, #0b0e14);
        border: 1px solid #1f2a3a; border-radius: 14px; overflow: hidden;
      }
      #menu .m-preview { width: 100%; height: 44vh; min-height: 260px; display: block; }
      #menu .m-preview-name {
        position: absolute; bottom: 14px; left: 0; right: 0; text-align: center;
        font-weight: 800; font-size: 22px; color: #cfe0ff; text-shadow: 0 2px 8px #000;
      }
      #menu .m-guns { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
      #menu .m-gun { background: #0d1117; border: 1px solid #2a3a52; border-radius: 12px; padding: 16px; cursor: pointer; transition: .12s; }
      #menu .m-gun:hover { border-color: #4c9aff; transform: translateY(-2px); }
      #menu .m-gun.sel { border-color: #4c9aff; background: #11233f; box-shadow: 0 0 0 2px #4c9aff inset; }
      #menu .m-gun-name { font-weight: 800; font-size: 16px; }
      #menu .m-gun-stats { color: #8b949e; font-size: 12px; margin-top: 6px; }

      /* Lobby */
      #menu .m-lobby { width: 100%; max-width: 820px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      #menu .m-code-box { text-align: center; background: #0d1117; border: 1px solid #2a3a52; border-radius: 14px; padding: 28px; }
      #menu .m-code-label { color: #8b949e; font-size: 13px; letter-spacing: 3px; }
      #menu .m-code { font-size: 56px; font-weight: 800; letter-spacing: 12px; color: #4c9aff; margin: 14px 0 18px; }
      #menu .m-lobby-right { background: #0d1117; border: 1px solid #2a3a52; border-radius: 14px; padding: 22px; }
      #menu .m-h { color: #7aa7ff; font-size: 13px; letter-spacing: 2px; margin-bottom: 12px; border-bottom: 1px solid #1f2a3a; padding-bottom: 6px; }
      #menu .m-players { display: flex; flex-direction: column; gap: 8px; }
      #menu .m-player { display: flex; align-items: center; gap: 10px; background: #11161d; border: 1px solid #1f2a3a; border-radius: 8px; padding: 12px 14px; }
      #menu .m-dot { width: 9px; height: 9px; border-radius: 50%; background: #2ea043; box-shadow: 0 0 8px #2ea043; }
      #menu .m-pname { flex: 1; font-size: 15px; }
      #menu .m-host { color: #e3b341; font-size: 11px; font-weight: 700; }
      #menu .m-lobby-actions { width: 100%; max-width: 820px; display: flex; gap: 16px; margin-top: 22px; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return escapeHtml(s);
}
