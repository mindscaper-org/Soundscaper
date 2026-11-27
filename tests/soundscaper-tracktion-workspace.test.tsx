/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';

import type {
	TracktionProjectBridge, TracktionProjectCommand, TracktionProjectPage, TracktionProjectReply, TracktionTransportView,
} from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionEditor } from '../src/soundscaper/ui/TracktionEditor.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function mountEditor(context: TestContext, stopOnUndo = false) {
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
		id: String(index + 1), name: `Track ${index + 1}`, clipCount: index === 31 ? 0 : 1,
	}));
	const firstPage: TracktionProjectPage = {
		revision: 7, sampleRate: 48_000, canUndo: true, canRedo: false, nextOffset: 32, tracks: tracks.slice(0, 32),
	};
	let transport: TracktionTransportView = { ready: false, playing: false, recording: false, frame: 0 };
	let projectLost: ((sessionId: string, message: string) => void) | undefined;
	function reply(command: TracktionProjectCommand): unknown {
		switch (command.kind) {
			case 'open': return { sessionId: 'session', name: 'Imported project', project: firstPage };
			case 'project': return command.offset === 0 ? firstPage : { ...firstPage, tracks: tracks.slice(32), nextOffset: null };
			case 'clips': return { revision: 7, nextOffset: null,
				clips: [{ id: command.trackId, name: `Clip ${command.trackId}`, start: 0, end: 512, sourceOffset: 0 }] };
			case 'transportStatus': return transport;
			case 'prepareOutput': return transport = { ...transport, ready: true };
			case 'play': return transport = { ...transport, playing: true };
			case 'stop': return transport = { ...transport, playing: false };
			case 'startRecording': return transport = { ...transport, recording: true };
			case 'undo': {
				if (stopOnUndo) transport = { ...transport, playing: false };
				return { revision: firstPage.revision, itemId: null };
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
	return { dom, requests, click, loseProject };
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

void test('Undo that stops the native graph also stops browser output and updates the controls', async (context) => {
	const { dom, requests, click } = await mountEditor(context, true);
	await click('Open projects');
	await click('Play');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
	await click('Undo');
	assert.equal(requests.at(-1)?.kind, 'stop');
	assert.equal(dom.one('[role="status"]').textContent, 'Stopped');
	const playback = dom.container.querySelectorAll('button').find((element) => element.textContent === 'Play');
	assert.equal(playback?.disabled, false);
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
