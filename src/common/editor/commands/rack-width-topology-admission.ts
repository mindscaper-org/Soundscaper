/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../i18n/presentation-message.ts';
import { activeRackWidthViolations, type RackChannelProject } from '../rack-effect-channel-width.ts';
import type { AudioEditorCommand } from './protocol.ts';

/** Check the reconciled transaction, permitting passive legacy state and atomic repairs. */
export function createRackWidthTopologyAdmission(base: unknown) {
	let changed = false;
	return Object.freeze({
		beforeCommand(_project: unknown, command: AudioEditorCommand): void {
			changed ||= changesTopology(command);
		},
		afterCommand(_project: unknown): void {},
		assertPersistedResult(result: unknown): void {
			if (!changed || !rackProject(base) || !rackProject(result)) return;
			const before = activeRackWidthViolations(base);
			if ([...activeRackWidthViolations(result)].some(violation => !before.has(violation))) {
				throw createLocalizedError(RangeError, {}, 'effectUnsupported', undefined, { fallback: 'This effect is not supported.' });
			}
		},
	});
}

function changesTopology(command: AudioEditorCommand): boolean {
	switch (command.type) {
		case 'clip/move': return command.trackId !== undefined;
		case 'clip/transform-many': return command.transforms.some(item => item.trackId !== undefined || item.changes.sourceId !== undefined);
		case 'clip/overwrite': return command.trackId !== undefined || command.changes?.sourceId !== undefined;
		case 'clip/update': return command.changes.sourceId !== undefined;
		case 'track/update':
		case 'master/update': return command.changes.effectsActive === true;
		case 'mixer/bus-update': return command.changes.effectsActive === true || command.changes.channelCount !== undefined;
		case 'effect/update': return command.changes.enabled === true || command.changes.bypassed === false || command.changes.type !== undefined;
		case 'clip/add':
		case 'clip/remove':
		case 'clip/remove-many':
		case 'clip/replace-source':
		case 'clip/regenerate-tts':
		case 'clip/render-replace-many':
		case 'range/replace':
		case 'range/lift-delete':
		case 'range/ripple-delete':
		case 'range/per-clip-ripple-delete':
		case 'range/keep':
		case 'clipboard/paste':
		case 'punch/replace':
		case 'edit/insert':
		case 'edit/overwrite':
		case 'project-bin/place':
		case 'project-bin/move-from-timeline':
		case 'project-bin/replace-media':
		case 'track/add':
		case 'track/remove':
		case 'mixer/bus-add':
		case 'mixer/bus-remove':
		case 'mixer/route-update':
		case 'mixer-graph/set':
		case 'take-comp/flatten':
		case 'audio-freeze/commit':
		case 'effect/add': return true;
		default: return false;
	}
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function records(value: unknown): boolean {
	return value === undefined || (Array.isArray(value) && value.every(record));
}
function owner(value: unknown): boolean {
	return record(value) && (value.effectsActive === undefined || typeof value.effectsActive === 'boolean')
		&& (value.effects === undefined || (Array.isArray(value.effects) && value.effects.every(effect => record(effect)
			&& (effect.enabled === undefined || typeof effect.enabled === 'boolean')
			&& (effect.bypassed === undefined || typeof effect.bypassed === 'boolean'))));
}
/** Validate only the read surface; the transaction owns full native document validation. */
function rackProject(value: unknown): value is RackChannelProject {
	if (!record(value) || !records(value.sources) || !records(value.clips) || !records(value.tracks)) return false;
	if (Array.isArray(value.tracks) && !value.tracks.every(track => owner(track) && record(track)
		&& (track.clipIds === undefined || Array.isArray(track.clipIds)))) return false;
	if (value.master !== undefined && !owner(value.master)) return false;
	if (value.masterChannels !== undefined && typeof value.masterChannels !== 'number') return false;
	if (value.automationLanes !== undefined && !Array.isArray(value.automationLanes)) return false;
	if (value.mixer === undefined) return true;
	if (!record(value.mixer)) return false;
	for (const buses of [value.mixer.groups, value.mixer.sends]) {
		if (buses !== undefined && (!Array.isArray(buses) || !buses.every(owner))) return false;
	}
	const routes = value.mixer.routes;
	return routes === undefined || (record(routes) && Object.values(routes).every(route => record(route)
		&& (route.sends === undefined || record(route.sends))));
}
