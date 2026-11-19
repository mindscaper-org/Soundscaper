/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';
import { DESKTOP_READ_PROFILE_MATERIALIZED } from '../src/common/editor/desktop-read-profile.ts';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { hindenburgSession } from './helpers/hindenburg-import-fixture.ts';
import { encodeWav } from '../src/common/editor/wav.js';

function ids() { let next = 0; return (prefix: string) => `${prefix}-${++next}`; }
function session() { return new File([hindenburgSession()], 'Podcast.NHSX', { type: 'application/xml' }); }
function audio() {
	return new File([encodeWav([new Float32Array(48000).fill(0.25)], { sampleRate: 48000, float: true }) as Uint8Array<ArrayBuffer>], 'voice.wav');
}

test('NHSX desktop Open and Import admit sessions without treating them as audio streams', () => {
	for (const purpose of ['project', 'media']) {
		assert.equal(acceptsFile(purpose, '/session/Podcast.NHSX'), true);
		assert.ok(validateFileChoice({ purpose }).extensions.includes('nhsx'));
	}
	assert.equal(acceptsFile('audio-video', '/session/Podcast.NHSX'), false);
	assert.equal(mimeTypeForPath('/session/Podcast.NHSX'), 'application/xml');
});

test('NHSX companion PCM is persisted before activation and failed activation rolls it back', async () => {
	let committed = false, frames = 0;
	const fixture = createFixture({ createStableId: ids() });
	fixture.runtime.store.beginSourceWrite = async () => ({
		write: async channels => { frames += channels[0]!.length; assert.equal(channels[0]![0], 0.25); },
		commit: async () => { committed = true; }, abort: async () => undefined,
	});
	const runtime: typeof fixture.runtime = { ...fixture.runtime, switchProject: async (project, options) => {
		assert.equal(committed, true); await fixture.runtime.switchProject(project, options);
	} };
	const result = await createNativeProjectService(runtime).openInterchange(session(), { mediaFiles: [audio()] });
	assert.ok(result);
	assert.equal(frames, 48000);
	const clip = result.project.clips[0]!;
	assert.ok('sourceStartFrame' in clip && 'durationFrames' in clip);
	assert.equal(clip.sourceStartFrame, 12000);
	assert.equal(clip.durationFrames, 24000);
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
	assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
	const failed = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
	await assert.rejects(createNativeProjectService(failed.runtime).openInterchange(session(), { mediaFiles: [audio()] }), /activation failed/u);
	assert.equal(failed.deletedSources.length, 1);
	assert.equal(failed.state.importing, false);
});

test('NHSX absent or ambiguous companions retain offline cuts for relinking', async () => {
	for (const mediaFiles of [[], [audio(), audio()]]) {
		const fixture = createFixture({ createStableId: ids() });
		const result = await createNativeProjectService(fixture.runtime).openInterchange(session(), { mediaFiles });
		assert.ok(result);
		const clip = result.project.clips[0]!;
		assert.ok('timelineStartFrame' in clip);
		assert.equal(clip.timelineStartFrame, 24000);
		assert.ok(result.report.items.some(item => item.code === 'hindenburg.media-missing'));
	}
});

test('NHSX desktop relative media lookup uses and retires the selected session capability', async () => {
	const file = session(), sessionReadId = 'a'.repeat(64), calls: string[] = [];
	registerDesktopReadCapability(file, sessionReadId);
	const fixture = createFixture({ createStableId: ids() });
	fixture.runtime.fileService.resolveSesxMedia = async request => {
		assert.equal(request.sessionReadId, sessionReadId);
		calls.push(request.relativePath);
		return { status: 'missing' };
	};
	fixture.runtime.fileService.withReadDescriptors = async () => { assert.fail('missing media must not be read'); };
	fixture.runtime.fileService.releaseSesxSession = async id => { calls.push(id); return true; };
	await createNativeProjectService(fixture.runtime).openInterchange(file);
	assert.deepEqual(calls, ['Podcast Files/voice.wav', sessionReadId]);
});

test('NHSX descriptor read failures retire session grants and oversized XML is rejected before reading', async () => {
	for (const oversized of [false, true]) {
		const released: string[] = [], id = 'a'.repeat(64);
		await assert.rejects(withDesktopProjectReadDescriptor({
			withScapeReadDescriptor: async () => { assert.fail('unexpected Scape read'); },
			withReadDescriptors: async () => { throw new Error('XML read failed'); },
			releaseRead: async value => { released.push(`read:${value}`); },
			releaseSesxSession: async value => { released.push(`session:${value}`); },
		}, { id, name: 'Podcast.nhsx', readProfile: DESKTOP_READ_PROFILE_MATERIALIZED, size: oversized ? 32 * 1024 * 1024 + 1 : 10 }, {
			openMaterialized: async () => { assert.fail('unexpected consumption'); },
			openScape: async () => { assert.fail('unexpected Scape consumption'); },
		}), oversized ? /32 MiB/u : /XML read failed/u);
		assert.deepEqual(released, [...(oversized ? [`read:${id}`] : []), `session:${id}`]);
	}
});
