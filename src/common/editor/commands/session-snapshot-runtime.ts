/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectSourceIds } from '../retention.js';
import { captureSessionSnapshot, readSessionSnapshots, sessionSnapshotName } from '../session-snapshots.ts';
import { restoreSessionSnapshotState } from '../session-snapshot-media.ts';
import type { SessionSnapshotCommand } from './session-snapshot.ts';

export function applySessionSnapshotCommand(projectValue: object, command: SessionSnapshotCommand): void {
	const project = projectValue as Record<string, unknown>;
	if (project.schemaFamily !== 'soundscaper') throw new RangeError('Session snapshots require a Soundscaper project.');
	const metadata = project.metadata as Record<string, unknown>;
	const snapshots = readSessionSnapshots(project);
	if (command.type === 'project/snapshot-create') {
		if (snapshots.some(snapshot => snapshot.id === command.id)) throw new RangeError('This snapshot ID already exists.');
		const currentMetadata = { ...metadata };
		delete currentMetadata.sessionSnapshots;
		const sourceIds = collectProjectSourceIds({ ...project, metadata: currentMetadata });
		metadata.sessionSnapshots = [...snapshots, captureSessionSnapshot(project, command, sourceIds)];
		readSessionSnapshots(project);
		return;
	}
	const snapshot = snapshots.find(candidate => candidate.id === command.id);
	if (!snapshot) throw new ReferenceError(`Unknown session snapshot: ${command.id}.`);
	if (command.type === 'project/snapshot-restore') {
		restoreSessionSnapshotState(project, snapshot);
	} else if (command.type === 'project/snapshot-rename') {
		metadata.sessionSnapshots = snapshots.map(candidate => candidate.id === command.id
			? { ...candidate, name: sessionSnapshotName(command.name) } : candidate);
	} else {
		metadata.sessionSnapshots = snapshots.filter(candidate => candidate.id !== command.id);
	}
}

export function createSessionSnapshotCommandHandlers() {
	return {
		'project/snapshot-create': applySessionSnapshotCommand,
		'project/snapshot-restore': applySessionSnapshotCommand,
		'project/snapshot-rename': applySessionSnapshotCommand,
		'project/snapshot-remove': applySessionSnapshotCommand,
	};
}
