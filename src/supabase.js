import { createClient } from "@supabase/supabase-js";

// Reads keys from .env.local (VITE_ vars are exposed to the browser by Vite).
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helpful warning during dev if the keys are missing.
if (!url || !anonKey) {
  console.warn(
    "[Yasu3D] Supabase keys missing. Fill in VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_ANON_KEY in .env.local, then restart `npm run dev`."
  );
}

// True only when both keys are present, so features can degrade gracefully.
export const supabaseReady = Boolean(url && anonKey);

export const supabase = createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder");
