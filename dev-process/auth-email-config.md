# Auth email configuration (magic-link sign-in)

**Status: Live in production as of 2026-07-14.**

All of this is Supabase dashboard configuration on the `buying-moment-engine`
project (ref `grfitrxtheolzfuautse`). There is no app code involved, so it took
effect the moment it was saved. No deploy is required to make any of it work, and
the production site (`buying-moment-maestro.vercel.app`) uses this same project.

This file exists because Supabase dashboard config and email templates are not
otherwise version-controlled. If the dashboard is ever reset or the project
recreated, this doc plus the archived HTML in `./auth-email-templates/` is how you
restore the setup.

## What is configured

### 1. Custom SMTP through Resend (fixes the "email rate limit exceeded" throttle)

Supabase's built-in email sender is a shared test relay capped at a few messages
per hour, total, across everyone. On the magic-link flow that surfaced as
"email rate limit exceeded": the second person requesting a link in the same hour
was locked out. Auth emails now route through the paid Resend account instead.

Supabase: Authentication > Emails > SMTP Settings > Enable Custom SMTP = ON

- Sender email: `noreply@opterraventures.com`
- Sender name: `GTM Maestro`
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: a Resend API key named `supabase-smtp` (permission: Sending access).

The Resend key lives ONLY in the Supabase SMTP password field. It is never in this
repo, in `.env.local`, or in git. The Resend domain `opterraventures.com` is verified.

### 2. Email sending rate limit

Supabase: Authentication > Rate Limits > "Rate limit for sending emails" = **100 / hour**.
(Turning on Custom SMTP auto-raised it from the built-in cap to 30; we raised it to 100
to give reviewers and the team headroom.)

### 3. URL configuration

Supabase: Authentication > URL Configuration

- Site URL: `https://buying-moment-maestro.vercel.app`
- Redirect URLs include the production wildcard and `http://localhost:3000/**` for local dev,
  so a local magic link returns to localhost and a production one returns to production.

### 4. Branded email templates

The default "Confirm your email address" copy was replaced with a branded GTM Maestro
welcome on both templates the magic-link flow can send:

- **Confirm sign up** (new reviewers, first sign-in) - subject:
  `Welcome to GTM Maestro. Here's your sign-in link.`
- **Magic link or OTP** (returning users) - subject: `Your GTM Maestro sign-in link.`

The exact HTML for each is archived in `./auth-email-templates/`.

## Verified (2026-07-14)

- Six sign-in emails delivered through Resend within about four minutes with no
  "email rate limit exceeded" (Resend > Emails, all showed "Delivered").
- A real sign-in on the production site, requesting and clicking in the same normal
  browser, signs in and lands on the feed.
- The branded email renders correctly in a real inbox.

## Known gotcha: magic-link reliability

The magic link is a one-time link tied to the browser session that requested it
(PKCE). It can appear to fail with "That sign-in link could not be used" when:

- the link is opened in a different browser or session than the one that requested it
  (for example requesting in incognito, then clicking in a normal window),
- more than one link was requested and an older one is clicked (only the newest works),
- a corporate email scanner pre-opens the link and burns it before the person clicks.

Normal usage (request once in a normal browser, click once) works reliably. Guidance
for reviewers: use a normal browser, and if a link ever says it expired, just request
a fresh one.

If this ever needs to be bulletproof against email scanners, the hardening path is a
6-digit code the user types (`verifyOtp`), which removes the clickable link entirely.
That was considered and deferred; "ship as-is with the graceful retry line" was chosen.
