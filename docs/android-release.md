# Clubstride-Mobile - Android release

What exists here, and what does not: `app.json`, `eas.json`, `scripts/new-release-keystore.sh`,
`src/features/shared/screens/SettingsScreen.tsx`, the queue-clearing that goes with it, and
`supabase/migrations/20261023130000_clubstride_pro_account_deletion.sql`.

Both Pro migrations now live **inside this folder**, not in `clubstride/`. That is not tidiness:
`FracturedOrbit1980/Clubstride-Mobile` is a public repository and its `main` branch is what GitHub
Pages serves for Lite, so a schema file under `clubstride/` is published to the internet the moment it
is pushed - every RLS policy, the manager-handover rule, and the exact shape of the tables holding
children's data. Confirmed 2026-10-23: the site root answers `200`, the migration URLs answer `404`,
because the two local commits (`bf18701`, `39854f8`) were never pushed. **Pushing `main` as it stands
still publishes them** - `39854f8` contains the baseline SQL in its history, so moving the file only
stops future exposure. Before the next push, either keep those two commits off `main`, drop `39854f8`,
or make the repository private. Your call, and none of it is done from here.

`clubstride-pro/` is now a real Expo project, and it is **pinned to SDK 58**: `expo ~58.0.17`,
`react-native 0.88.0`, `react 19.3.0`, `typescript ~6.0.3`, with `index.ts` -> `App.tsx` wiring
`AuthProvider` -> `SyncQueueProvider` -> sign-in / Settings, and `package.json`, `tsconfig.json` and
`assets/` added. One dependency trap found the hard way: **AsyncStorage must be `2.2.0`, not npm's
latest `3.1.1`** - SDK 58's native packaging expects 2.x, and `expo-doctor` fails the build plan over
it. Use `npx expo install <pkg>` from here on, never a bare `npm i <pkg>@latest`.

Proved on 2026-10-23: `tsc --noEmit` clean against the real React 19 / RN 0.88 types, `expo config
--type public` resolves every key in `app.json` (including `blockedPermissions`) with `sdkVersion:
58.0.0`, `expo-doctor` passes 20/20, and `expo export --platform android` bundles 684 modules to a
2.3 MB Hermes `.hbc`. **Not** proved: nothing has run on a device, no `.env` points at a real project
(`supabaseClient.ts` throws at import until one does), there is no in-app sign-up, and the two
migrations have never been applied - Supabase still has no schema at all.

**Superseded on 2026-10-26:** that snapshot predates the auth work. The schema and both Pro migrations
are applied, sign-up / forgot-password / reset-password screens exist, `.env` points at the real
project, and **Confirm email is off** (`mailer_autoconfirm` → true), so a new account is signed in the
moment it registers. Still true: nothing has run on a device, and there is no SMTP, so password-reset
mail does not deliver.

---

## 1. Four places the spec could not be implemented as written

| The spec said | Reality | What these files do |
|---|---|---|
| `android.targetSdkVersion`: "API 34+" | Play has required **target API 36 (Android 16)** for new apps and updates since 2026-08-31, with an extension only to 2026-11-01 for existing apps. API 34 is rejected. The current `app.json` schema does not document a `targetSdkVersion` key either - the value comes from the Expo SDK's Gradle template, and current SDKs already target 36. | `app.json` sets nothing, which is the correct way to inherit 36. Pin it with the `expo-build-properties` plugin (documented for exactly that) only if a future Play deadline forces it - and never downward. |
| `android.permissions`: "limited to three permissions" | That key is **additive**. It cannot remove a permission a library's `AndroidManifest.xml` merged in; only `android.blockedPermissions` can. | All three requested permissions are listed, **plus** `blockedPermissions` denying location (all three variants), overlay, and legacy external storage. |
| The three permissions as "essential" | Nothing in the app uses any of them yet. There is no push implementation, no haptics call, no boot receiver. Play review asks what declared permissions are used for, and a declared-but-unused `POST_NOTIFICATIONS` is the kind of thing that draws a rejection. | Kept, as asked. Delete the entries you do not implement before submitting - `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` are the two to drop first. |
| `eas.json` `buildType: "app-bundle"` | Already the right value (`.aab` is what Play requires). | `build.production.android.buildType = "app-bundle"`, with `apk`-producing `development` and `preview` profiles kept so match-day testing stays a one-tap install. |

Also: environment variables do not belong *inside* `eas.json` as literal values. `EXPO_PUBLIC_*` names
are resolved from EAS environment variables at build time (see section 5), and the file stays
committable.

---

## 2. Account deletion

Google Play requires that an account can be deleted **from inside the app**, without contacting
support, and that the personal data that came with it goes. Two halves.

### 2.1 The migration

`supabase/migrations/20261023130000_clubstride_pro_account_deletion.sql`

It is not just a `DELETE`. The baseline schema's cascade rules were written for a coach leaving a
squad, and two of them do the wrong thing when an account is erased:

- **`progression_feedback.coach_id` was `NOT NULL ... ON DELETE CASCADE`.** One coach deleting their
  account would have destroyed every note that coach wrote about a child. Those notes belong to the
  child and the club. The migration drops the `NOT NULL`, retimes the FK to `ON DELETE SET NULL`, and
  puts the column where `matches.created_by`, `match_events.created_by`, `drills.created_by` and
  `attendance.recorded_by` already were - anonymise, keep the record. The `feedback_coach_update`
  policy is widened to team staff at the same time, because a row pinned to `coach_id = auth.uid()`
  with no author left is a row nobody could ever edit or un-list again.
- **`team_members.user_id ... ON DELETE CASCADE` + one-manager-per-team.** Every path that appoints a
  successor (`members_insert_manager`, `teams_update_manager`, `teams_delete_manager`) requires an
  existing manager. Letting the sole manager vanish deletes the only row that could authorise the next
  one and strands the squad - players and match history included - permanently unmanageable.
  `delete_user_account()` therefore refuses when the caller manages a team, SQLSTATE `45001`, and
  names the teams in the message so the UI can show what to do instead.

The function itself is `SECURITY DEFINER`, `SET search_path = public, pg_temp`, execute for
`authenticated`, revoked from `PUBLIC` and `anon`. `SECURITY DEFINER` is load-bearing twice: no
`authenticated` role may delete an `auth.users` row, and the `ON DELETE SET NULL` cascade updates rows
that another member's RLS view cannot see, which would abort the deletion under the invoking role.

There is deliberately **no** `users_delete_own` policy. `public.users` is the child side of the key
into `auth.users`, so a client-side delete there would leave a login with no profile row - the
`noProfile` state `AuthContext` already has to handle - and would not delete the account.

Not covered, and needing a decision or a policy sentence before release:

- Supabase **Storage** - nothing is uploaded today. The moment session photos land, deletion has to
  list and remove that user's objects; the DB cannot do it.
- **Backups / point-in-time restore.** Say so in the privacy policy rather than promise the
  impossible.
- **A web deletion path**, if Lite's deployed page is treated as the service's website. Play expects
  deletion to be available wherever the account can be created.
- Applying as anything other than Supabase's `postgres` role fails on `DELETE FROM auth.users` with
  `insufficient_privilege`. `supabase db push` and the dashboard SQL editor are both fine.

### 2.2 The Settings screen

`src/features/shared/screens/SettingsScreen.tsx` - shared by every tier and role, because a
Pro-gated or manager-gated delete button fails the policy.

- Two presses: the button opens a `Modal`, the modal has the destructive action. `Alert.prompt` is
  iOS-only in React Native, so a `Modal` is the only confirmation primitive that reaches Android.
- It states what goes (login, email, name, memberships, guardian links, push tokens) and what stays
  (squads, players, matches, line-ups, events, attendance, feedback - with the author removed).
- It counts unsent outbox rows first. `N change(s) are still only on this phone` is the honest version
  of "delete my data", and discarding an unsent match silently is exactly the failure the outbox
  subsystem exists to prevent.
- A `45001` refusal renders the Postgres `HINT`, so a coach who is still a manager is told to hand
  over, not shown a spinner that ended badly.
- On success: `queue.clearLocal()` **then** `signOut()`. That order matters - the outbox key is
  `cs.outbox.v1.<userId>`, and once the session is gone the client no longer knows which key to
  remove. `clearLocal` detaches first so an in-flight drain breaks on the changed user id and
  `persist()` becomes a no-op, then awaits the save chain and removes the key, so nothing can write
  the dead account's rows back to disk afterwards. It only clears that account's blob; another signed-in
  account on the same phone keeps its queue (proved in the harness).

`removeOutbox` exists solely for this path. There is no general "clear the queue" call: the queue is
the only copy of a match recorded without signal.

---

## 3. `app.json`

Key values and why:

- `android.package = "com.clubstride.mobile"` - **permanent.** It is the app's identity in the Play
  Console; it cannot be changed after the first upload, and a second package name means a second app
  with zero installs. Decide before the first build. (If you want `app.clubstride.mobile` or a
  company-scoped id, change it now, not after internal testing.)
- `android.versionCode = 1`, with `cli.appVersionSource = "local"` and
  `build.production.autoIncrement = true` in `eas.json`, so every production build bumps it in this
  file and Play never sees a repeat. Two artefacts with the same `versionCode` cannot both be active
  on a track.
- `android.blockedPermissions` - see section 1. Location is denied outright: a youth-football app that
  could collect where children are is a Data Safety and Play Families problem, not a feature. Camera
  and microphone are *not* blocked, since session photos and clip recording are planned Pro features
  and blocking them would silently break those builds later; they are simply not requested by any
  library today.
- `icon`, `splash.image`, `adaptiveIcon.foregroundImage` point at `./assets/*.png`. `npx
  create-expo-app` generates all three; replace them before submitting. A referenced missing asset
  fails the build, which is the right failure - the Expo default logo is not a store icon.
- `userInterfaceStyle: "light"` is a placeholder. Match-day screens sit outdoors; decide light vs
  high-contrast dark before the first usability pass, it is one key.
- No `extra.eas.projectId`. `eas init` writes it. A placeholder project id is worse than none: the
  build then targets somebody else's project.
- No `plugins` array. Add the config plugins your packages need (`expo-build-properties`,
  `expo-notifications`, `sentry-expo`, ...) as you install them; this file cannot list plugins for
  packages that do not exist yet.

Verify what the config actually resolves to before building:

```bash
npx expo-doctor
npx expo config --type public     # shows what ships inside the bundle - read it, it has the anon key
```

---

## 4. `eas.json`

- `development` / `preview` produce `.apk` (installable by hand on the match-day phone);
  `production` produces `.aab` and is the only profile that may be submitted.
- `build.production.environment = "production"` links the profile to the EAS environment of the same
  name, which is where the Supabase values live.
- `submit.production.android.track = "internal"` - the first release goes to internal testing, not
  `production`.
- `submit.production.android.serviceAccountKeyPath = "./secrets/play-service-account.json"` - a path,
  not a secret. `secrets/` is gitignored along with `*.jks`, `*.keystore`, `*.aab`, `*.apk`.

---

## 5. Environment variables

`EXPO_PUBLIC_*` values are **inlined into the JavaScript bundle** at build time. Anyone who unpacks
the `.aab` can read them. That is acceptable for the anon key only because Row Level Security is the
enforcement - the anon key is not a secret, it is a URL plus a policy contract. A `service_role` key,
a DB password, or an EAS push key must never be `EXPO_PUBLIC_*`, and the migration header is the
reason RLS can be trusted to hold on its own.

Cloud builds (the normal path):

```bash
eas env:set --name EXPO_PUBLIC_SUPABASE_URL      --value "https://<project-ref>.supabase.co" \
  --environment production --visibility plaintext
eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" \
  --environment production --visibility plaintext
```

Local development and `eas build --local` read `.env` instead - EAS environment variables are not
available to a local build. Copy `.env.example` to `.env`; it already carries both names.
`src/core/supabaseClient.ts` throws at import if either is missing or still says `YOUR_SUPABASE`, so a
misconfigured build fails on the launch screen rather than returning opaque fetch errors mid-match.

---

## 6. Signing

Decide which of these two you are doing before the first build; mixing them is how keystores get lost.

**Recommended - EAS holds the keystore.** No file on this machine, and re-uploads work from any
laptop:

```bash
npm install -g eas-cli@latest
eas login
eas init --platform android          # writes extra.eas.projectId into app.json
eas credentials --platform android   # "Generate" a signing keystore (and an upload key if Play App Signing is on)
```

**Also recommended - enrol in Play App Signing.** Google holds the release key and your keystore
becomes only an *upload* key. Losing it then costs you a re-upload of a new key, not the app. Without
it, `scripts/new-release-keystore.sh` producing a file that only exists on one laptop is the highest-
risk item in this document.

**Local keystore** (if you want the file yourself):

```bash
./scripts/new-release-keystore.sh
```

It reads the password with echo off, passes it to `keytool` via `-storepass:env` so it stays out of
shell history and `ps` output, refuses to overwrite an existing keystore, and keeps key and store
passwords equal. Then register it with EAS through `eas credentials --platform android`.

---

## 7. Build the release bundle

```bash
cd clubstride-pro
npm install                      # done; keep package-lock.json, it is not in version control yet
npx expo-doctor                  # 20/20 as of 2026-10-23
eas build --platform android --profile production
```

EAS produces the `.aab`, uploads it to its own storage, and the build page has the download link.
`eas build --platform android --profile production --local` also works, and needs `.env` rather than
EAS variables plus a working Android SDK and JDK 17.

`npx react-native build-android --mode=release` is the alternative the spec mentions. It only works
after `npx expo prebuild -p android --clean`, and it then builds from generated native files that are
not in version control - fine for checking that the manifest merged the way you expect, not the way to
produce the artefact you submit:

```bash
npx expo prebuild -p android --clean
grep -rn "uses-permission" android/app/src/main/AndroidManifest.xml
```

That `grep` is the only real proof of what permissions ship. `android.permissions` adds, libraries add,
`blockedPermissions` removes - read the merged file, not the config.

---

## 8. Internal testing track

Play Console work is yours; none of it can be done from here.

1. Create the developer account (one-time, and it needs organisation details if you are registering as
   a club rather than an individual), then **Create app**: name `Clubstride-Mobile`, default language,
   App, Free, and **not** declared as targeting children (the user is the adult coach; the *data* is
   about children, which is handled in step 3, not by this checkbox).
2. Accept the policies and complete the app access + content guidelines questions.
3. **Data safety form.** This is where an app that stores children's names, shirt numbers, match
   records and coach notes actually gets read. Declare what is collected, that it is not sold, the
   encryption in transit, and the deletion route (`Settings > Delete account`). Also add the privacy
   policy URL - Play needs it on the store listing *and* reachable in-app.
4. Service account for automated submission: in Google Cloud, enable the Play Developer API on a
   project, create a service account, download the JSON key as
   `secrets/play-service-account.json`, then in the Play Console under **User & permissions > Invite
   new users**, add that service account's email address with permission to manage the internal
   testing track. Upload first, accept the invitation, then submit - `eas submit` fails with an
   opaque 401 when step 4 was skipped.
5. Submit:

   ```bash
   eas submit -p android --profile production
   ```

   or upload the `.aab` by hand on **Testing > Internal testing > Create release**.
6. Add internal testers (up to 100 email addresses; a Google Groups address counts as one slot), then
   opt in on the match-day phone from the invite link. Install from the Play Store app, not by
   sideloading - the store path is what exercises the real permission prompts.
7. Only after the track build is stable: **Promote release** to closed testing, then production.
   Reviewers also need a test account and a way to reach you on the testing track, so create a
   throwaway club and coach login and put the credentials in the app's testing notes.

---

## 9. Pre-flight

- [ ] The account-deletion migration is applied and `delete_user_account()` was called once for real,
      including the refusal path on a team you manage. A parse check is not evidence.
- [ ] Settings is reachable from every role and tier - `App.tsx` renders it for any `ready` session,
      so this is by construction, but confirm it on the phone - and the button deletes the account it
      is signed into.
- [ ] Sign-up on the release build creates an account and lands signed in with no confirmation mail
      (Confirm email off since 2026-10-26, verified server-side). Reviewers can self-register, but still
      hand one a pre-made coach account: there is no SMTP, so a mistyped address cannot be recovered.
- [ ] `.env` (local) or the `production` EAS variables (cloud) actually hold a real project URL and
      anon key. `supabaseClient.ts` throws at import otherwise, which means a red launch screen - the
      intended failure, but a failure the build cannot catch.
- [ ] `grep` the merged manifest: no location, no `SYSTEM_ALERT_WINDOW`, and no permission you cannot
      justify in one sentence.
- [ ] `versionCode` incremented; `android.package` unchanged since the first upload.
- [ ] The `.aab` was installed and signed in on a phone with the Supabase project the production
      environment points at - not a local `.env` build.
- [ ] Privacy policy URL live, and Data safety answers match what the app does today, not what it will
      do.
- [ ] Keystore backed up off-machine, or Play App Signing enrolled.

Unresolved and still open from earlier on this track: PKCE degrading to a non-`crypto.subtle` verifier,
`expo-secure-store` vs AsyncStorage for the session, and foreground `AppState` token refresh. A release
build is where all three show up, so test signed-out-then-back-in on the phone before submitting.
