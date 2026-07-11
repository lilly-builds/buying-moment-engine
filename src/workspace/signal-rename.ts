import type { WorkspaceConfig } from "./schema";

/**
 * signal-rename — keep the feed's denormalized signal labels in step with a rename.
 *
 * A workspace stores its signals once in `config.signals`, but every sample-feed
 * prospect carries its own COPY of the names it fires (`sampleFeed[].signals[].name`),
 * denormalized for the feed's filter chips and prospect cards. Rename a signal in
 * the Customization Studio and that copy goes stale, so the feed keeps showing the
 * old label.
 *
 * The fix is a pure rename map, built positionally: a signal at index `i` present
 * in BOTH the loaded config and the edited config, whose name changed, maps
 * old -> new. We only count it as a true in-place rename when the OLD name has
 * genuinely disappeared from the edited set AND the NEW name did not already exist
 * in the initial set. That guard is what stops a removal or reorder (which also
 * shifts names across indices) from being mistaken for a rename and silently
 * relabelling the wrong prospects. Only an exact old-name match in the feed is ever
 * substituted, and nothing else is touched.
 */

type SignalName = Pick<WorkspaceConfig["signals"][number], "name">;
type SampleProspect = WorkspaceConfig["sampleFeed"][number];

/**
 * Build the old-name -> new-name map by matching signals on array index. An index
 * that exists in both arrays and whose name changed (both sides non-empty) is a
 * rename ONLY IF the old name is now absent from `edited` and the new name was
 * absent from `initial` — otherwise the index shift is a removal/reorder, not a
 * rename, and is skipped.
 */
export function buildSignalRenameMap(
  initial: readonly SignalName[],
  edited: readonly SignalName[],
): Map<string, string> {
  const renames = new Map<string, string>();
  const shared = Math.min(initial.length, edited.length);
  for (let i = 0; i < shared; i++) {
    const from = initial[i].name;
    const to = edited[i].name;
    if (from === to || from.length === 0 || to.length === 0) continue;
    // A removal or reorder shifts a still-present name into this slot, or slides an
    // already-existing name up. Neither is a rename: skip so the feed is untouched.
    const oldNameStillPresent = edited.some((s) => s.name === from);
    const newNameAlreadyExisted = initial.some((s) => s.name === to);
    if (oldNameStillPresent || newNameAlreadyExisted) continue;
    renames.set(from, to);
  }
  return renames;
}

/**
 * Return a new sample feed with every `signals[].name` that exactly equals an old
 * name replaced by its new name. Immutable: prospects and signals that change are
 * rebuilt; the map is applied to a shallow copy so the input is never mutated.
 */
export function applySignalRenamesToSampleFeed(
  sampleFeed: readonly SampleProspect[],
  renames: ReadonlyMap<string, string>,
): SampleProspect[] {
  if (renames.size === 0) return [...sampleFeed];
  return sampleFeed.map((prospect) => ({
    ...prospect,
    signals: prospect.signals.map((signal) => {
      const renamed = renames.get(signal.name);
      return renamed === undefined ? signal : { ...signal, name: renamed };
    }),
  }));
}
