/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SelectedLabelRef { readonly trackId: string; readonly labelId: string; }
export interface SelectedLabelState {
	selectedLabels?: readonly SelectedLabelRef[];
	selectedLabelsProjectId?: string | null;
}

/** Transient label identities are scoped to their document and filtered after native edits/Undo. */
export function selectedLabelsForProject(project: unknown, state: Readonly<SelectedLabelState>): readonly SelectedLabelRef[] {
	if (!state.selectedLabels?.length) return [];
	if (!isRecord(project) || project.id !== state.selectedLabelsProjectId || !Array.isArray(project.tracks)) return [];
	const ids = new Map<string, Set<string>>();
	const requested = new Set(state.selectedLabels.map(ref => ref.trackId));
	for (const track of project.tracks as unknown[]) if (isRecord(track) && track.type === 'label' && typeof track.id === 'string' && requested.has(track.id) && Array.isArray(track.labels)) {
		ids.set(track.id, new Set((track.labels as unknown[]).flatMap(label => isRecord(label) && typeof label.id === 'string' ? [label.id] : [])));
	}
	return (state.selectedLabels ?? []).filter(ref => ids.get(ref.trackId)?.has(ref.labelId));
}

/** Upstream pastes onto the focused label track, otherwise the first label track. */
export function labelClipboardTarget(project: unknown, focusedTrackId: string | null) {
	if (!isRecord(project) || !Array.isArray(project.tracks)) return null;
	let first: (Record<string, unknown> & { id: string }) | null = null;
	for (const track of project.tracks as unknown[]) {
		if (!isRecord(track) || track.type !== 'label' || typeof track.id !== 'string') continue;
		const candidate = track as Record<string, unknown> & { id: string };
		first ??= candidate;
		if (track.id === focusedTrackId) return candidate;
	}
	return first;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
