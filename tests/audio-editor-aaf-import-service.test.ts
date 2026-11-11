/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { createReferenceAaf } from './helpers/aaf-reference.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function ids() { let n = 0; return (prefix: string) => `${prefix}-${++n}`; }
function aafFile(): File { return new File([new Uint8Array(createReferenceAaf())], 'Voice.aaf', { type: 'application/octet-stream' }); }

test('ordinary AAF import persists independent embedded PCM before activating the complete edit', async () => {
	let frames = 0, committed = false;
	const fixture = createFixture({ createStableId: ids() });
	fixture.runtime.store.beginSourceWrite = async () => ({
		write: async channels => { frames += channels[0]!.length; },
		commit: async () => { committed = true; }, abort: async () => undefined,
	});
	const result = await createNativeProjectService(fixture.runtime).openInterchange(aafFile());
	assert.ok(result); assert.equal(committed, true); assert.equal(frames, 44_100);
	assert.equal(result.project.clips.length, 1); assert.equal(result.project.sources.length, 1);
	const source = result.project.sources[0]!, clip = result.project.clips[0]!;
	assert.ok('sampleRate' in source); assert.equal(source.sampleRate, 44_100);
	assert.ok('sourceStartFrame' in clip); assert.equal(clip.sourceStartFrame, 11_025);
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
	assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
	assert.equal(fixture.state.importing, false);
});

test('AAF activation failure rolls back newly staged PCM', async () => {
	const deleted: string[] = [];
	const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
	fixture.runtime.store.deleteSource = async id => { deleted.push(id); };
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(aafFile()), /activation failed/u);
	assert.equal(deleted.length, 1); assert.equal(fixture.state.importing, false);
});
