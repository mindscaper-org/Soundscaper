/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { hasRealtimeContextBorrowers, retainRealtimeContext } from '../src/common/editor/engine/realtime-context-custody.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

const contextPort = (context: MockAudioContext): EngineAudioContext => context as unknown as EngineAudioContext;
const project = () => createAudioPreviewProject({ sampleRate: 16000, sources: [], clips: [], tracks: [] });

test('a native audition borrows its existing context without changing its clock or recording leases', async () => {
	const context = new MockAudioContext({ sampleRate: 48000 });
	context.currentTime = 37;
	const releaseInput = retainRealtimeContext(context);
	let allocations = 0;
	const preview = createAudioEditorEngine({ realtimeContextLease: { current: () => contextPort(context) },
		audioContextFactory: options => { allocations++; return contextPort(new MockAudioContext(options)); } });
	preview.loadProject(project());
	assert.equal(await preview.getAudioContext({ resume: false }), context);
	assert.equal(await preview.getAudioContext({ resume: false }), context, 'automatic project rate must not replace the native clock');
	assert.equal(context.sampleRate, 48000);
	assert.equal(context.currentTime, 37);
	assert.equal(allocations, 0);
	await preview.dispose();
	assert.notEqual(context.state, 'closed');
	assert.equal(hasRealtimeContextBorrowers(context), true, 'the independent input lease survives preview disposal');
	releaseInput();
	assert.equal(hasRealtimeContextBorrowers(context), false);
	await context.close();
});

test('native route replacement and browser fallback release each borrowed context without closing it', async () => {
	const first = new MockAudioContext({ sampleRate: 48000 }), second = new MockAudioContext({ sampleRate: 96000 });
	let current: EngineAudioContext | null = contextPort(first);
	const allocated: MockAudioContext[] = [];
	const preview = createAudioEditorEngine({ realtimeContextLease: { current: () => current },
		audioContextFactory: options => { const context = new MockAudioContext(options); allocated.push(context); return contextPort(context); } });
	preview.loadProject(project());
	assert.equal(await preview.getAudioContext({ resume: false }), first);
	current = contextPort(second);
	assert.equal(await preview.getAudioContext({ resume: false }), second);
	assert.equal(hasRealtimeContextBorrowers(first), false);
	assert.notEqual(first.state, 'closed');
	assert.equal(hasRealtimeContextBorrowers(second), true);
	current = null;
	assert.equal(await preview.getAudioContext({ resume: false }), allocated[0]);
	assert.equal(allocated[0]?.sampleRate, 16000);
	assert.equal(hasRealtimeContextBorrowers(second), false);
	await preview.dispose();
	assert.equal(allocated[0]?.state, 'closed');
	assert.notEqual(second.state, 'closed');
	await first.close(); await second.close();
});

test('disposing during context admission releases the late audition lease without closing its owner', async () => {
	const context = new MockAudioContext();
	const preview = createAudioEditorEngine({ realtimeContextLease: { current: () => contextPort(context) } });
	const pending = Promise.allSettled([preview.getAudioContext({ resume: false })]);
	await preview.dispose();
	assert.equal((await pending)[0]?.status, 'rejected');
	assert.equal(context.state, 'running');
	assert.equal(hasRealtimeContextBorrowers(context), false);
	await context.close();
});

test('an explicit preview rate cannot retime a borrowed native context', async () => {
	const context = new MockAudioContext();
	const preview = createAudioEditorEngine({ realtimeContextLease: { current: () => contextPort(context) } });
	await assert.rejects(preview.getAudioContext({ resume: false, sampleRate: 44100 }), /borrow/iu);
	assert.equal(context.state, 'running');
	assert.equal(context.sampleRate, 48000);
	await preview.dispose(); await context.close();
});
