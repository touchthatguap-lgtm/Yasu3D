import { supabase, supabaseReady } from "./supabase.js";

// Username + password auth on top of Supabase Auth.
//
// Supabase Auth is email-based, so we map each username to a synthetic email
// (username@DOMAIN) and sign up / sign in with that. The chosen username is also
// stored in user_metadata for display and read back on session resume.
//
// IMPORTANT: a synthetic email can't receive a real confirmation link, so the
// Supabase project must have email confirmation turned OFF:
//   Dashboard -> Authentication -> Providers -> Email -> "Confirm email" = off
// Otherwise sign-in fails with "Email not confirmed" (handled with a clear
// message in the auth screen).

const EMAIL_DOMAIN = "yasu3d.local";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

// Usernames with access to dev tooling (e.g. the map editor). Case-insensitive.
const DEV_USERS = ["mako"];

export { supabaseReady };

// Whether a username has access to dev-only tooling (the map editor).
export function isDevUser(username) {
  return DEV_USERS.includes((username || "").toLowerCase());
}

// Returns an error string if the username is invalid, else null.
export function validateUsername(name) {
  if (!USERNAME_RE.test(name || "")) {
    return "Username must be 3–16 characters: letters, numbers, or underscore.";
  }
  return null;
}

function emailFor(username) {
  return `${username.toLowerCase()}@${EMAIL_DOMAIN}`;
}

// The display username for a Supabase user (from metadata, falling back to the
// local-part of the synthetic email).
export function usernameFromUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  if (meta.username) return meta.username;
  return (user.email || "").split("@")[0] || "Player";
}

// Create an account. If the project has confirmation disabled, the returned
// data includes a live session (we're logged in immediately).
export async function register(username, password) {
  const { data, error } = await supabase.auth.signUp({
    email: emailFor(username),
    password,
    options: { data: { username } },
  });
  if (error) throw error;
  return data;
}

export async function login(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailFor(username),
    password,
  });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

// The currently signed-in user, or null. Resolves from the persisted session.
export async function getCurrentUser() {
  if (!supabaseReady) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.user : null;
}

// --- Per-account loadout -----------------------------------------------------
// Stored in user_metadata (same place as the username), so the player's chosen
// weapons follow their account and survive refreshes — no extra table needed.

export function loadoutFromUser(user) {
  return (user && user.user_metadata && user.user_metadata.loadout) || null;
}

export async function saveLoadout(loadout) {
  if (!supabaseReady) return;
  const { error } = await supabase.auth.updateUser({ data: { loadout } });
  if (error) console.warn("[Yasu3D] failed to save loadout:", error.message);
}

export function characterFromUser(user) {
  return (user && user.user_metadata && user.user_metadata.character) || null;
}

export async function saveCharacter(character) {
  if (!supabaseReady) return;
  const { error } = await supabase.auth.updateUser({ data: { character } });
  if (error) console.warn("[Yasu3D] failed to save character:", error.message);
}
