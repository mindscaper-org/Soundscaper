/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';

import type {
	TracktionProjectBridge, TracktionProjectCommand, TracktionProjectPage, TracktionProjectReply, TracktionTransportView,
} from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionEditor } from '../src/soundscaper/ui/TracktionEditor.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function mountEditor(context: TestContext, {
	stopOnUndo = false, undoChangesClips = false, clipsPerTrack = 1, recoveredBeforeDiscard = false,
} = {}) {
	const dom = installReactTestDom();
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount());
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		dom.restore();
	});
	const requests: TracktionProjectCommand[] = [];
	const tracks = Array.from({ length: 33 }, (_, index) => ({
		id: String(index + 1), name: `Track ${index + 1}`, clipCount: index === 31 ? 0 : clipsPerTrack,
	}));
	const firstPage: TracktionProjectPage = {
		revision: 7, sampleRate: 48_000, canUndo: true, canRedo: false, nextOffset: 32, tracks: tracks.slice(0, 32),
	};
	let transport: TracktionTransportView = { ready: false, playing: false, recording: false, frame: 0 };
	let projectLost: ((sessionId: string, message: string) => void) | undefined;
	let clipTitleReads = 0;
	let revision = firstPage.revision;
	function reply(command: TracktionProjectCommand): unknown {
		switch (command.kind) {
			case 'render': return { revision: firstPage.revision, itemId: null };
			case 'create':
			case 'open': return { sessionId: 'session', name: 'Imported project', project: firstPage };
			case 'project': return command.offset === 0 ? { ...firstPage, revision } : { ...firstPage, revision, tracks: tracks.slice(32), nextOffset: null };
			case 'clips': {
				const count = tracks.find(({ id }) => id === command.trackId)?.clipCount ?? 0;
				const next = Math.min(command.offset + 32, count);
				const shift = undoChangesClips && revision !== firstPage.revision ? 16 : 0;
				const clips = Array.from({ length: next - command.offset }, (_, index) => ({
					id: `${command.trackId}/${command.offset + index}`,
					get name() { clipTitleReads += 1; return `Clip ${command.trackId}`; },
					start: shift + (command.offset + index) * 512,
					end: shift + (command.offset + index + 1) * 512,
					sourceOffset: 0,
				}));
				return { revision, nextOffset: next < count ? next : null, clips };
			}
			case 'transportStatus': return transport;
			case 'prepareOutput': return transport = { ...transport, ready: true };
			case 'play': return transport = { ...transport, playing: true };
			case 'stop': return transport = { ...transport, playing: false };
			case 'startRecording': return transport = { ...transport, recording: true };
			case 'finishRecording': {
				assert.ok(command.discard && recoveredBeforeDiscard);
				revision += 2;
				transport = { ...transport, recording: false };
				return { revision, itemId: null };
			}
			case 'save': return { revision, itemId: null };
			case 'undo': {
				if (stopOnUndo) transport = { ...transport, playing: false };
				if (undoChangesClips) revision += 1;
				return { revision, itemId: null };
			}
			default: throw new Error(`Unexpected Tracktion request ${command.kind}`);
		}
	}
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command);
			return reply(command) as TracktionProjectReply<Command>;
		},
		onProjectLost(listener) {
			projectLost = listener;
			return () => { projectLost = undefined; };
		},
	};
	await act(async () => root.render(<TracktionEditor bridge={bridge} />));
	async function click(label: string): Promise<void> {
		const button = dom.container.querySelectorAll('button').find((element) => element.textContent === label);
		assert.ok(button, label);
		await act(async () => { reactProps(button).onClick(); });
	}
	async function loseProject(sessionId: string): Promise<void> {
		await act(async () => { projectLost?.(sessionId, 'The audio engine stopped responding'); });
	}
	return { dom, requests, click, loseProject, get clipTitleReads() { return clipTitleReads; } };
}

void test('opening a paginated project reuses its first track page', async (context) => {
	const { dom, requests, click } = await mountEditor(context);
	await click('Open projects');
	assert.equal(dom.one('h1').textContent, 'Imported project');
	assert.equal(dom.one('select').options.length, 33);
	assert.equal(dom.one('li').textContent, 'Clip 1 (0–512)');
	assert.deepEqual(requests, [
		{ kind: 'open' },
		{ kind: 'project', sessionId: 'session', offset: 32 },
		{ kind: 'clips', sessionId: 'session', revision: 7, trackId: '1', offset: 0 },
		{ kind: 'transportStatus', sessionId: 'session' },
	]);
});

void test('creating an empty project skips the selected track clip request', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { clipsPerTrack: 0 });
	await click('New project');
	assert.equal(dom.one('select').options.length, 33);
	assert.equal(dom.find('li'), null);
	assert.deepEqual(requests.map(({ kind }) => kind), ['create', 'project', 'transportStatus']);
});

void test('changing tracks keeps the loaded track inventory and reads the selected clips', async (context) => {
	const { dom, requests, click } = await mountEditor(context);
	await click('Open projects');
	const before = requests.length;
	await act(async () => {
		reactProps(dom.one('select')).onChange({ currentTarget: { value: '33' } });
	});
	assert.equal(dom.one('select').options.length, 33);
	assert.equal(dom.one('li').textContent, 'Clip 33 (0–512)');
	assert.deepEqual(requests.slice(before), [
		{ kind: 'clips', sessionId: 'session', revision: 7, trackId: '33', offset: 0 },
	]);
	await act(async () => {
		reactProps(dom.one('select')).onChange({ currentTarget: { value: '32' } });
	});
	assert.equal(dom.find('li'), null);
	assert.equal(requests.length, before + 1);
});

void test('returning to the previous track reuses its clip pages until an edit changes them', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { clipsPerTrack: 65, undoChangesClips: true });
	const selectTrack = (value: string) => act(async () => {
		reactProps(dom.one('select')).onChange({ currentTarget: { value } });
	});
	await click('Open projects');
	await selectTrack('33');
	const before = requests.length;
	await selectTrack('1');
	assert.equal(dom.one('li').textContent, 'Clip 1 (0–512)');
	assert.equal(requests.length, before, 'the cached track’s three pages need no bridge request');

	await selectTrack('33');
	await click('Undo');
	const afterUndo = requests.length;
	await selectTrack('1');
	assert.equal(dom.one('li').textContent, 'Clip 1 (16–528)');
	assert.deepEqual(requests.slice(afterUndo), [0, 32, 64].map((offset) => ({
		kind: 'clips', sessionId: 'session', revision: 8, trackId: '1', offset,
	})));
});

void test('whole mix export sends one request even when other tracks have more clip pages', async (context) => {
	const { requests, click } = await mountEditor(context, { clipsPerTrack: 65 });
	await click('Open projects');
	const before = requests.length;
	await click('Export mix (WAV)');
	assert.deepEqual(requests.slice(before), [{ kind: 'render', sessionId: 'session', revision: 7 }]);
});

void test('Undo that stops the native graph also stops browser output and updates the controls', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { stopOnUndo: true });
	await click('Open projects');
	await click('Play');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
	await click('Undo');
	assert.equal(requests.at(-1)?.kind, 'stop');
	assert.equal(dom.one('[role="status"]').textContent, 'Stopped');
	const playback = dom.container.querySelectorAll('button').find((element) => element.textContent === 'Play');
	assert.equal(playback?.disabled, false);
});

void test('switching tracks during playback keeps the playing indicator', async (context) => {
	const { dom, click } = await mountEditor(context);
	await click('Open projects');
	await click('Play');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
	await act(async () => {
		reactProps(dom.one('select')).onChange({ currentTarget: { value: '33' } });
	});
	assert.equal(dom.one('li').textContent, 'Clip 33 (0–512)');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
});

void test('playing and stopping a 128-clip track keep its rendered clip rows', async (context) => {
	const editor = await mountEditor(context, { clipsPerTrack: 128 });
	await editor.click('Open projects');
	assert.equal(editor.dom.one('ul').querySelectorAll('li').length, 128);
	const initialReads = editor.clipTitleReads;
	assert.ok(initialReads >= 128);
	await editor.click('Play');
	assert.equal(editor.dom.one('[role="status"]').textContent, 'Playing');
	await editor.click('Stop');
	assert.equal(editor.dom.one('[role="status"]').textContent, 'Stopped');
	assert.equal(editor.clipTitleReads - initialReads, 0, 'transport changes do not rebuild clip rows');
});

void test('a worker loss during recording lets the user reopen the saved project', async (context) => {
	const { dom, click, loseProject } = await mountEditor(context);
	await click('Open projects');
	await click('Record onto the active track');
	assert.equal(dom.one('[role="status"]').textContent, 'Recording');
	await loseProject('old-session');
	assert.equal(dom.one('[role="status"]').textContent, 'Recording');
	await loseProject('session');
	assert.equal(dom.find('[role="status"]'), null);
	assert.equal(dom.one('h1').textContent, 'Soundscaper Tracktion');
	assert.match(dom.one('[role="alert"]').textContent, /audio engine stopped/u);
	await click('Open projects');
	assert.equal(dom.one('h1').textContent, 'Imported project');
});

void test('discarding an automatically recovered recording updates the editor revision', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { recoveredBeforeDiscard: true });
	await click('Open projects');
	await click('Record onto the active track');
	await click('Discard recording');
	assert.equal(dom.one('[role="status"]').textContent, 'Recording discarded');
	await click('Save project');
	assert.deepEqual(requests.at(-1), { kind: 'save', sessionId: 'session', revision: 9 });
});
