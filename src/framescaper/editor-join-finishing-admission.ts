/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectFinishing } from './editor-project-finishing-validation.ts';

/** One joined clip cannot represent two different clip-owned finishing chains. */
export function assertJoinedCameraFinishing(project: FramescaperProjectFinishing, command: unknown): void {
	if (!command || typeof command !== 'object' || !('type' in command)) return;
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		for (const child of command.commands) assertJoinedCameraFinishing(project, child);
		return;
	}
	if (command.type !== 'clip/join'
		|| !('clipIds' in command) || !Array.isArray(command.clipIds)) return;
	const selected = new Set<unknown>(command.clipIds);
	const clips: readonly unknown[] = Array.isArray(project.clips) ? project.clips : [];
	const cameras = clips.filter((clip): clip is Readonly<{ id: string }> => Boolean(clip
		&& typeof clip === 'object' && 'kind' in clip && clip.kind === 'video'
		&& 'id' in clip && typeof clip.id === 'string' && selected.has(clip.id)));
	if (cameras.length < 2) return;
	const finishes = new Map<string, unknown[]>();
	for (const presentation of project.videoVisualPresentations) {
		if (presentation.owner.kind !== 'clip' || !selected.has(presentation.owner.id)) continue;
		const { id: _id, owner: _owner, ...processing } = presentation;
		const values = finishes.get(presentation.owner.id) ?? [];
		values.push(processing);
		finishes.set(presentation.owner.id, values);
	}
	const expected = JSON.stringify(finishes.get(cameras[0]!.id) ?? []);
	if (cameras.some(clip => JSON.stringify(finishes.get(clip.id) ?? []) !== expected)) {
		throw new RangeError('Clips with different finishing processing must be rendered before joining.');
	}
}
