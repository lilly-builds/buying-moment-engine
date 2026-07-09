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
   - Save the step, then click "Create sequence".

3. CONNECTED INBOX:
   - Ensure a sending inbox is connected for the acting user (Settings → General →
     Email, or when the sequence prompts). Without this, enrollment cannot send.

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
3. **Connected inbox** — connect the rep's sending inbox if prompted.
4. **Grab the sequence ID** from the URL (`…/sequence/<ID>`).

---

## Wire it into the app

Set these in `.env.local` (all live-only; empty by default):

```bash
HUBSPOT_SEQUENCE_ID=<the sequence id from step 4>
HUBSPOT_SENDER_EMAIL=<the connected inbox address>
HUBSPOT_SENDER_USER_ID=<the acting user's HubSpot user id>   # from the OAuth token meta
# D9 firewall — the ONLY addresses the app may send to (fail-closed):
SEND_SANDBOX_EMAILS=<your test address, e.g. you+demo@gmail.com>
```

Then the send runs with `createHubSpotSender({ …, provisionProperty: false })` —
`provisionProperty:false` because a typical grant holds `crm.objects.contacts.write`
(the body write) + the Sequences send scope, but **not** `crm.schemas.contacts.write`,
so the property is created here (Part A/B) rather than by the app.

## Gotchas (learned the hard way)
- **Exact internal names.** `gtm_maestro_custom_subject` + `gtm_maestro_custom_body` —
  not the auto-generated variants. The app references these literals; a mismatch fails silently.
- **Subject AND body = token only.** Any other text in either field ships literally.
- **Sequences need a paid/trial Sales seat + a connected inbox.** A free portal
  can't grant the send scope or dispatch the email — verify both before testing.
- **D9:** never enroll a real-practice contact. Test/sandbox addresses only.
