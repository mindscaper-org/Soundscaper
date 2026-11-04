/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTrackCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { recordingTrackRoute, type RecordingRouting } from '../../../recording-routing.js';
import type { RecordingProject } from '../recording-transaction-types.ts';
import type { RecordingStartOptions } from './recording-session-service.ts';

/** Move inputs to fresh destinations, preserving project order and source offsets. */
export function planNewRecordingTracks(
	project: RecordingProject,
	routing: RecordingRouting,
	options: RecordingStartOptions,
	createId: (prefix: string) => string,
	fallbackName: string,
) {
	const multitrack = options.multitrack ?? !options.trackId;
	const targets = multitrack
		? project.tracks.filter(track => track.type === 'audio' && track.armed && recordingTrackRoute(routing.routes, track.id))
		: [project.tracks.find(track => track.type === 'audio' && track.id === options.trackId)];
	if (!targets.length) return null;
	const commands: AudioEditorCommand[] = [];
	const routes = { ...routing.routes };
	let firstTrackId: string | undefined;
	for (const track of targets) {
		const id = createId('track');
		firstTrackId ??= id;
		commands.push(createAddTrackCommand({
			id, type: 'audio', name: track?.name ?? fallbackName,
			color: track?.color, height: track?.height ?? 300, armed: true,
		}, project.sampleRate));
		if (!track) continue;
		if (track.armed) commands.push({ type: 'track/update', trackId: track.id, changes: { armed: false } });
		const route = recordingTrackRoute(routes, track.id);
		if (route) {
			delete routes[track.id];
			routes[id] = route;
		}
	}
	return {
		command: { type: 'batch', commands } as const,
		routing: { routes, offsets: routing.offsets },
		selectTrackId: firstTrackId,
		options: multitrack ? options : { ...options, trackId: firstTrackId },
	};
}
