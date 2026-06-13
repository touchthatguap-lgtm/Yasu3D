import { supabase, supabaseReady } from "./supabase.js";

// Lobby over Supabase Realtime presence. Each lobby code maps to one Realtime
// channel; everyone who joins the same code sees each other in the player list.
// Falls back to a local solo lobby if Supabase isn't configured.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)

export function generateCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function randomId() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export class Lobby {
  constructor(code, playerName, { host = false } = {}) {
    this.code = code;
    this.playerName = playerName;
    this.host = host;
    this.id = randomId();
    this.players = []; // [{ id, name, host, self }]
    this.channel = null;
    this.onChange = null; // (players) => void, when the player list changes
    this.onState = null;  // (payload) => void, a remote player's movement
    this.onShot = null;   // (payload) => void, a remote player fired
    this.onHit = null;    // (payload) => void, someone was hit
    this.onDeath = null;  // (payload) => void, someone died
    this.online = supabaseReady;
  }

  async join() {
    if (!this.online) {
      // Offline / no Supabase: solo lobby so the user can still deploy.
      this.players = [{ id: this.id, name: this.playerName, host: true, self: true }];
      this._emit();
      return;
    }

    this.channel = supabase.channel(`lobby-${this.code}`, {
      config: { presence: { key: this.id }, broadcast: { self: false } },
    });

    // Movement + shot broadcasts (registered before subscribe).
    this.channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (this.onState) this.onState(payload);
    });
    this.channel.on("broadcast", { event: "shot" }, ({ payload }) => {
      if (this.onShot) this.onShot(payload);
    });
    this.channel.on("broadcast", { event: "hit" }, ({ payload }) => {
      if (this.onHit) this.onHit(payload);
    });
    this.channel.on("broadcast", { event: "death" }, ({ payload }) => {
      if (this.onDeath) this.onDeath(payload);
    });

    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState();
      const list = [];
      for (const key in state) {
        const meta = state[key][0] || {};
        list.push({
          id: key,
          name: meta.name || "Player",
          host: Boolean(meta.host),
          self: key === this.id,
        });
      }
      // Stable order: host first, then by name.
      list.sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0) || a.name.localeCompare(b.name));
      this.players = list;
      this._emit();
    });

    await this.channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await this.channel.track({ name: this.playerName, host: this.host });
      }
    });
  }

  // Fire-and-forget broadcasts. No-ops in an offline/solo lobby.
  sendState(payload) {
    if (this.channel) this.channel.send({ type: "broadcast", event: "state", payload });
  }
  sendShot(payload) {
    if (this.channel) this.channel.send({ type: "broadcast", event: "shot", payload });
  }
  sendHit(payload) {
    if (this.channel) this.channel.send({ type: "broadcast", event: "hit", payload });
  }
  sendDeath(payload) {
    if (this.channel) this.channel.send({ type: "broadcast", event: "death", payload });
  }

  leave() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  _emit() {
    if (this.onChange) this.onChange(this.players);
  }
}
