import { supabase } from "./supabase.js";

// Submit a completed run. Returns { error } so callers can show status.
export async function submitScore(name, timeMs) {
  const { error } = await supabase
    .from("scores")
    .insert({ name: name.slice(0, 20), time_ms: Math.round(timeMs) });
  return { error };
}

// Fetch the fastest runs (lowest time_ms first).
export async function topScores(limit = 5) {
  const { data, error } = await supabase
    .from("scores")
    .select("name, time_ms")
    .order("time_ms", { ascending: true })
    .limit(limit);
  return { data: data ?? [], error };
}
