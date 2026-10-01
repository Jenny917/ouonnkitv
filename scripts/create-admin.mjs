import { createClient } from '@supabase/supabase-js'

// Run with a private env file: node --env-file=.env.admin scripts/create-admin.mjs
const url = process.env.OKI_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
const username = process.env.ADMIN_USERNAME?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
if (
  !url ||
  !key ||
  !username ||
  !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username) ||
  !password ||
  password.length < 10 ||
  password.length > 128
) {
  console.error(
    'Set Supabase URL, server secret, ADMIN_USERNAME and ADMIN_PASSWORD (10–128 characters) in a private environment file.',
  )
  process.exit(1)
}
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await client.from('user_accounts').select('id').eq('role', 'admin').limit(1)
if (error) {
  console.error('Run both database migrations before creating the admin.')
  process.exit(1)
}
if (data.length) {
  console.error('An admin already exists. Bootstrap is only for the first admin.')
  process.exit(1)
}
const { error: createError } = await client.auth.admin.createUser({
  email: `${username}@users.ouonnki.invalid`,
  password,
  email_confirm: true,
  app_metadata: { managed_account: true, username, account_role: 'admin' },
})
if (createError) {
  console.error('Admin creation failed. Check the username and Supabase password requirements.')
  process.exit(1)
}
console.log(`Admin ${username} created. You can now sign in with the username and password.`)
