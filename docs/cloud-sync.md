# Cross-device sync on Vercel

The frontend stays on Vercel. Supabase provides email login and a private database for each user. No database server runs on your computer or Vercel filesystem.

## Setup

1. Create a Supabase project in a region near your users.
2. In its SQL editor, run [the migration](../supabase/migrations/202610010001_user_sync.sql) once. It creates the table, per-user row-level security and atomic merge function.
3. Enable email authentication. Under Authentication → Email Templates → Magic Link, include the code template `{{ .Token }}` instead of a link, for example `<p>Your OuonnkiTV login code is {{ .Token }}</p>`. The app asks for this code, so it works across devices without redirect configuration. Configure your email sender/SMTP for delivery to your users; Supabase's default sender has restrictions.
4. Add these environment variables to the Vercel project for the environments you deploy:

   ```text
   OKI_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   OKI_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   ```

   Use the publishable key (or legacy `anon` key). Never put a secret or `service_role` key in these variables: `OKI_` variables are included in the browser build.

5. Redeploy Vercel. Open Settings → Personal configuration (个人配置) → Cross-device cloud sync (跨设备云同步). Sign into the same email account on both devices.

Without both variables the app continues working locally and shows setup guidance in settings.

## Behavior

- Syncs favorites, episode playback progress, and playback/search preferences. Sources, subscriptions, API tokens, network configuration, search history, and caches are not synced. Use existing config import/export for sources; matching sources must be available on both devices for CMS playback.
- Local edits display immediately and queue in local storage. Uploads are throttled to once per 10 seconds, with a pull every 30 seconds while the app is visible, plus sync on focus, reconnect, visibility change and video pause. Closing a browser may interrupt an upload; the queue resumes on the next visit.
- First sign-in merges guest data into the account. Existing cloud records take precedence over this initial import. Later edits use the newest per-record timestamp, with a deterministic tie-breaker. Keep device clocks accurate. Progress uses the most recent edit, not the largest playback position, so rewinding works.
- Deletions retain tombstones to prevent old devices restoring removed items. Local history limits may generate deletions that propagate to the account.
- Signing out restores the previous guest data. Account caches and pending changes remain on that browser, isolated by user ID, for the next login. This is not a shared-computer privacy mode; clear site data to remove local caches (upload pending changes first).
- Cloud data is protected by Supabase authentication and row-level security. The existing site access password is separate from cloud login. Sync is not end-to-end encrypted.

## Verification after deployment

1. Sign in on device A, add a favorite, then choose Sync now (立即同步).
2. Sign in on device B with the same email. Confirm the favorite appears.
3. Pause a video on A, sync, and reopen the app on B. Confirm the episode and resume position.
4. Delete the favorite on B and sync both devices. Confirm it stays deleted.
5. On A, go offline and add a different favorite. Reload, reconnect and sync. Confirm B receives it.
6. Sign out and sign in with another account. Confirm the previous account's records are not imported.

Automated checks cover merge conflicts, deletions, queued edits and account transitions. Live email delivery, database policies and two-device behavior must also be verified against your configured Supabase project.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).
