/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeFramescaperImageSourceV1 } from '../common/editor/timeline-image-model.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandBatchTimelineImage, FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';

/** Image labels share their source name, as the existing Project Bin rename does. */
export function prepareTimelineImageRenameCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map([...project.clips, ...project.projectBin.clips]
		.filter(clip => clip.kind === 'image').map(clip => [clip.id, clip]));
	const sources = new Map(project.sources.filter(source => source.kind === 'image')
		.map(source => [source.id, normalizeFramescaperImageSourceV1(source)]));
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (isBatch(value)) {
			const commands = value.commands;
			return { ...value, commands: commands.map(visit) };
		}
		if (value.type !== 'clip/update') return value;
		const update = value as Extract<AudioEditorCommand, { type: 'clip/update' }>;
		const clip = clips.get(update.clipId);
		if (!clip || Object.keys(update.changes).length !== 1 || typeof update.changes.title !== 'string') return value;
		const expectedSource = sources.get(clip.sourceId);
		if (!expectedSource) throw new ReferenceError('Image rename requires its exact source.');
		const source = normalizeFramescaperImageSourceV1({ ...expectedSource, name: update.changes.title });
		sources.set(source.id, source);
		return { type: 'image-source/set', sourceId: source.id, expectedSource, source };
	}
}

function isBatch(value: FramescaperProjectCommandTimelineImage): value is FramescaperProjectCommandBatchTimelineImage {
	return value.type === 'batch' && Array.isArray(value.commands);
}
