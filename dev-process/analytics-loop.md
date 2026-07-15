# Activity analytics loop

First-party product analytics for the deployed app: **who signs in, from what org,
and what they do** — plus a daily TL;DR report that lands in an Obsidian folder.

## Why first-party (not PostHog / Segment)

The visitors we most want to see are enterprise GTM orgs — exactly the population
whose corporate networks and hardened browsers block third-party analytics. Logging
server-side into our own Postgres can't be blocked, keeps real prospect emails inside
our own infra (the R18 "public repo with real business-contact data" posture), and
reuses the DATABASE_URL / Drizzle path every other table already trusts.

## How it captures

Identity comes from Supabase magic-link auth: **who** = the signed-in email, **org**
= the email domain (the same key the auth allowlist uses). Two capture points, both
Node-runtime (postgres-js can't run on the Edge, so nothing is logged from `proxy.ts`):

| Event | Where | Notes |
|---|---|---|
| `sign_in` | `app/auth/callback/route.ts` | Right after a successful, allowlisted magic-link exchange. Unblockable. |
| `page_view` | `app/api/track/route.ts` | First-party beacon POSTed by `app/activity-tracker.tsx` on each route change. The email is resolved server-side from the session cookie, never trusted from the body. |

Both writes are wrapped so a failed analytics insert can **never** block a real
sign-in or navigation.

### Pieces

- `db/schema/activity.ts` — `activity_events` table + `activity_event_type` enum. RLS
  enabled, deny-by-default (server writes bypass RLS as table owner over DATABASE_URL).
- `db/migrations/0012_nosy_thor_girl.sql` — the migration (RLS line appended by hand,
  matching every other table here).
- `db/activity.ts` — `recordActivity()`, `orgDomainFromEmail()`, `getActivitySince()`.
- `app/activity-tracker.tsx` — client beacon (`sendBeacon`, `fetch keepalive` fallback).
- `app/layout.tsx` — mounts `<ActivityTracker/>`.

## The report

`scripts/activity-report.ts` reads raw rows and derives **every** number from them in
code (no stored aggregates, nothing estimated; zero activity prints "No activity",
never a fabricated figure). It writes a sub-3-minute TL;DR to:

    /Users/love/Desktop/create/loops/analytics/
        activity-YYYY-MM-DD.md   (dated archive)
        latest.md                (rolling latest)

Run it by hand:

    pnpm activity:report              # last 24h
    pnpm activity:report -- --days 7  # last week
    pnpm activity:report -- --stdout  # print only, don't write files

Inside Claude Code: the `/activity-report` command runs it and shows the TL;DR;
`/loop 24h /activity-report` runs it on a loop while a session is open.

## The daily schedule (launchd)

A macOS user LaunchAgent runs the report every day at **9:00 AM Eastern** (machine is
on America/New_York, so Hour 9 follows DST automatically), even with no Claude session
open.

- `scripts/run-activity-report.sh` — the entry point. Resolves the newest installed
  nvm node dynamically (survives `nvm install` upgrades) and appends every run,
  successes and failures, to `~/Library/Logs/activity-report.log`.
- `~/Library/LaunchAgents/com.opterra.activity-report.plist` — the schedule. Not in
  this repo (machine-specific); the canonical copy of its contents is below.

### Managing it

    # status / last exit code
    launchctl list com.opterra.activity-report

    # run it right now (test)
    launchctl kickstart -k gui/$(id -u)/com.opterra.activity-report

    # change the time: edit StartCalendarInterval in the plist, then reload
    launchctl bootout   gui/$(id -u)/com.opterra.activity-report
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opterra.activity-report.plist

    # stop it permanently
    launchctl bootout gui/$(id -u)/com.opterra.activity-report
    rm ~/Library/LaunchAgents/com.opterra.activity-report.plist

### Plist contents (canonical copy)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.opterra.activity-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>/Users/love/developer/buying-moment-engine/scripts/run-activity-report.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>9</integer>
        <key>Minute</key><integer>0</integer>
    </dict>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key>
    <string>/Users/love/Library/Logs/activity-report.launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/love/Library/Logs/activity-report.launchd.log</string>
</dict>
</plist>
```

## Verifying it works (live, end-to-end)

The report reads `DATABASE_URL` from `.env.local`. To see a real session, the running
app must be this build **and** write to the same database the report reads.

1. Run the app on this branch (`pnpm dev`, or deploy the branch).
2. Sign in with a magic link, click through a few pages.
3. `pnpm activity:report` (or `/activity-report`) — your session appears in the TL;DR:
   your email, org (email domain), the pages, timestamps.

Note: testing on the deployed site only shows up if that deployment's `DATABASE_URL`
is the same database your local `.env.local` points at.
