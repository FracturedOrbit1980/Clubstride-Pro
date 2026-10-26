# Data safety — answers for the Play Console form

Match these to what the app does **today**. If a feature changes, revisit.

## Collection and sharing

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Email address | Yes | No | Account management, sign-in | Required |
| Name (account holder) | Yes, if provided | No | Account display | Optional |
| Other user-generated content — squad and player names, shirt numbers, positions | Yes | No | App functionality | Required |
| Other user-generated content — attendance marks per player per session | Yes | No | App functionality | Required |

Not collected: location, contacts, photos or videos, files, calendar, SMS,
call logs, browsing history, search history, app interactions/analytics,
crash logs, diagnostics, device identifiers for advertising, financial info,
health info, messages, audio.

## Security and handling

- **Encrypted in transit:** yes (HTTPS/TLS to the backend).
- **Encrypted at rest:** data is stored in a managed Postgres service
  (Supabase) with encryption at rest.
- **Users can request deletion:** yes.
  - Deletion URL: https://fracturedorbit1980.github.io/Clubstride-Pro-Web/delete-account.html
  - In-app path: Settings → Delete account.
- **Data sold:** no.
- **Data used for advertising:** no.
- **Data used for personalisation:** no.
- **Committed to Play Families policy:** no — the app is aimed at adult coaches
  and is not child-directed.

## Children's data

The account holder is an adult coach. The app stores names and attendance of
players, who may be minors, because that is the club's register. Declare this
honestly in the free-text fields if Play asks what the user-generated content
is: "club squad and attendance records entered by an adult coach".

## Account deletion scope (what to say if asked)

Deleting an account removes the login, email, name, team memberships and
guardian links. Records written by that account that belong to the club —
squads, players, attendance, feedback with the author detached — are retained
because they belong to the team, not the individual. Sole managers are refused
deletion until they hand the team over, so a squad is never stranded.
