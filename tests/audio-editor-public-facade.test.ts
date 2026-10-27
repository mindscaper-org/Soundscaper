/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as editor from '../src/common/editor/index.js';
import type { CreateEditorController } from '../src/common/editor/index.js';

test('public editor facade exposes intentional controller, model, protocol, and adapter APIs', () => {
	const createController: CreateEditorController = editor.createEditorController;
	assert.equal(createController, editor.createAudioEditorController);
	for (const name of [
		'createEditorController',
		'createEditorProjectStore',
		'createAudioSource',
		'createMediaSource',
		'createVideoSource',
		'createMediaClip',
		'createCurrentAudioEditorProject',
		'createAudioEditorProjectV17',
		'applyEditorCommand',
		'createAddTimelineAnnotationCommand',
		'createBatchSetTimelineAnnotationsCommand',
		'createConvertTimelineAnnotationCommand',
		'createMoveTimelineAnnotationsCommand',
		'createRemoveTimelineAnnotationsCommand',
		'createResizeTimelineAnnotationCommand',
		'createUpdateTimelineAnnotationsCommand',
		'createAudioEditorEngine',
		'WorkerRequestBroker',
		'EDITOR_WORKER_PROTOCOL_VERSION',
		'EditorDisposedError',
		'EditorStoreClosedError',
		'FfmpegDisposedError',
	]) {
		assert.equal(typeof editor[name as keyof typeof editor] !== 'undefined', true, name);
	}
	assert.equal('createAiffStreamEncoder' in editor, false);
	assert.equal('applyAudacityEffectAsync' in editor, false);
	assert.equal('createAudioEditorProjectV5' in editor, false);
	assert.equal('createAudioEditorProjectV12' in editor, false);
});

test('public project validation accepts only the exact current shared schema', () => {
	const current = editor.createCurrentAudioEditorProject({
		id: 'public-current-project',
		now: '2026-08-20T10:00:00.000Z',
	});
	assert.equal(editor.validateAudioEditorProject(current), true);
	for (let retired = 2; retired <= 16; retired += 1) {
		assert.throws(
			() => editor.validateAudioEditorProject({ ...current, schemaVersion: retired }),
			/Unsupported audio editor schema version/u,
		);
	}
	assert.throws(
		() => editor.validateAudioEditorProject({ ...current, schemaVersion: 18 }),
		/Unsupported audio editor schema version/u,
	);
});
