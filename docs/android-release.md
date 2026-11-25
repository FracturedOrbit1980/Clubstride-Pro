# Clubstride Pro — first Google Play internal release

This is the owner's checklist for the first Android upload. The app id is `com.clubstride.mobile`. The name on the device and in Play Console is **Clubstride Pro**. Version `1.0.0` (`android.versionCode` `1`) is the first release.

Nothing in this repository is an EAS project yet: there is no `extra.eas.projectId`. Do not invent one. `eas init` writes it with your Expo account, and that step was not run here because it needs your login. A cloud `eas build` was not run either. It needs that same account, plus the environment variables in section 3.

Do not commit `.env`, `secrets/`, a keystore, or a `service_role` key. `EXPO_PUBLIC_*` values are inlined into the app binary. The anon key is safe to inline only because Row Level Security is what actually protects data. A `service_role` key, a `sb_secret_` key, or a database password must never be an `EXPO_PUBLIC_` variable and must never be pasted into `eas.json`.

## 0. What is already in the project

- `eas.json` `production` builds an Android App Bundle (`.aab`) for the Play **internal** track and reads the EAS environment named `production`. `development` and `preview` build APKs for sideloading. Those APKs are not what you upload.
- `app.json` name `Clubstride Pro`, package `com.clubstride.mobile`, version `1.0.0`, `versionCode` `1`, launcher icon, adaptive icon (navy `#0A1630`), and the splash plugin pointed at `assets/brand/`. `userInterfaceStyle` is `dark`, and `expo-system-ui` is installed so that setting applies on Android.
- The only permission the app uses is `INTERNET` (Supabase, opening the privacy policy). Location, storage, overlay, vibrate, notifications, boot, and the advertising id are blocked. There is no push implementation and no boot receiver.
- Settings → **Delete account** calls `delete_user_account()`. Settings, Sign in, and Create an account link the privacy policy. Settings also links the web deletion page.
- Store copy is in `store/listing.md` and `store/data-safety.md`.

Confirm the config still resolves before you build:

```bash
npm install
npx tsc --noEmit
npx expo-doctor
npx expo prebuild -p android --clean
grep -n "uses-permission" android/app/src/main/AndroidManifest.xml
```

`android/` is gitignored. In that manifest, `INTERNET` is a normal `uses-permission`. Every other permission line in the app manifest should carry `tools:node="remove"`. Library manifests still request storage (`expo-file-system`); the `tools:node="remove"` entries are what the Gradle merger strips out of the AAB. Do not commit the generated `android/` directory. Prebuild also rewrites the `android` npm script to `expo run:android` while that folder exists. Leave the committed script as `expo start --android`.

## 1. Expo account and project id

Install the CLI on your machine (it is not required to be a project dependency):

```bash
npm install -g eas-cli
eas login
eas whoami
```

From the repository root:

```bash
eas init
```

Accept linking this app. That writes `extra.eas.projectId` into `app.json`. Commit and push that change. A placeholder id would make the build target the wrong Expo project.

## 2. Signing

Use one approach. Mixing them is how upload keys get lost.

**Do this.** Let EAS generate the upload keystore, and turn on **Play App Signing** when Play Console asks (section 5). Google holds the app signing key. If the upload key is lost, Play can replace it. The app cannot.

```bash
eas credentials -p android
```

Choose the production build profile and generate a new keystore when asked. You do not need a file on disk.

`scripts/new-release-keystore.sh` is only for the case where you insist on holding the file yourself. It writes `secrets/clubstride-release.jks`, which is gitignored. Back it up off the machine, then register it with `eas credentials -p android`. Without Play App Signing, losing that file means you can never update this package name.

## 3. Supabase environment variables

The production profile has `"environment": "production"`. EAS injects that environment's variables when the bundle is built. They are not stored in `eas.json`.

In the Supabase dashboard, open **Project Settings → API** and copy the project URL and the **anon** / publishable key. Reject anything whose role is `service_role` or whose value starts with `sb_secret_`. A production build aborts if the key is a secret (`app.config.js`).

```bash
eas env:set --name EXPO_PUBLIC_SUPABASE_URL \
  --value "https://<project-ref>.supabase.co" \
  --environment production --visibility plaintext

eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value "<anon key>" \
  --environment production --visibility plaintext

eas env:list --environment production
```

`plaintext` is the right visibility: the value is embedded in the app anyway. Do not use `secret` visibility. Secret variables are not available for the client bundle, and the app would launch with Supabase unconfigured.

Check the list shows both names and no `service_role`.

Local Metro does not see EAS variables. Copy `.env.example` to `.env` (gitignored) and put the same two names there for `npx expo start`. `eas build --local` also reads `.env`, not the EAS environment.

`development` and `preview` profiles read the EAS environments of those names. Set the same two variables there only if you cloud-build an APK. The internal-track release uses `production` only.

## 4. Build the AAB

```bash
eas build -p android --profile production
```

This asks EAS to compile an `.aab`. It will not run until sections 1 and 3 are done. The command bumps `android.versionCode` in `app.json` because `cli.appVersionSource` is `local` and `autoIncrement` is true. The first upload is therefore **versionCode 2**, versionName `1.0.0`.

When the command finishes, `app.json` on your machine has the new `versionCode`. Commit and push it before the next production build. If you do not, the next build increments from `1` again, uploads another versionCode `2`, and Play rejects the duplicate.

Download the `.aab` from the build page on expo.dev if you want a copy. You do not need to commit the `.aab`.

`eas build -p android --profile production --local` is the offline alternative. It needs a JDK, the Android SDK, and a filled-in `.env`. It is not a substitute for the cloud build unless you already have that toolchain.

## 5. Play Console app

Use a Play Console developer account you control.

1. **Create app.** App name `Clubstride Pro` (not `Clubstride-Mobile`). Default language English (Ireland). App, Free. Declare that it is **not** directed at children. The user is an adult coach. Children's names are club records and belong on the Data safety form, not on the "designed for children" checkbox.
2. When Play offers **Play App Signing**, enrol. This is the same decision as section 2.
3. Finish the required policy declarations before the track will accept a release. Use `store/listing.md` for the listing text and URLs:
   - Privacy policy: `https://fracturedorbit1980.github.io/Clubstride-Pro-Web/privacy-policy.html`
   - Website: `https://fracturedorbit1980.github.io/Clubstride-Pro-Web/`
4. **App content → App access.** All functionality needs an account. Add the reviewer login from section 8. Do not put a real club coach's password here.
5. **Ads:** no. **Content rating:** complete the questionnaire (no violence, no user-to-user chat, no public user-generated content, no gambling, no location sharing). **Target audience:** adults, 18+. **News / COVID / government / financial features:** no.
6. **Data safety.** Copy `store/data-safety.md`. In particular: email and name, squad and attendance records, not sold, not used for ads, encrypted in transit, deletion URL `https://fracturedorbit1980.github.io/Clubstride-Pro-Web/delete-account.html`, in-app path Settings → Delete account. Say that player names may be children because this is a club register entered by an adult coach.
7. Store graphics: `store/assets/icon-512.png` and `store/assets/feature-graphic-1024x500.png` are ready. Phone screenshots are not. Capture them from a signed-in release build (Sign in, Squad, Attendance, the register export) at 9:16, for example 1080×1920. Internal testing can start without screenshots; production cannot.

The package name on the app must be `com.clubstride.mobile`. It cannot be changed after the first upload.

## 6. Service account for `eas submit`

`eas submit` talks to the Play Developer API. The JSON key is an OAuth credential. Keep it at `secrets/play-service-account.json`. That path is already in `eas.json` under `submit.production.android.serviceAccountKeyPath`, and `secrets/` is gitignored.

1. In Google Cloud, create a project if you need one, then **IAM & Admin → Service accounts → Create service account**. Name it so it is obvious it belongs to Play (for example `clubstride-play-submit`).
2. Open that account → **Keys → Add key → Create new key → JSON**. Save the download as `secrets/play-service-account.json`. Do not commit it, and do not email it.
3. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) on that Cloud project.
4. In Play Console, **Users and permissions → Invite new users**. Paste the service account email (it ends in `.iam.gserviceaccount.com`).
5. On **App permissions**, select Clubstride Pro. Grant:
   - View app information (read-only)
   - Edit and delete draft apps
   - Release to production, exclude devices, and use Play App Signing
   - Release apps to testing tracks
   - Manage testing tracks and edit tester lists
   - Manage store presence

   You do not need Admin, financial data, or orders. Send the invite.
6. The API often returns a permission error until the invite exists and the app record exists. If the very first `eas submit` still returns 401, upload the `.aab` once by hand (**Testing → Internal testing → Create release**), then retry `eas submit` for later builds.

## 7. Submit to the internal track

```bash
eas submit -p android --profile production
```

The submit profile sets `track` to `internal`, `releaseStatus` to `completed` (testers can install as soon as Play finishes processing), and `packageName` to `com.clubstride.mobile`. Pick the production build when the CLI asks, unless you pass `--latest` or a build id.

Or upload the `.aab` yourself on **Testing → Internal testing → Create release**. Add release notes, review, and roll out.

Then:

1. **Testers** tab: create an email list (up to 100 addresses; a Google Group is one slot).
2. Copy the opt-in link. On the phone, open that link while signed into a tester Google account, accept, and install from the Play Store app. Sideloading an APK does not exercise this track.
3. Leave the release on internal until a signed-in phone has synced a squad against the production Supabase project. Promote to closed testing, then production, only after that.

## 8. Reviewer test login

Play reviewers and your internal testers need an account that works without email delivery. Confirmation mail is not sent (no SMTP). Confirm email is off in the Supabase project, so a new account is signed in at registration. Still hand reviewers a ready-made account: a mistyped address cannot be recovered.

Create it in the Supabase dashboard (**Authentication → Users → Add user**) or by registering once on a build that points at this project:

- Email and password you can throw away. Not a coach at a real club.
- A team membership with role `coach` (or `manager` only if a second manager already exists).
- A few sample players so Squad and the register are not empty.

Sole managers cannot delete their account (`delete_user_account()` raises SQLSTATE `45001` and names the team). If you want a reviewer to complete deletion, either make them a coach who is not the only manager, or add a second manager first. Deletion removes the login, email, name, memberships, and guardian links. Squads, players, matches, attendance, and feedback stay, with the author cleared. Unsent outbox rows on that phone are discarded.

Put the credentials in Play Console **App content → App access**, and in the internal-testing release notes:

- Email
- Password
- Path: sign in → Settings → Privacy policy, and Settings → Delete account
- Say that the account may be deleted and that a sole manager is refused until the team is handed over

Do not put the production club password in the console.

## 9. Pre-flight

- [ ] `eas init` committed (`extra.eas.projectId` present).
- [ ] `eas env:list --environment production` shows `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and neither value is a `service_role` key.
- [ ] `eas build -p android --profile production` produced an `.aab`, and the bumped `versionCode` is committed.
- [ ] Play App Signing is on, or the upload keystore is backed up off the machine.
- [ ] Merged permissions are only `INTERNET` plus `tools:node="remove"` for the blocked list.
- [ ] App name in Play is `Clubstride Pro`. Package is `com.clubstride.mobile`.
- [ ] Privacy policy URL and delete-account URL open in a browser (both were HTTP 200 on 25 November 2026).
- [ ] Data safety answers match `store/data-safety.md` and what the app does today.
- [ ] Service account JSON is only in `secrets/`, the invite is accepted, and the permissions in section 6 are granted.
- [ ] Reviewer login signs in on the internal-track build, Settings shows Privacy policy and Delete account, and a non-manager account can delete itself.
- [ ] `delete_user_account()` exists in the production Supabase project (migration `supabase/migrations/20261023130000_clubstride_pro_account_deletion.sql`). A sole-manager delete is refused and the error text names the team.

## Account deletion, short version

The button is on Settings for every signed-in role. It is two presses, then one RPC. On success the app clears that account's local outbox and then signs out. A manager who is the only manager of a team is refused and told to hand the team over. There is no client-side delete of `public.users` on its own: that would leave a login with no profile.

Storage objects are not part of deletion because the app does not upload files. Backups and point-in-time restore can retain a deleted account until the backup expires; the privacy policy is the place that sentence belongs, and it already describes the deletion scope.
