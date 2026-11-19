/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

function timeline(storageKey = 'voice.wav'): File {
	const { text } = createOtioExport({ sequenceRate: { num: 25, den: 1 }, project: {
		id: 'fixture', title: 'Imported edit', sampleRate: 48_000,
		sources: [{ id: 'src', kind: 'audio', name: 'voice.wav', storageKey, frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'src', title: 'Phrase', timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 12_000 }],
	} });
	return new File([text], 'edit.otio');
}
function companion(): File {
	return new File([encodeWav([new Float32Array(48_000).fill(0.25)], { sampleRate: 48_000, float: true }) as Uint8Array<ArrayBuffer>], 'voice.wav');
}
function uniqueIds() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }

test('timeline open keeps an offline edit with its source offsets and an import report', async () => {
	const fixture = createFixture({ createStableId: uniqueIds() });
	const result = await createNativeProjectService(fixture.runtime).openInterchange(timeline());
	assert.ok(result);
	assert.equal(result.project.title, 'Imported edit');
	assert.equal(result.project.clips.length, 1);
	assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
	assert.ok(result.report.items.some(item => item.disposition === 'missing'));
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.runtime.state.deliveryReport, result.report);
});

test('selected companion audio is committed before project activation', async () => {
	const writes: number[] = [];
	const fixture = createFixture({ createStableId: uniqueIds() });
	fixture.runtime.store.beginSourceWrite = async () => ({
		write: async channels => { writes.push(channels[0]!.length); },
		commit: async () => { writes.push(-1); }, abort: async () => undefined,
	});
	const result = await createNativeProjectService(fixture.runtime).openInterchange(timeline(), { mediaFiles: [companion()] });
	assert.ok(result); assert.equal(writes.at(-1), -1);
	assert.equal(writes.filter(frames => frames > 0).reduce((sum, frames) => sum + frames, 0), 48_000);
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
	assert.equal(result.project.sources[0]!.name, 'voice.wav');
	assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
});

test('failed activation rolls back staged media and retains the active project', async () => {
	const deleted: string[] = [];
	const fixture = createFixture({ createStableId: uniqueIds(), switchProject: async () => { throw new Error('activation failed'); } });
	fixture.runtime.store.deleteSource = async id => { deleted.push(id); };
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(timeline(), { mediaFiles: [companion()] }), /activation failed/u);
	assert.equal(deleted.length, 1);
	assert.equal(fixture.state.importing, false);
});

test('managed-key OTIO exports rebind selected original filenames without duplicate source media', async () => {
	const fixture = createFixture({ createStableId: uniqueIds() });
	const result = await createNativeProjectService(fixture.runtime).openInterchange(timeline('private-storage-source-id'), { mediaFiles: [companion()] });
	assert.ok(result); assert.equal(result.project.sources.length, 1);
	assert.equal(result.project.sources[0]!.name, 'voice.wav');
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
});

test('duplicate companion filenames retain an offline reference instead of choosing arbitrary audio', async () => {
	const fixture = createFixture({ createStableId: uniqueIds() });
	const result = await createNativeProjectService(fixture.runtime).openInterchange(timeline(), { mediaFiles: [companion(), companion()] });
	assert.ok(result); assert.ok(result.report.items.some(item => item.disposition === 'missing'));
});

test('the active product constructs imported options in its own project family', async () => {
	const fixture = createFixture({ createStableId: uniqueIds(),
		createImportedProject: options => createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options as never),
		loadProject: () => assert.fail('source-derived import must not reinterpret a legacy persisted project'),
	});
	const result = await createNativeProjectService(fixture.runtime).openInterchange(timeline());
	assert.ok(result); assert.equal(result.project.schemaFamily, 'framescaper');
	assert.equal(result.project.schemaVersion, 1); assert.equal(result.project.clips.length, 1);
});
