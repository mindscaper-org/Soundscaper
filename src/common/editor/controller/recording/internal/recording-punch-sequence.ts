/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddSourceCommand, type CommandFactoryValue } from '../../../commands/factories.ts';
import { preparePunchCommand } from '../../../commands/range-runtime.js';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { RecordingPunchOptions } from './recording-finalization-types.ts';

/** Prepare successive checkpoints using the owning product's document command runtime. */
export function prepareRecordingPunchSequence<Project>(
	project: Project,
	segments: readonly Readonly<{ source: CommandFactoryValue; punch: RecordingPunchOptions }>[],
	applyCommand: (project: Project, command: AudioEditorCommand) => Project,
): AudioEditorCommand[] {
	let draft = project;
	const commands: AudioEditorCommand[] = [];
	for (const { source, punch } of segments) {
		const addSource = createAddSourceCommand(source);
		const replaceRange = preparePunchCommand(draft, punch) as Extract<AudioEditorCommand, { type: 'punch/replace' }>;
		commands.push(addSource, replaceRange);
		draft = applyCommand(draft, { type: 'batch', commands: [addSource, replaceRange] });
	}
	return commands;
}
