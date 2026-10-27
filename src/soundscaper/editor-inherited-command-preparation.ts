/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { EditorCommandMutationTransaction } from '../common/editor/commands/mutation-transaction.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { cloneProject } from '../common/editor/project.js';
import { preparePersistedProjectCommandDraft, projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import type { SoundscaperProject } from './editor-project.ts';

type Data = Record<string, unknown>;
const TRACK_CONTROLS = new Set(['name', 'color', 'height', 'mute', 'solo', 'armed', 'gain', 'pan',
	'displayMode', 'halfWave', 'showRms', 'spectrogram', 'collapsed', 'hidden']);

/** Only independent controls share a draft; clock, topology and product edits remain barriers. */
export function shareableInheritedCommand(command: AudioEditorCommand): boolean {
	if (command.type === 'batch') return command.commands.length > 0 && command.commands.every(shareableInheritedCommand);
	if (command.type === 'project/rename' || command.type === 'selection/set') return true;
	return command.type === 'track/update' && Object.keys(command.changes).every(key => TRACK_CONTROLS.has(key));
}

/** Retain original ordering and specialized boundaries in a mixed command tree. */
export function groupInheritedCommandChildren(commands: readonly AudioEditorCommand[]): readonly AudioEditorCommand[] {
	const grouped: AudioEditorCommand[] = [];
	let run: AudioEditorCommand[] = [];
	const flush = (): void => {
		if (run.length === 1) grouped.push(run[0]!);
		else if (run.length) grouped.push({ type: 'batch', commands: run });
		run = [];
	};
	for (const command of commands) {
		if (shareableInheritedCommand(command)) run.push(command);
		else { flush(); grouped.push(command); }
	}
	flush();
	return grouped;
}

/** One owned resolved draft still executes every child admission hook in registry order. */
export function prepareInheritedCommandDraft(project: SoundscaperProject, command: AudioEditorCommand,
	transaction: Readonly<EditorCommandMutationTransaction>): Data {
	assertNoLegacyEnvelopeCommand(command);
	const projection = projectForCommandConsumers(project as unknown as Data) as Data;
	const commanded = cloneProject(projection as never) as unknown as Data;
	transaction.mutate(commanded, command);
	delete dataRecord(commanded.mixer, 'project.mixer').routes;
	// The resulting document re-derives freeze requirements after removed targets retire.
	stripAudioFreezeRequirements(commanded);
	preparePersistedProjectCommandDraft(commanded, project as unknown as Data);
	return commanded;
}

export function stripAudioFreezeRequirements(project: Data): void {
	const manifest = dataRecord(project.featureRequirements, 'project.featureRequirements');
	if (!Array.isArray(manifest.requirements)) throw new TypeError('project.featureRequirements.requirements must be an array.');
	project.featureRequirements = { ...manifest, requirements: manifest.requirements.map((entry: unknown, index: number) =>
		dataRecord(entry, `project.featureRequirements.requirements[${String(index)}]`)).filter(({ featureId }) => featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze) };
}

function assertNoLegacyEnvelopeCommand(command: AudioEditorCommand): void {
	if (command.type === 'batch') { command.commands.forEach(assertNoLegacyEnvelopeCommand); return; }
	if ((command.type === 'track/update' || command.type === 'master/update') && Object.hasOwn(command.changes, 'envelope')) {
		throw new RangeError('Legacy strip envelopes are unavailable under Soundscaper baseline automation-lane authority.');
	}
}

function dataRecord(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}
