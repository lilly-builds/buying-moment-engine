/**
 * The HubSpot SEQUENCE-setup prompt — the one send step no API can automate
 * (HubSpot has no create/edit-sequence endpoint). The RevOps leader pastes this
 * into the Claude for Chrome extension; the agent verifies/creates the six contact
 * properties, builds the dynamic sequence, and writes the sequence ID back into
 * GTM Maestro's "Sequence ID" field (STEP D), so the leader pastes nothing.
 *
 * SOURCE OF TRUTH: onboarding/hubspot-setup-handoff.md Path (2) — kept in sync with
 * this constant. This is the Jul-13 real-run-validated version; edit deliberately:
 *  - STEP A stays a VERIFY-and-complete step (not "skip"): the app auto-provisions
 *    the six properties at connect, but a portal connected before per-touch copy /
 *    the crm.schemas.contacts scope shipped can be missing some or all. A real run
 *    (2026-07-13) found only 2 of 6. So the agent verifies and creates the missing.
 *  - The six token names ("GTM Maestro Custom Subject[/2/3]" + "…Body[/2/3]") MUST
 *    equal the property LABELS provisioned in src/send/hubspot-send.ts — the agent
 *    picks each token by that label. connections.test.ts locks the two together, so
 *    keep each token name on ONE line (no wrapping mid-name).
 *  - The STEP D "read the ID → Save → VERIFY the badge" flow closes the zero-paste
 *    loop; the "STOP before anything that would send" guardrail keeps D9. Both are
 *    covered by connections.test.ts — keep those exact phrases.
 */
export const HUBSPOT_SEQUENCE_PROMPT = `Set up my HubSpot so the GTM Maestro email-send works. I'm logged into HubSpot in
Chrome. Do the steps below in my account, STOP before anything that would send an
email, and report the sequence ID at the end. Be efficient — use find/read_page,
don't over-screenshot, and lean on HubSpot's own docs if you get stuck.

STEP A — Custom contact properties. The app is MEANT to auto-provision all six at
  connect, but DO NOT assume they exist. Verify first. If the connect predated this
  feature, or the OAuth grant was missing the crm.schemas.contacts scope, or the connect
  failed, you will find some or ALL of them missing. Search "gtm_maestro" under Contact
  properties and CREATE any that are missing. (Real run, 2026-07-13: only 2 of the 6
  existed; the other 4 were made by hand, which the app tolerates on a later connect since
  ensureSendProperties is idempotent.) Settings (gear) → Properties → object
  "Contact properties" → Create property. Create all six (skip any that already EXIST,
  search first):
  - Single-line text, internal name exactly: gtm_maestro_custom_subject   (Touch 1)
  - Multi-line text,  internal name exactly: gtm_maestro_custom_body      (Touch 1)
  - Single-line text, internal name exactly: gtm_maestro_custom_subject_2 (Touch 2)
  - Multi-line text,  internal name exactly: gtm_maestro_custom_body_2    (Touch 2)
  - Single-line text, internal name exactly: gtm_maestro_custom_subject_3 (Touch 3)
  - Multi-line text,  internal name exactly: gtm_maestro_custom_body_3    (Touch 3)
  The exact internal names are load-bearing — the app matches these literal strings. Click
  the </> icon on each to set the internal name, and give each property the LABEL that
  matches its token in STEP B (e.g. "GTM Maestro Custom Subject 2"), so the sequence step
  below can find it. For any of the six that ALREADY exist, don't recreate them, but open
  each and CHECK its label: an older setup can show a different label such as
  "GTM Maestro — email subject". If a property's label is not exactly its STEP B token name,
  rename the label to match (leave the internal name as-is) — a mismatched label is the exact
  reason an email step can't find its token.

STEP B — The DYNAMIC sequence (3-touch, with the click→call-task handoff built in):
  Automation → Sequences → Create a sequence → "Create a dynamic sequence" → name "GTM Maestro".

  Automated-outreach branch — THREE automated email steps, EACH tokenized to its own
  touch pair so every email carries the AE's edited copy (not a static bump):
  - Email 1 (Touch 1, sends on enroll): step = "Automated email". Insert ONLY the two
    personalization tokens (delete ALL other text): Subject = the "GTM Maestro Custom Subject" token, Body = the "GTM Maestro Custom Body" token.
  - Email 2 (Touch 2): the "+" under Email 1 → "Automated email" → email type = "Reply"
    (same thread). Subject = the "GTM Maestro Custom Subject 2" token; Body = the "GTM Maestro Custom Body 2" token. **Below the body token, add ONE tracked link.** The
    click-only signal needs a real link to fire, and the AE's touch bodies carry no URLs by
    design, so the link lives in the template. Use a NATIVE HubSpot Meetings link if one
    exists (Insert → Meetings): only that makes the "books a meeting → unenroll" rule and an
    actual booking work. If no Meetings page is set up yet (Insert → Meetings shows an empty
    "Get started" state), ANY tracked link still fires the click signal, so drop a placeholder
    in to unblock setup, but FLAG it loudly: with a placeholder a lead who clicks lands
    nowhere and can never book, so the booking half of the design is inert until a real
    Meetings link replaces it. (Real run, 2026-07-13: no Meetings page existed, so a
    placeholder "Book a 15-minute call" link to hubspot.com was used and flagged for swap.)
    Delay defaults to 1 business day, leave it.
  - Email 3 (Touch 3): "+" → "Automated email" → "Reply". Subject = the "GTM Maestro Custom Subject 3" token; Body = the "GTM Maestro Custom Body 3" token. Click its
    delay chip and set it to 3 business days.
  REALITY on reply subjects (2026-07-13): because Emails 2 & 3 are "Reply" (same thread),
  the SENT subject inherits Email 1's thread subject. The \`_2\` / \`_3\` subject tokens are
  stored in the templates but do NOT render as the outgoing subject; only the BODIES vary
  per touch. Set the \`_2\` / \`_3\` subject tokens anyway (harmless, and future-proof if a step
  is ever switched to "New thread"), but know the per-touch SUBJECT copy the app writes is
  inert on the replies. If per-touch subjects must actually show, those steps have to be
  "New thread", not "Reply" (which the same-thread design deliberately trades away for
  better follow-up deliverability).
  Why tokens (not static bumps): the app writes each email touch's edited subject + body into
  the matching pair (\`_2\` / \`_3\`) in ONE contact update, then enrolls once, and HubSpot drips
  each email rendering its own touch's copy. Re-pointing Emails 2 & 3 from a static template to
  these tokens is the ONE manual step (there is no create/edit-sequence or template API).
  GOTCHA (2026-07-13): Emails 2 & 3 can SHARE one template (a pre-built sequence had both
  pointing at a single "GTM Maestro — Follow-up 1 (bump)" template). Editing a shared template
  in place rewrites BOTH steps with the same touch's tokens, so one email ends up wrong. Give
  EACH email its OWN template: create a fresh one for Email 2 (e.g. "GTM Maestro — Touch 2"),
  then edit and rename the shared one for Email 3 (to "GTM Maestro — Touch 3"), so Email 2
  carries the \`_2\` tokens and Email 3 the \`_3\` tokens. Before editing any template in place,
  confirm no other step points at it (open each step's "Edit email" and check the template name).
  The brief's outreach sequence is EMAIL-ONLY (2026-07-10, PR #25): Touch 1/2/3 are ALWAYS
  emails, so all three positions fill and step N always renders touch N's copy, with no empty
  steps. The phone call is a separate rep Call-task at the end (fired by the click signal),
  never a tokenized email step. (This supersedes the old "Touch 2 is call-or-email, keep it at
  a safe position" caveat, which no longer applies.)

  Engagement signal — CLICK ONLY (the key setting):
  - Click the gear on "Signals" → turn Email OPENS **OFF**, keep Clicks **ON, count 1**.
    (Opens are unreliable post-Apple-MPP; a click is the real buying signal.) Label should
    then read "Signal: 1 click."

  Rep-led branch — the human handoff:
  - Add a "Call task" titled "Call contact to follow up" (it's marked "Pauses sequence" —
    correct). When the lead clicks, automated emails stop and this task lands in the rep's queue.

  Unenroll — Automate tab, turn BOTH ON:
  - "When a contact replies to any email → Unenroll" (stops the follow-ups on a reply).
  - "When a contact books a meeting → Unenroll".

  SAVE ("Save existing sequence", bottom-left) — the sequence isn't created/updated until you Save.
  A dynamic sequence also needs the rep Call-task above (it won't save with only automated steps).

  Note on delays: HubSpot enforces a MINIMUM 1 business day between automated emails (you
  cannot set 0). Correct for real cadence — it just means testing spans days (business days
  skip weekends). Verify Touch 1 lands + Touches 2/3 show as scheduled; don't wait a week.

STEP C — Connect the sending inbox (the user does the consent):
  Guide me to the exact page and point at exactly where to click. Settings → General →
  Email tab → "Connect personal email" → Gmail/Outlook. PAUSE and tell me to sign in +
  grant access — it's a Google/Microsoft consent only I can click. Without a connected
  inbox, enrollment returns HTTP 400 PUBLIC_ENROLL_NO_CONNECTED_EMAILS.

STEP D — Wire the sequence ID into GTM Maestro FOR them (don't hand back homework):
  The RevOps leader should paste NOTHING. You already have the browser — finish the loop:
  1. Read the sequence's NUMERIC ID from the URL after /sequence/ (NOT the first number,
     which is the portal id — e.g. …/sequence/712515259/steps → 712515259).
  2. In the SAME browser, open GTM Maestro → Integrations page (the screen this prompt came
     from). If GTM Maestro asks me to sign in first, guide me to sign in, then continue.
     Under "Your sending sequence", type that ID into the "Sequence ID" field and click "Save sequence ID".
  3. VERIFY it took: the badge flips to "Set" and a line confirms the sequence number.
     If it doesn't, say so — don't claim done.
  This is the ONE send setting the app can't capture automatically (HubSpot has no list-
  sequence API). The sending inbox + HubSpot user id were captured at connect, so the ID
  is the only piece left — and you set it, so the user does zero manual work.

  Then report back: the sequence ID you saved, which inbox is connected, and that the
  property internal names are exact.

  (Field is login-protected — you're acting as the signed-in user in their browser, using
  the same screen + Save button a human would, so no keys/API are involved.)

GUARDRAIL: this is SETUP only. Do NOT enroll or send to anyone — the app does the
sending, and only to sandbox/test addresses (D9).

UI FIELD NOTES (from a real build — match by these LABELS/positions, NOT coordinates; the
panels look the same regardless of screen size, so anchor on the text):
- Sequences list: top-right orange "Create sequence" (has a dropdown caret).
- A sequence's detail page has tabs: Performance · Enrollments · Steps · Settings · Automate.
  "Steps" opens the builder; "Automate" holds the unenroll toggles.
- Builder canvas: a GREEN "Automated outreach" card over the left column of email steps, and
  a PINK "Rep-led outreach" card over the right column (the Call task). Between the two
  columns, on the connecting line, is "Signals: …" with a small GEAR — that gear opens the
  engagement-signal editor.
- Add a step: click the small "+" circle BELOW an email card → an inline "Configure your next
  step" panel appears → choose "Automated email".
- "Choose email type" panel slides in from the RIGHT: radios "Reply — send as a reply to a
  previous email" (default; correct for follow-ups) vs "New thread". Pick which email to reply
  to, then bottom-right "Next: Add email content".
- "Add automated email" panel: "Choose an existing email template or create a new one" — an
  "All templates" dropdown, a "Create new" button (top-right), and the template list. To
  SELECT an existing template, click its blue TITLE link (clicking the row only highlights it).
- "Create new template" is a full-screen modal: Template name → Subject (blank is fine for a
  Reply) → body compose area → insert tokens with the "Insert" / personalization control →
  "Save template" (orange, bottom-LEFT). GOTCHA: while the body has focus the modal keeps
  scrolling back to the top — click a neutral spot (the right-hand preview pane) to blur the
  body first, THEN scroll down to reach "Save template".
- Delay: an orange-outlined "Delay: N business day(s)" chip sits between email cards. Click it
  → a "Business days" popover (number field + up/down steppers + Save). GOTCHA: 0 is REJECTED
  (Save greys out) — the minimum is 1. Set Email 3's to 3.
- Signals gear → "Edit Engagement Signals" panel (right): an "Email opens" ON/OFF toggle + a
  Count, and a "Clicks" ON/OFF toggle + a Count. Turn Email opens OFF, keep Clicks ON with
  Count 1, Save. The canvas label then reads "Signal: 1 click".
- Save the sequence: a bottom action bar — "Save existing sequence" / "Save as new sequence"
  / "Cancel". GOTCHA: it can sit below the fold — scroll down to reach it. Nothing persists
  until you click it.
- Sanity check (Steps-tab header): "Automated steps 3 · Manual steps 1 · Unenroll criteria 2",
  and the canvas shows "Signal: 1 click".
- Sequence ID (STEP D): the number in the URL between /sequence/ and the next slash
  (e.g. …/sequence/712515259/steps → 712515259 — NOT the portal id earlier in the URL).`;
