# Turn the tool on — the Connections setup (GTM Maestro / Buying-Moment Engine)

**Purpose:** the one-time setup that switches GTM Maestro from "running on the
builder's demo keys" to "running on **your** account." It's three rows on one
screen — one OAuth click and two pasted keys.

**Who does this:** the Admin / RevOps owner of the account (D14 — for EliseAI,
Kyle Pollak, RevOps). It's a setup step; an AE never sees it.

**Time:** about 5 minutes. **Where:** open **`/integrations`** in the app.

> **You don't have to do this to see the tool work.** The feed, the briefs, the
> editing, the 👍/👎, and the scoreboard all run right now on the builder's own
> keys ("full value before a single key," D14). This guide is how *your* account
> takes over — so the AI spend bills to **you** (it shows up as real cost in the
> scoreboard) and send/CRM write to **your** HubSpot.

---

## The three rows on `/integrations`

| Row | What it turns on | How you connect it | Needed for first go-live? |
|-----|------------------|--------------------|---------------------------|
| **HubSpot** | Send the emails + track leads in your CRM | One **OAuth "Connect"** click | Only for **send + CRM tracking**. The feed & briefs run without it. |
| **Anthropic (Claude)** | Researches each practice + writes the brief | **Paste an API key** | **Yes** — this is the engine. No key, no briefs. |
| **People Data Labs (PDL)** | Finds the decision-maker's verified email + LinkedIn | **Paste an API key** | **Recommended.** Without it, briefs still ship — contacts just fall back to name + role (no verified email). |

**So the shortest path to a full live run is:** paste the **Anthropic** key
(required), paste the **PDL** key (recommended), and **Connect HubSpot** when you
want to actually send and track (its own guide: `hubspot-send-setup.md`).

---

## Row 1 — Anthropic (Claude)  ·  *required*

This is the brain. It reads each practice's real website and reviews, finds the
buying-moment signal, and writes the brief — citing every fact to its source.

1. Go to **[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)**
   and sign in (or make an account).
2. Click **Create key**. Name it something like `gtm-maestro`.
3. **Copy the key** (it starts with `sk-ant-`). You only see it once.
4. In the app, open **`/integrations`** → the **Engine keys** section → the
   **Anthropic (Claude)** card.
5. **Paste** the key and click **Save key**. The pill flips to **Set**. Done.

*Why paste a key instead of "connect"?* AI vendors don't offer a "connect" button
that lets one account spend on another's behalf — so the honest, standard way is a
key you own. Because it's **your** key, every dollar of AI spend is billed to you
and lands in the scoreboard as a real, measured cost (not a guess).

---

## Row 2 — People Data Labs (PDL)  ·  *recommended*

This fills the one thing Claude can't reliably get from a public page: the
decision-maker's **verified work email + LinkedIn URL**.

1. Go to **[dashboard.peopledatalabs.com/api-keys](https://dashboard.peopledatalabs.com/api-keys)**
   and sign in (or make an account — the free tier is enough to start).
2. **Copy** your API key.
3. In the app, open **`/integrations`** → **Engine keys** → the
   **People Data Labs** card.
4. **Paste** the key and click **Save key**. The pill flips to **Set**.

*If you skip it:* nothing breaks. The brief still ships with the contact's **name
and role**; it just won't carry a verified email until a PDL key is set.

---

## Row 3 — HubSpot  ·  *for send + CRM tracking*

One **Connect** click (OAuth) turns on **both** sending the emails (through the
rep's own inbox, with open/click/reply tracking) **and** tracking every
tool-found lead in your CRM. That single grant is the one gate that flips the
Send button live.

- On `/integrations`, click **Connect HubSpot** and approve the access screen.
- The email-send side needs a little more one-time HubSpot config (two custom
  properties + a sequence + a connected inbox). That's its own short guide:
  **`hubspot-send-setup.md`** — with a copy-paste agent prompt, a click-by-click
  version, and screen recordings.

---

## Good to know

- **Keys are encrypted and never shown again.** A pasted key is encrypted at rest
  (the same AES-256-GCM lock the HubSpot tokens use) and read only by the server
  to make calls. It's never displayed back, never sent to the browser, never
  logged. To change one, just paste a new value — **Replace** overwrites it.
- **Server-only.** These keys live server-side. Nothing about them is exposed to
  a visitor's browser.
- **Demo default.** Until you paste your own Anthropic/PDL keys, the tool runs on
  the builder's demo keys, so you can evaluate the whole thing first and connect
  only when you're ready.
- **D9 — nothing writes to your live systems until *you* connect it.** No email
  sends and no CRM writes happen without the HubSpot connect; the engine only ever
  touches **public business** data, never a patient.
