import { WEAPONS, weaponsForSlot } from "./weapons.js";
import { Lobby, generateCode } from "./lobby.js";
import { supabaseReady } from "./supabase.js";
import { GunPreview } from "./gunPreview.js";
import { CHARACTERS, characterList } from "./characters.js";
import {
  getCurrentUser,
  loadoutFromUser,
  saveLoadout,
  characterFromUser,
  saveCharacter,
} from "./auth.js";

// Full-screen tabbed menu:
//   Play tab    -> name, big Play / Create / Join buttons
//   Loadout tab -> Primary/Secondary sub-tabs, big spinning preview, gun picker
// Calls onDeploy({ primary, secondary }, lobby) when the player starts a match.
export class Menu {
  constructor({ onDeploy, onOpenMapEditor, onLogout }) {
    this.onDeploy = onDeploy;
    this.onOpenMapEditor = onOpenMapEditor;
    this.onLogout = onLogout;
    this.mapName = null; // null = default arena
    this.loadout = {
      primary: weaponsForSlot("primary")[0]?.name,
      secondary: weaponsForSlot("secondary")[0]?.name,
    };
    this.character = characterList()[0]?.name;
    // Set from the signed-in account via setPlayer(); this is just a fallback.
    this.playerName = "Player";
    // Whether the signed-in user may open the map editor (set by main.js).
    this.canEditMaps = false;
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

  // Bind the signed-in account's username as the in-game name. Re-renders the
  // header so it shows immediately.
  setPlayer(username) {
    this.playerName = username || "Player";
    const el = this.root.querySelector(".m-uname");
    if (el) el.textContent = this.playerName;
  }

  // Pull the loadout saved on the account and apply it (validating that each
  // weapon still exists and fits its slot). Called on login/session resume.
  async loadSavedLoadout() {
    const user = await getCurrentUser();

    const saved = loadoutFromUser(user);
    if (saved) {
      if (saved.primary && WEAPONS[saved.primary]?.slot === "primary") {
        this.loadout.primary = saved.primary;
      }
      if (saved.secondary && WEAPONS[saved.secondary]?.slot === "secondary") {
        this.loadout.secondary = saved.secondary;
      }
    }

    const char = characterFromUser(user);
    if (char && CHARACTERS[char]) this.character = char;

    // Reflect loaded selections if the relevant tab is already open.
    if (this.activeTab === "loadout") this._refreshLoadout();
    else if (this.activeTab === "characters") this._renderCharacters();
  }

  // ------------------------------------------------------------- Main (tabbed)
  showMain() {
    this.root.innerHTML = `
      <div class="m-top">
        <div class="m-logo">YASU<span>3D</span></div>
        <div class="m-tabs">
          <button data-tab="play">Play</button>
          <button data-tab="loadout">Loadout</button>
          <button data-tab="characters">Characters</button>
          ${this.canEditMaps ? `<button data-tab="editor">Map Editor</button>` : ""}
        </div>
        <div class="m-spacer"></div>
        <div class="m-user">
          <span class="m-uname">${escapeHtml(this.playerName)}</span>
          <button class="m-logout" title="Sign out">⏏ Sign out</button>
        </div>
      </div>
      <div class="m-content"></div>
    `;
    this.root.querySelectorAll(".m-tabs button").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.tab === "editor") {
          if (this.onOpenMapEditor) this.onOpenMapEditor();
          return;
        }
        this._setTab(b.dataset.tab);
      });
    });
    const logoutBtn = this.root.querySelector(".m-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", () => this.onLogout && this.onLogout());
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
    } else if (tab === "characters") {
      this._renderCharacters();
    } else {
      this._renderLoadout();
    }
  }

  // ------------------------------------------------------------- Play tab
  _renderPlay() {
    const content = this.root.querySelector(".m-content");
    content.innerHTML = `
      <div class="m-play">
        <button class="m-big m-go" id="m-solo">▶ PLAY<span class="m-sm">choose a map · solo practice</span></button>
        <div class="m-or">— or play with friends —</div>
        <button class="m-big m-blue" id="m-create">＋ CREATE LOBBY</button>
        <div class="m-join">
          <input id="m-code" placeholder="ENTER CODE" maxlength="5" />
          <button class="m-big m-join-btn" id="m-join">JOIN</button>
        </div>
        ${supabaseReady ? "" : `<div class="m-warn">⚠ Supabase not configured — online lobbies disabled, solo only.</div>`}
      </div>
    `;
    content.querySelector("#m-solo").addEventListener("click", () => this._showMapSelect("solo"));
    content.querySelector("#m-create").addEventListener("click", () => this._showMapSelect("lobby"));
    content.querySelector("#m-join").addEventListener("click", () => {
      const code = content.querySelector("#m-code").value.trim().toUpperCase();
      if (code.length >= 4) this._joinLobby(code);
    });
    content.querySelector("#m-code").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }

  // ----------------------------------------------------------- Map select step
  // Shown after clicking Play / Create Lobby. Picking a map launches that mode.
  //   mode: "solo"  -> deploy solo on the chosen map
  //         "lobby" -> create a lobby (host plays the chosen map)
  async _showMapSelect(mode) {
    const content = this.root.querySelector(".m-content");
    content.innerHTML = `
      <div class="m-mapsel">
        <div class="m-mapsel-head">
          <button class="m-back" id="m-mapback">← Back</button>
          <div class="m-mapsel-title">CHOOSE A MAP</div>
        </div>
        <div class="m-maps-grid" id="m-maps-grid">
          ${this._mapCard("", "Default Arena", "built-in")}
        </div>
      </div>
    `;
    content.querySelector("#m-mapback").addEventListener("click", () => this._setTab("play"));

    // Append saved maps from the static manifest (works in dev and production).
    let maps = [];
    try {
      maps = (await (await fetch(`/maps/index.json?t=${Date.now()}`)).json()) || [];
    } catch {
      // No manifest yet — only the default arena is available.
    }
    const grid = content.querySelector("#m-maps-grid");
    if (!grid) return; // user navigated away while the list was loading
    for (const m of maps) {
      grid.insertAdjacentHTML("beforeend", this._mapCard(m, m, "custom"));
    }

    grid.querySelectorAll(".m-map-card").forEach((card) =>
      card.addEventListener("click", () => {
        this.mapName = card.dataset.map || null;
        if (mode === "lobby") this._createLobby();
        else this._deploy(null);
      })
    );
  }

  _mapCard(value, name, sub) {
    const sel = (this.mapName || "") === value ? "sel" : "";
    return `
      <div class="m-map-card ${sel}" data-map="${escapeAttr(value)}">
        <div class="m-map-play">▶ PLAY</div>
        <div class="m-map-cname">${escapeHtml(name)}</div>
        <div class="m-map-csub">${escapeHtml(sub)}</div>
      </div>`;
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
    saveLoadout({ ...this.loadout }); // persist to the account
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

  // ------------------------------------------------------------- Characters tab
  _renderCharacters() {
    const content = this.root.querySelector(".m-content");
    content.innerHTML = `
      <div class="m-loadout">
        <div class="m-preview-wrap">
          <div id="m-preview-slot"></div>
          <div class="m-preview-name" id="m-preview-name"></div>
        </div>
        <div class="m-guns" id="m-charlist"></div>
      </div>
    `;

    if (!this.preview) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.className = "m-preview";
      this.preview = new GunPreview(this.previewCanvas);
    }
    content.querySelector("#m-preview-slot").appendChild(this.previewCanvas);

    const list = content.querySelector("#m-charlist");
    list.innerHTML = characterList().map((c) => this._charCard(c)).join("");
    list.querySelectorAll(".m-gun").forEach((el) => {
      el.addEventListener("click", () => this._selectCharacter(el.dataset.name));
    });

    this._loadCharPreview(this.character);
    this.preview.start();
  }

  _selectCharacter(name) {
    this.character = name;
    this.root
      .querySelectorAll("#m-charlist .m-gun")
      .forEach((x) => x.classList.toggle("sel", x.dataset.name === name));
    this._loadCharPreview(name);
    saveCharacter(name); // persist to the account
  }

  _loadCharPreview(name) {
    const cfg = CHARACTERS[name];
    if (!cfg || !this.preview) return;
    const nameEl = this.root.querySelector("#m-preview-name");
    if (nameEl) nameEl.textContent = cfg.displayName;
    this.preview.load(cfg);
  }

  _charCard(c) {
    const sel = this.character === c.name ? "sel" : "";
    return `
      <div class="m-gun ${sel}" data-name="${c.name}">
        <div class="m-gun-name">${escapeHtml(c.displayName)}</div>
        <div class="m-gun-stats">character</div>
      </div>`;
  }

  // ------------------------------------------------------------- Lobby view
  async _createLobby() {
    const code = generateCode();
    this.lobby = new Lobby(code, this.playerName, { host: true, map: this.mapName });
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
            <div class="m-lobby-map">MAP · <span id="m-lobby-mapname">Default Arena</span></div>
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

    // Everyone plays the host's map: joiners follow the host's selection.
    const hostP = players.find((p) => p.host);
    if (hostP && !this.lobby.host) this.mapName = hostP.map || null;
    const mapEl = this.root.querySelector("#m-lobby-mapname");
    if (mapEl) mapEl.textContent = this.mapName || "Default Arena";
  }

  _deploy(lobby) {
    this.hide();
    this.onDeploy({ ...this.loadout }, lobby, this.mapName, this.character);
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
      #menu .m-user { display: flex; align-items: center; gap: 12px; }
      #menu .m-uname { font-weight: 700; font-size: 15px; color: #cfe0ff; }
      #menu .m-logout {
        padding: 8px 16px; border: 1px solid #2a3a52; border-radius: 9px; cursor: pointer;
        background: rgba(13,17,23,0.6); color: #8b949e; font-family: inherit; font-weight: 700; font-size: 13px;
      }
      #menu .m-logout:hover { border-color: #ff7b72; color: #ff7b72; }

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

      /* Map select step */
      #menu .m-mapsel { width: 100%; max-width: 760px; display: flex; flex-direction: column; gap: 20px; }
      #menu .m-mapsel-head { display: flex; align-items: center; gap: 16px; }
      #menu .m-mapsel-title { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #cfe0ff; }
      #menu .m-back {
        padding: 10px 18px; border: 1px solid #2a3a52; border-radius: 9px; cursor: pointer;
        background: rgba(13,17,23,0.6); color: #8b949e; font-family: inherit; font-weight: 700; font-size: 14px;
      }
      #menu .m-back:hover { border-color: #4c9aff; color: #cfe0ff; }
      #menu .m-maps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
      #menu .m-map-card {
        position: relative; background: #0d1117; border: 1px solid #2a3a52; border-radius: 14px;
        padding: 22px 18px; min-height: 96px; cursor: pointer; transition: .12s;
        display: flex; flex-direction: column; justify-content: center;
      }
      #menu .m-map-card:hover { border-color: #4c9aff; transform: translateY(-2px); }
      #menu .m-map-card.sel { border-color: #4c9aff; box-shadow: 0 0 0 2px #4c9aff inset; }
      #menu .m-map-cname { font-weight: 800; font-size: 18px; }
      #menu .m-map-csub { color: #8b949e; font-size: 12px; margin-top: 6px; }
      #menu .m-map-play {
        position: absolute; top: 14px; right: 16px; color: #2ea043; font-weight: 800; font-size: 13px;
        opacity: 0; transition: .12s;
      }
      #menu .m-map-card:hover .m-map-play { opacity: 1; }

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
      #menu .m-lobby-map { margin-top: 16px; color: #8b949e; font-size: 13px; letter-spacing: 1px; }
      #menu .m-lobby-map span { color: #cfe0ff; font-weight: 700; }
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
