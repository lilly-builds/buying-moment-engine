import type { DraftWorkspaceConfig } from "@/src/adapt/schema";
import {
  adapterLineFor,
  OPENER_TURNS,
  type BrandPatch,
  type IntroInput,
} from "./voice";

/**
 * The conversational-onboarding state machine (`/adapt/chat`).
 *
 * A pure, synchronous reducer that owns everything the UI reads: the phase, the
 * message stream, the held draft config, and which pieces of the right-side preview
 * have landed. It reuses the SAME backend as the form flow (`/api/adapt/generate`,
 * `/api/adapt/finalize`); the two async round-trips live in the client component,
 * which dispatches `GENERATED` / `FINALIZED` when they resolve.
 *
 * Choreography lever: an Adapter line and its matching preview reveal are one beat.
 * A user action sets `pendingAdapter`, the component waits a short "thinking" beat,
 * then dispatches `ADAPTER_SPEAK` — which appends the crafted line AND flips the
 * reveal for the current phase, so the left and right sides move in sync.
 */

export type ChatPhase =
  | "opening"
  | "generating"
  | "audience"
  | "signals"
  | "proof"
  | "brand"
  | "finalizing"
  | "done";

export type Role = "adapter" | "user";

export interface Turn {
  id: number;
  role: Role;
  text: string;
}

/** The right-side preview reveal state. `feed` has three stages, the rest are on/off. */
export interface RevealFlags {
  audience: boolean;
  signals: boolean;
  proof: boolean;
  brand: boolean;
  feed: "hidden" | "skeleton" | "filled";
}

export interface ChatState {
  phase: ChatPhase;
  turns: Turn[];
  intro: IntroInput | null;
  draft: DraftWorkspaceConfig | null;
  reveal: RevealFlags;
  /** The Adapter owes a line for the current phase (the component speaks it after a beat). */
  pendingAdapter: boolean;
  finalizeError: boolean;
  /** Bumped on retry so the component's finalize effect re-fires. */
  finalizeNonce: number;
  nextId: number;
}

export type ChatAction =
  | { type: "SUBMIT_INTRO"; companyName: string; whatYouSell: string; websiteUrl: string | null }
  | { type: "ADAPTER_SPEAK" }
  | { type: "GENERATED"; draft: DraftWorkspaceConfig }
  | { type: "EDIT_AUDIENCE"; icp: string }
  | { type: "CONFIRM_AUDIENCE" }
  | { type: "EDIT_SIGNALS"; signals: DraftWorkspaceConfig["signals"] }
  | { type: "CONFIRM_SIGNALS" }
  | { type: "SUBMIT_PROOF"; claim: string }
  | { type: "SKIP_PROOF" }
  | { type: "PICK_COLOR"; patch: BrandPatch }
  | { type: "CONFIRM_BRAND" }
  | { type: "FINALIZED" }
  | { type: "FINALIZE_ERROR" }
  | { type: "RETRY_FINALIZE" };

export function initialState(): ChatState {
  return {
    phase: "opening",
    turns: OPENER_TURNS.map((text, i) => ({ id: i, role: "adapter" as const, text })),
    intro: null,
    draft: null,
    reveal: { audience: false, signals: false, proof: false, brand: false, feed: "hidden" },
    pendingAdapter: false,
    finalizeError: false,
    finalizeNonce: 0,
    nextId: OPENER_TURNS.length,
  };
}

/** Append a turn, advancing the id counter. */
function say(state: ChatState, role: Role, text: string): ChatState {
  return {
    ...state,
    turns: [...state.turns, { id: state.nextId, role, text }],
    nextId: state.nextId + 1,
  };
}

/** The reveal a phase's Adapter line lands together with. */
function revealForPhase(reveal: RevealFlags, phase: ChatPhase): RevealFlags {
  switch (phase) {
    case "audience":
      return { ...reveal, audience: true };
    case "signals":
      return { ...reveal, signals: true };
    case "brand":
      return { ...reveal, brand: true };
    case "finalizing":
      return { ...reveal, feed: "skeleton" };
    case "done":
      return { ...reveal, feed: "filled" };
    default:
      return reveal;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SUBMIT_INTRO": {
      const intro: IntroInput = {
        companyName: action.companyName.trim(),
        whatYouSell: action.whatYouSell.trim(),
        websiteUrl: action.websiteUrl,
      };
      const userText = `${intro.companyName}\n${intro.whatYouSell}`;
      const next = say(state, "user", userText);
      return { ...next, intro, phase: "generating", pendingAdapter: true };
    }

    case "ADAPTER_SPEAK": {
      if (!state.pendingAdapter) return state;
      const line = adapterLineFor(state.phase, { intro: state.intro, draft: state.draft });
      const spoken = line ? say(state, "adapter", line) : state;
      return {
        ...spoken,
        pendingAdapter: false,
        reveal: revealForPhase(spoken.reveal, state.phase),
      };
    }

    case "GENERATED":
      return { ...state, draft: action.draft, phase: "audience", pendingAdapter: true };

    case "EDIT_AUDIENCE": {
      if (!state.draft) return state;
      return {
        ...state,
        draft: { ...state.draft, business: { ...state.draft.business, icp: action.icp } },
      };
    }

    case "CONFIRM_AUDIENCE": {
      const next = say(state, "user", "That's right.");
      return { ...next, phase: "signals", pendingAdapter: true };
    }

    case "EDIT_SIGNALS": {
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, signals: action.signals } };
    }

    case "CONFIRM_SIGNALS": {
      const next = say(state, "user", "Keep them.");
      return { ...next, phase: "proof", pendingAdapter: true };
    }

    case "SUBMIT_PROOF": {
      if (!state.draft) return state;
      const claim = action.claim.trim().slice(0, 300);
      const next = say(state, "user", claim);
      return {
        ...next,
        draft: { ...state.draft, proof: [{ claim, tag: "pending" }] },
        reveal: { ...state.reveal, proof: true },
        phase: "brand",
        pendingAdapter: true,
      };
    }

    case "SKIP_PROOF": {
      if (!state.draft) return state;
      const next = say(state, "user", "I'll add proof later.");
      return {
        ...next,
        draft: { ...state.draft, proof: [] },
        reveal: { ...state.reveal, proof: false },
        phase: "brand",
        pendingAdapter: true,
      };
    }

    case "PICK_COLOR": {
      if (!state.draft) return state;
      return {
        ...state,
        draft: { ...state.draft, brand: { ...state.draft.brand, ...action.patch } },
      };
    }

    case "CONFIRM_BRAND": {
      const next = say(state, "user", "Use this.");
      return { ...next, phase: "finalizing", pendingAdapter: true };
    }

    case "FINALIZED":
      return { ...state, phase: "done", finalizeError: false, pendingAdapter: true };

    case "FINALIZE_ERROR":
      return { ...state, finalizeError: true };

    case "RETRY_FINALIZE":
      return { ...state, finalizeError: false, finalizeNonce: state.finalizeNonce + 1 };

    default:
      return state;
  }
}
