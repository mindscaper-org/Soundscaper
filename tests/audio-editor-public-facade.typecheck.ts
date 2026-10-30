/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudioEditorCommand, AudioEditorCommandPayloads, EditorController, EditorControllerOptions,
	EditorLabelTrack, EditorProject, SampleFrame, EditorSnapshot,
} from '../src/common/editor/index.js';

const options: EditorControllerOptions = { productId: 'soundscaper', locale: 'de' };
const version: EditorProject['schemaVersion'] = 17;
const readSnapshot = (controller: EditorController): EditorSnapshot => controller.getSnapshot();

const track = {
		type: 'label',
		id: 'label-track-1',
		name: 'Labels',
		height: 96,
		collapsed: false,
		locked: false,
		labels: [{
			id: 'label-1',
			title: 'Verse',
			startFrame: 24 as SampleFrame,
			endFrame: 48 as SampleFrame,
			color: 'auto',
		}],
	} satisfies EditorLabelTrack;

const rename = {
		type: 'project/rename',
		title: 'Typed facade',
	} satisfies AudioEditorCommand;
const payload: AudioEditorCommandPayloads['project/rename'] = { title: rename.title };
const annotationPayload: AudioEditorCommandPayloads['timeline-annotation/remove-many'] = {
		annotationIds: ['annotation'],
	};

void [options, version, readSnapshot, track, payload, annotationPayload];
