/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createProjectBinPreviewService } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import type { ProjectBinPreview } from '../src/common/editor/controller/import/project-bin-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

interface SourceNode { readonly started?: readonly number[]; readonly stopped?: boolean }

function fixture(context: MockAudioContext) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
	const project = createCurrentAudioEditorProject({ id: 'bin-preview-failure', sampleRate: 48_000,
		sources: [source], clips: [], projectBin: { clips: ['first', 'second'].map(id => createAudioClip({
			id, binItemId: `${id}-item`, sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800,
		})) } });
	const buffer = new MockAudioBuffer(1, 4800, 48_000); buffer.getChannelData(0).fill(.2);
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	let active: ProjectBinPreview | null = null;
	let engine: ReturnType<typeof createAudioEditorEngine> | undefined;
	const preview = createProjectBinPreviewService({ lifetime, copy: { audioClipNotFound: 'Not found', localSourcesMissing: 'Missing PCM' },
		retireTimelinePlayback() {}, sourceBuffers: new Map([[source.id, buffer as unknown as AudioBuffer]]),
		sourceChunkProviders: new Map(), createId: prefix => `${prefix}-id`,
		createPreviewEngine: options => engine = createAudioEditorEngine({ ...options,
			audioContextFactory: () => context as unknown as AudioContext, offlineAudioContextFactory: null }),
		captureProject: () => generation.capture(project.id), assertProject: token => generation.assertCurrent(token),
		getProject: () => project, getPreview: () => active, setPreview(value) { active = value; },
		isSourceMissing: () => false, getVisualData: () => null, publish() {},
	});
	return { preview, readPreview: () => active, get active() { return active; }, async dispose() {
		await preview.stopProjectBinPreview({ dispose: true }); lifetime.beginDisposal(); await engine?.dispose();
	} };
}

test('a failed real engine start restores Project Bin Play and permits an audible retry', async () => {
	class DeviceContext extends MockAudioContext {
		fail = true;
		override async resume() {
			if (this.fail) { this.fail = false; throw new DOMException('Audio output device is unavailable.', 'NotReadableError'); }
			await super.resume();
		}
	}
	const context = new DeviceContext(); const owner = fixture(context);
	try {
		await assert.rejects(owner.preview.playPauseProjectBinClip('first'), /output device is unavailable/u);
		assert.equal(owner.active, null, 'failed preparation must not leave an optimistic playing card');
		assert.equal(context.bufferSources.length, 0);
		await owner.preview.playPauseProjectBinClip('first');
		assert.equal(owner.readPreview()?.state, 'playing');
		assert.ok((context.bufferSources as unknown as readonly SourceNode[]).some(node => node.started && !node.stopped));
	} finally { await owner.dispose(); }
});

test('a superseded failed engine start cannot clear another bin audition', async () => {
	let release: () => void = () => {};
	let entered: () => void = () => {};
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	class PendingContext extends MockAudioContext {
		first = true;
		override async resume() {
			if (this.first) { this.first = false; entered(); await gate; throw new DOMException('Old output failed.', 'NotReadableError'); }
			await super.resume();
		}
	}
	const context = new PendingContext(); const owner = fixture(context);
	try {
		const first = owner.preview.playPauseProjectBinClip('first');
		await started;
		await owner.preview.playPauseProjectBinClip('second');
		release();
		await assert.rejects(first, /Old output failed/u);
		assert.equal(owner.active?.clipId, 'second');
		assert.equal(owner.active?.state, 'playing');
		assert.ok((context.bufferSources as unknown as readonly SourceNode[]).some(node => node.started && !node.stopped));
	} finally { release(); await owner.dispose(); }
});
