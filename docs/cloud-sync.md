# Managed accounts and sync on Vercel

An administrator creates usernames and passwords. Users sign in once and their favorites, watch progress, and playback/search preferences sync automatically across their devices. Different accounts cannot read each other's cloud records. No email codes, public registration, or sync keys are used.

## Fresh Supabase project from Vercel

1. Install Supabase through Vercel Marketplace, create a project, and connect it to this app. Choose a region near your users. Set **Public Environment Variables Prefix** to `OKI_`; leave **Custom Prefix** empty/default. Check the resulting variable names.
2. Open the connected Supabase dashboard → SQL Editor and run these migrations **in order, once each**:
   - [Sync records](../supabase/migrations/202610010001_user_sync.sql)
   - [Managed accounts](../supabase/migrations/202610010002_managed_accounts.sql)
   - [Provisioning fix](../supabase/migrations/202610010003_account_provisioning_fix.sql)
   - [Admin dashboard](../supabase/migrations/202610020001_admin_dashboard.sql)
   - [NSFW source access](../supabase/migrations/202610020002_nsfw_access.sql)
   - [Single active player](../supabase/migrations/202610030001_playback_lease.sql)
3. Under Supabase Authentication, keep the email/password provider enabled but **disable Allow new users to sign up**. Keep multiple simultaneous sessions allowed. The application uses internal, automatically confirmed email-shaped identifiers for Supabase Auth; users only enter usernames, and no mailbox or SMTP is needed. The database trigger also rejects accounts not provisioned by the server admin API.
4. Configure the Vercel project variables:

   | Variable                                                      | Value                                          |
   | ------------------------------------------------------------- | ---------------------------------------------- |
   | `OKI_SUPABASE_URL`                                            | Supabase project URL                           |
   | `OKI_SUPABASE_PUBLISHABLE_KEY` **or** `OKI_SUPABASE_ANON_KEY` | Public publishable/legacy anon key             |
   | `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY`      | Supabase server secret/legacy service-role key |
   | `OKI_INITIAL_VIDEO_SOURCES`                                   | Public sources available to every account      |
   | `NSFW_VIDEO_SOURCES`                                          | Private NSFW sources returned by the server    |

   The server secret and `NSFW_VIDEO_SOURCES` must **not** have an `OKI_`, `NEXT_PUBLIC_`, or other public prefix. They are only read by Vercel functions. Never paste them into the app or commit them. `NSFW_VIDEO_SOURCES` uses the same JSON array or remote-JSON URL format as `OKI_INITIAL_VIDEO_SOURCES`. Remove the obsolete `OKI_ACCESS_PASSWORD` variable; choose a new admin password, because the old shared password was part of the browser configuration.

5. Bootstrap the first admin with the script below, then redeploy Vercel.

Missing Supabase configuration shows setup guidance on the login screen; it does not open the site to anonymous users. The admin API is implemented for Vercel. Other hosts need an equivalent server route; `pnpm dev` alone does not run Vercel Functions. Use Vercel's local development environment to exercise account management locally.

## Create the first admin

After running all migrations, create a **local, private** `.env.admin` file (gitignored):

```dotenv
OKI_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SECRET
ADMIN_USERNAME=admin
ADMIN_PASSWORD="A_NEW_UNIQUE_PASSWORD_AT_LEAST_10_CHARACTERS"
```

Run from the project directory with Node 20.6+:

```sh
node --env-file=.env.admin scripts/create-admin.mjs
```

If bootstrap fails, the script prints Supabase's safe error code/status/message. The most common causes are a wrong project URL or service key, the migrations being run in a different project, an existing admin/user with the same generated identifier, or a password rejected by the project's Auth password policy.

The script makes a one-time remote API call; it does not install a local database or server. It refuses to bootstrap if an admin already exists. Remove the private file after successful setup. Never put `ADMIN_PASSWORD` in a public environment variable. Operator-level recovery of the admin account can be done through Supabase's Admin API using the server secret; ordinary users cannot reset an admin account through the app.

## Admin and user flow

All signed-in accounts can open **My account (我的账号)** from the top-right account menu or sidebar, including users whose Settings entry is hidden. This page shows sync status and the last sync time, supports manual sync and importing the device's original collection, and provides logout for the current device.

The same page lets users change their own password by entering the current password and confirming a new password of 10–128 characters. The Vercel `/api/account-password` function verifies the live account and current password using a temporary Supabase session, updates only that user's password, and disposes the temporary session. No new database migration or environment variable is required for this page.

1. Sign in with the admin username and password.
2. Open **Settings → Personal configuration (个人配置) → User management (用户管理)**.
3. Create user `a` and a password of at least 10 characters. Usernames are case-insensitive, 1–32 characters, using letters, numbers, `_` or `-`, starting with a letter/number. Select **Allow NSFW** only for accounts that should receive the private source list.
4. User `a` signs in on a phone and laptop. Both use the same account data automatically. User `b` gets a separate collection. Admins manage account metadata; their app session does not receive another user's favorites or history.
5. Search users and review their last login and recently active browser/device sessions. Activity updates while an authenticated app is open.
6. Enable or disable a user's NSFW access. The change invalidates existing sessions, so the user must sign in again; the app then adds or removes the server-issued NSFW sources locally.
7. Reset a user's password, force logout on every device, disable the account, or permanently delete the account and its synced data. Destructive actions require confirmation. Database authorization immediately blocks old sessions. Password reset requires fresh login on all devices; re-enabling an account does not restore its old sessions. Open apps check account status every 30 seconds and on focus/reconnect.
8. Review the recent administrator audit log. It records successful account creation, NSFW permission changes, status changes, password resets, forced logouts and deletions without storing passwords.

There is no automatic import of old device data when signing in. If desired, the user can choose **Import this device's original favorites and history (导入此设备原有收藏与历史)**. Existing cloud records, including deletions, win over these imports. Verify that this is the user's own collection before importing on a shared device.

## Sync behavior and limits

- Multiple devices stay signed in, but one player per account holds a server-issued playback lease. Starting playback on another device displays the current device and video and asks for confirmation. Cancelling leaves the existing player alone. Confirmation transfers ownership; the previous player pauses on its next heartbeat (normally within 5 seconds).
- For the same episode, takeover resumes at the last position reported by the previous player (normally within 5 seconds of its current position). Different videos/episodes keep their own history. Separate browser tabs also count as separate players.
- A lease is renewed every 5 seconds while playing and expires after 30 seconds without renewal. Closing a player attempts to release it immediately. Paused players stop renewing after a final checkpoint. During a prolonged network failure the app pauses before its last confirmed lease expires; starting playback requires a working connection.
- Progress carries a playback lease ID. Database triggers reject progress from replaced players; delayed/offline uploads cannot overwrite the current player's progress. Favorites, preferences and history deletion remain available across devices. Apply the playback migration before deploying this frontend, and refresh old open tabs after deployment. This coordinates app playback; it cannot revoke downloaded media or copied third-party stream URLs.

- Local changes appear immediately. Uploads run within about 10 seconds during use, with a pull every 30 seconds while visible and sync on focus, reconnect, visibility change and video pause. Failed uploads remain queued locally.
- Different items merge independently. Changes to the same item normally use the newest edit timestamp, with deterministic tie-breaking. Keep device clocks accurate. A new playback owner takes precedence over the previous owner's progress. Ordinary background sync does not seek an already-playing video.
- Deletions retain tombstones so older devices cannot resurrect removed items. Local history limits can produce deletions that sync to the account.
- Sources, subscriptions, API tokens, network settings, search-history text and caches are not synced. Import/export source configuration separately; CMS playback needs matching sources on each device.
- Signing out affects only the current device. It restores the previous guest snapshot locally, while the login screen blocks access. Account caches/queued edits remain on that browser, keyed by account ID. Clear site data to remove those copies, after uploading pending changes. This is not encrypted local storage.
- An already verified, open app can continue locally during an outage. Fresh login or browser reload needs an online account check. Disabling an account blocks cloud access, not copies already downloaded to a device.
- The static frontend and existing media proxy are not made private by this change. Server-side checks protect account management and per-user cloud data.

## Upgrading the earlier email-code prototype

Keep the first two migrations if they are already applied; run the third provisioning-fix migration too. Existing email-only users are not automatically promoted or converted, and their cloud rows are not deleted. Create the managed admin/users above and explicitly import local favorites/history as needed. Email templates and SMTP setup are no longer required by this app.

## Verify after deployment

1. Create `a` and `b`; sign into `a` on two devices and `b` in a separate browser profile.
2. Add a favorite and pause a video as `a`. Sync both devices; confirm both changes appear for `a` and neither appears for `b`.
3. Delete a favorite, then reconnect a previously offline device. Confirm the deletion stays deleted.
4. Make an offline edit while the app remains open, reconnect and confirm it uploads.
5. Reset `a`'s password; confirm old sessions cannot sync and the new password works on both devices.
6. Disable `a`; confirm cloud access is blocked. Re-enable it and confirm fresh login is required.
7. Force logout `a`; confirm both devices return to the login screen. Confirm the action appears in the audit log.
8. As `b`, call `/api/accounts` with its token and confirm HTTP 403. Direct reads of `a`'s sync rows must also be denied by RLS.

Automated tests exercise authorization failures, admin operations, account transitions, offline queues and merge conflicts. Live Supabase policy enforcement and the two-device flow still need verification with your configured project.

References: [Supabase admin user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [sessions](https://supabase.com/docs/guides/auth/sessions), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
