/* SPDX-License-Identifier: AGPL-3.0-only */

/** Only a name-only track or clip update can leave the current audio graph intact. */
export function isPlaybackNeutralRename(command: unknown): boolean {
	if (!command || typeof command !== 'object') return false;
	// Inspect data properties without calling caller-owned accessors. The command
	// executor remains responsible for admission and mutation validation.
	const type: unknown = Object.getOwnPropertyDescriptor(command, 'type')?.value;
	const field = type === 'track/update' ? 'name' : type === 'clip/update' ? 'title' : null;
	if (!field) return false;
	const changes: unknown = Object.getOwnPropertyDescriptor(command, 'changes')?.value;
	if (!changes || typeof changes !== 'object') return false;
	const keys = Reflect.ownKeys(changes);
	return keys.length === 1 && keys[0] === field
		&& typeof Object.getOwnPropertyDescriptor(changes, field)?.value === 'string';
}
