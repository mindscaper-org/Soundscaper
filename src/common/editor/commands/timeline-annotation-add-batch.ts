/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import { createTimelineAnnotationsV11, type TimelineAnnotationV11 } from '../timeline-annotation.ts';
import { restoreTimelineAnnotationsFromRuntimeProjection, resolveRuntimeTimelineAnnotationsInDocumentOrder,
	type RuntimeTimelineAnnotationProject, type RuntimeTimelineAnnotationProjection } from '../runtime-timeline-annotation-projection.ts';
import type { AudioEditorCommand, EditorCommandProject } from './protocol.ts';

type AddCommand = Extract<AudioEditorCommand, { type: 'timeline-annotation/add' }>;
interface AppendRun { readonly rows: ReadonlyMap<object, RuntimeTimelineAnnotationProjection>;
	readonly target: RuntimeTimelineAnnotationProjection[]; }
const ownedRuns = new WeakMap<object, AppendRun>();

/** Each original child still passes the transaction's before/after admissions. */
export function dispatchTimelineAnnotationAppendRuns(
	project: EditorCommandProject, commands: readonly AudioEditorCommand[],
	dispatchChild: (project: EditorCommandProject, command: AudioEditorCommand) => void,
): void {
	let index = 0;
	while (index < commands.length) {
		const first = index;
		while (commands[index]?.type === 'timeline-annotation/add') index += 1;
		if (index - first > 1 && isTimelineAnnotationProjectSchema(project) && isRuntimeProjectProjection(project)) {
			const additions = commands.slice(first, index) as readonly AddCommand[];
			const prior = ownedRuns.get(project);
			ownedRuns.set(project, prepareAppendRun(project, additions));
			try { for (const child of additions) dispatchChild(project, child); }
			finally { if (prior) ownedRuns.set(project, prior); else ownedRuns.delete(project); }
		} else if (index > first) {
			for (let child = first; child < index; child += 1) dispatchChild(project, commands[child]!);
		} else { dispatchChild(project, commands[index]!); index += 1; }
	}
}

export function applyPreparedTimelineAnnotationAppend(project: EditorCommandProject, command: AudioEditorCommand): boolean {
	const run = ownedRuns.get(project), row = run?.rows.get(command);
	if (!run || !row) return false;
	if (project.timelineAnnotations !== run.target) throw new Error('An owned annotation append run lost its draft collection.');
	run.target.push(row);
	return true;
}

function prepareAppendRun(project: EditorCommandProject, commands: readonly AddCommand[]): AppendRun {
	const owner = project as unknown as RuntimeTimelineAnnotationProject;
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(owner);
	const additions: TimelineAnnotationV11[] = commands.map((command) => {
		for (const key of Reflect.ownKeys(command)) {
			const field = Object.getOwnPropertyDescriptor(command, key);
			if ((key !== 'type' && key !== 'annotation') || !field?.enumerable || !Object.hasOwn(field, 'value')) {
				throw new TypeError('Timeline annotation add commands require closed data fields.');
			}
		}
		return command.annotation;
	});
	const canonical = createTimelineAnnotationsV11([...authoritative, ...additions], {
		sampleRate: owner.sampleRate, tempoMap: owner.tempoMap,
		sequenceIds: owner.sequences.map((sequence) => String(sequence.id)),
	});
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({ ...owner, timelineAnnotations: canonical });
	return { target: project.timelineAnnotations as RuntimeTimelineAnnotationProjection[],
		rows: new Map(commands.map((command, index) => [command, projected[authoritative.length + index]!])) };
}
