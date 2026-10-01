import { createClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/shared/config/runtimeEnv'

const url = getPublicEnv('OKI_SUPABASE_URL')?.trim()
const key = getPublicEnv('OKI_SUPABASE_ANON_KEY')?.trim()

// Only the public publishable/anon key belongs in frontend configuration.
export const syncClient = url && key ? createClient(url, key) : null
