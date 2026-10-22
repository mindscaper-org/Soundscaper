/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEditorProjectFrameRate } from '../AudioEditorTimeCodeInput.tsx';

/** A local inspector follows its clip's sequence, including audio track ownership. */
export function clipPropertiesFrameRate(project: unknown, clipId: string | null | undefined): number {
	const owner = record(project);
	const clip = records(owner.clips).find(value => value.id === clipId);
	const track = records(owner.tracks).find(value => Array.isArray(value.clipIds) && value.clipIds.includes(clipId));
	const sequences = records(owner.sequences);
	const sequence = typeof clip?.sequenceId === 'string' ? sequences.find(value => value.id === clip.sequenceId)
		: sequences.find(value => Array.isArray(value.trackIds) && value.trackIds.includes(track?.id)
			|| records(value.trackNodes).some(node => node.kind === 'track' && node.id === track?.id));
	return audioEditorProjectFrameRate(sequence ? { ...owner, primarySequenceId: sequence.id } : project);
}

/** Audio source offsets share the local display clock; video offsets own a source rate. */
export function clipPropertiesSourceFrameRate(source: unknown, fallback: number): number {
	const rate = record(record(source).frameRate);
	const num = Number(rate.num), den = Number(rate.den);
	return Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0 ? num / den : fallback;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : {};
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return Array.isArray(value) ? value.filter((item): item is Readonly<Record<string, unknown>> => item !== null
		&& typeof item === 'object' && !Array.isArray(item)) : [];
}
