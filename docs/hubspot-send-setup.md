# Configure HubSpot for email sending (GTM Maestro / Buying-Moment Engine)

**Purpose:** one-time setup that makes the app's email SEND path (U11 — HubSpot
Sequences via the whole-body-`{{custom_body}}`-token trick) actually deliver. After
this, the app can write an AE's edited body into one contact property and enroll a
contact so it sends through the rep's own inbox with native open/click/reply tracking.

**Who does this:** the Admin / RevOps owner of the HubSpot portal (D14). It is a
setup step, not something an AE ever sees.

**Time:** ~5 minutes. **You need:** a HubSpot portal with **Sequences enabled**
(paid Sales Hub Pro seat, or a trial with Sales tools), a **connected sending
inbox**, and the "GTM Maestro" app already connected (the "Connect HubSpot" grant).

---

## Part A — Copy‑paste prompt (run in Claude Code or the Claude Chrome extension)

> Paste everything in this block. It drives an agent to do the setup in your live
> HubSpot. It only *creates configuration* — it never sends an email itself, and it
> touches no real practice (D9).

```text
You are configuring my HubSpot portal so the GTM Maestro email-send path works.
Do these steps in my HubSpot (I'm logged in), and STOP to show me before anything
that would send an email. Report the sequence ID at the end.

1. TWO CUSTOM PROPERTIES (hold the AE's edited subject + body):
   - Go to Settings → Properties → object "Contact properties" → Create property.
   - Property A — Field type: Single-line text. Label: "GTM Maestro Custom Subject".
     Internal name MUST be exactly:  gtm_maestro_custom_subject
   - Property B — Field type: Multi-line text.  Label: "GTM Maestro Custom Body".
     Internal name MUST be exactly:  gtm_maestro_custom_body
   - For each: open the </> internal-name editor and set the name VERBATIM — the app
     matches these exact strings; a mismatch silently breaks the send. Verify both exist.

2. SEQUENCE (the send vehicle):
   - Go to Automation → Sequences → Create a sequence → Start from scratch.
   - Name it "GTM Maestro custom send".
   - Add ONE step: "Automated email".
   - In that email, use ONLY personalization tokens (no other text):
       Subject = {{ contact.gtm_maestro_custom_subject }}
       Body    = {{ contact.gtm_maestro_custom_body }}
   - A DYNAMIC sequence will NOT save with only one step. Add a SECOND step —
     a rep-led "Call task" (e.g. title "Call contact to follow up") is fine. It only
     queues for the rep after engagement; it does not affect the automated email
     that carries our tokens.
   - Click Save. THEN read the sequence's numeric id from the URL (the number that
     replaces `new-dynamic` in `…/sequence/<ID>/edit`).

3. CONNECTED INBOX (MANDATORY — the enrollment API refuses without it):
   - Settings (gear) → Your Preferences "General" → "Email" tab → "Connect personal
     email" → Gmail/Outlook → OAuth consent as the ACTING user's address.
   - The acting user (the one whose userId enrolls) must be the one whose inbox is
     connected. Without it the enrollment returns HTTP 400
     `SequenceStandardFriendlyError.PUBLIC_ENROLL_NO_CONNECTED_EMAILS`:
     "User <id> for Portal <id> has no connected inboxes … required to enroll from
     the public API." This is a Google OAuth consent — no CLI/API can do it headlessly.

4. HAND BACK:
   - The sequence's numeric ID (the number in the URL after /sequence/).
   - Confirm the property internal name is exactly gtm_maestro_custom_body.
   - Confirm which inbox is connected as the sender.

GUARDRAIL: do not enroll or send to anyone in this setup. Sending is done separately
by the app, and ONLY to sandbox/test addresses (D9).
```

---

## Part B — Human click‑by‑click (fallback / verification)

1. **Two custom properties** (Settings → **Properties** → **Contact properties** → **Create property**)
   - **Subject** — Field type: Single-line text. Label `GTM Maestro Custom Subject`.
     Click **`</>`** and set the internal name to exactly `gtm_maestro_custom_subject`. Create.
   - **Body** — Field type: Multi-line text. Label `GTM Maestro Custom Body`.
     Click **`</>`** and set the internal name to exactly `gtm_maestro_custom_body`. Create.
2. **Sequence**
   - **Automation → Sequences → Create a sequence → Start from scratch.** Name it.
   - **Step 1 → Automated email.** Using the Personalize / contact-token menu (remove all
     other text): **Subject** = `{{ contact.gtm_maestro_custom_subject }}`,
     **Body** = `{{ contact.gtm_maestro_custom_body }}`. **Save**, then **Create sequence**.
   - **Add a 2nd step** (a rep "Call task") — a dynamic sequence can't save on one
     step. **Save**, then read the numeric id from the URL (replaces `new-dynamic`).
3. **Connected inbox** (required) — gear → **General** → **Email** tab →
   **Connect personal email** → Gmail/Outlook → consent as the acting user. Skipping
   this makes enrollment 400 (`PUBLIC_ENROLL_NO_CONNECTED_EMAILS`).
4. **Grab the sequence ID** from the URL (`…/sequence/<ID>`).

---

## Wire it into the app

The sequence + sender are now **per-connection** (not env) — each connected portal
runs its own. `sender_email` + `sender_user_id` **auto-capture from the OAuth token
meta at connect**; `sequence_id` is pasted on the **Connections page** ("Your sending
sequence"), because HubSpot has no create/list-sequence API. All three live on the
`crm_connections` row.

- **New portal:** connect HubSpot → finish the sequence setup above → paste the
  sequence id on `/integrations`. Done.
- **The existing dev connection** (predates these columns): `pnpm db:backfill:send-config`
  fills it once (sequence `712515259`, inbox `hellolillyfield@gmail.com`, user `95142122`).

Only the D9 firewall stays env — it's the firewall, not per-tenant data (fail-closed):

```bash
# The ONLY addresses the app may send to. Empty => nothing sends.
SEND_SANDBOX_EMAILS=<your test address, e.g. you+demo@gmail.com>
```

Then the send runs with `createHubSpotSender({ …, provisionProperty: false })` —
`provisionProperty:false` because a typical grant holds `crm.objects.contacts.write`
(the body write) + the Sequences send scope, but **not** `crm.schemas.contacts.write`,
so the property is created here (Part A/B) rather than by the app.

## Deferred follow-up (after HubSpot send is proven live)
- **Subject editability in UI + DB (U9/U6).** The send path already ships an
  editable subject (it writes `gtm_maestro_custom_subject`), but the AE cannot yet
  *edit and persist* a subject: `db/schema/brief.ts` `sequences` has `body`/`cta`
  but no `subject` column, and the U9 inline sequence editor has no subject field.
  Add: a `subject` column (migration) + a per-touch subject input in the brief
  card's sequence editor, so the edited subject flows sequence row → send path.
  Deferred deliberately until the live HubSpot send is proven end-to-end.
- **Multi-touch mapping onto HubSpot enrollment (verify live).** The app owns the
  3-touch cadence and models each touch as its own write-body + enroll. Confirm how
  that maps onto one HubSpot sequence: can the same contact be re-enrolled per touch,
  or does an active enrollment block it (→ unenroll-then-re-enroll, or one enrollment
  per touch via distinct single-step sequences)? The first live send proves ONE touch;
  resolve the 3-touch mechanics when multi-touch is exercised.

## Gotchas (learned the hard way)
- **Exact internal names.** `gtm_maestro_custom_subject` + `gtm_maestro_custom_body` —
  not the auto-generated variants. The app references these literals; a mismatch fails silently.
- **Subject AND body = token only.** Any other text in either field ships literally.
- **Sequences need a paid/trial Sales seat + a connected inbox.** A free portal
  can't grant the send scope or dispatch the email — verify both before testing.
- **D9:** never enroll a real-practice contact. Test/sandbox addresses only.
