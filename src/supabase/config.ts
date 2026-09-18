export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export function readSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !publishableKey) return null
  if (!url || !publishableKey) throw new Error('Supabase configuration is incomplete. Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  return { url, publishableKey }
}
