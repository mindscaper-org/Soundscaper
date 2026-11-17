/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep portable rack state, remapping copied guides and bypassing unavailable ones. */
export function pastedAudioEffectRack(value: unknown, trackMap: Readonly<Record<string, string>>,
	trackIds: ReadonlySet<string>): Readonly<{ effects?: readonly unknown[] }> {
	if (!Array.isArray(value)) return {};
	return { effects: value.map((candidate: unknown) => {
		const effect = record(candidate);
		const field = effect?.type === 'audacity-auto-duck' ? 'context' : effect?.type === 'auto-tune' ? 'params' : null;
		if (!effect || !field) return candidate;
		const settings = record(effect[field]), control = settings?.controlTrackId;
		if (typeof control !== 'string' || !control) return candidate;
		const mapped = Object.hasOwn(trackMap, control) ? trackMap[control]! : control;
		if (trackIds.has(mapped)) return mapped === control ? candidate : { ...effect, [field]: { ...settings, controlTrackId: mapped } };
		return { ...effect, enabled: false, [field]: { ...settings, controlTrackId: field === 'context' ? null : '' } };
	}) };
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
