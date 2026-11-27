/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';

import {
	TRACKTION_CLIP_PAGE_SIZE, type TracktionClipPage, type TracktionProjectBridge, type TracktionProjectCommand,
	type TracktionProjectPage, type TracktionProjectReply, type TracktionTransportView, type TracktionTransportObservation,
} from '../src/soundscaper/tracktion-project-contract.ts';
import {
	readTracktionWorkspaceAfterClipEdit, readTracktionWorkspaceAfterTrackInsertion, readTracktionWorkspaceWithCachedTracks, type TracktionWorkspace,
} from '../src/soundscaper/tracktion-workspace.ts';
import { TracktionEditor } from '../src/soundscaper/ui/TracktionEditor.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function mountEditor(context: TestContext, {
	stopOnUndo = false, undoChangesClips = false, clipsPerTrack = 1, recoveredBeforeDiscard = false,
	desktopAudioSetup = false, delayReadiness = false, trackCount = 33, openedTransport,
}: { stopOnUndo?: boolean; undoChangesClips?: boolean; clipsPerTrack?: number; recoveredBeforeDiscard?: boolean;
	desktopAudioSetup?: boolean; delayReadiness?: boolean; trackCount?: number; openedTransport?: TracktionTransportObservation } = {}) {
	const dom = installReactTestDom();
	let pollTransport: (() => void) | undefined;
	if (desktopAudioSetup) Object.assign(window, {
		setInterval(poll: () => void, milliseconds: number) {
			assert.equal(milliseconds, 250);
			pollTransport = poll;
			return 1;
		},
		clearInterval() { pollTransport = undefined; },
	});
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
	let trackTitleReads = 0;
	const tracks = Array.from({ length: trackCount }, (_, index) => ({
		id: String(index + 1), clipCount: index === 31 ? 0 : clipsPerTrack,
		get name() { trackTitleReads += 1; return `Track ${index + 1}`; },
	}));
	const firstPage: TracktionProjectPage = {
		revision: 7, sampleRate: 48_000, canUndo: true, canRedo: false, nextOffset: 32, tracks: tracks.slice(0, 32),
	};
	let transport: TracktionTransportView = { ready: false, playing: false, recording: false, frame: 0 };
	let projectLost: ((sessionId: string, message: string) => void) | undefined;
	let clipTitleReads = 0;
	let revision = firstPage.revision;
	let waitingForReady = false;
	let recordingTrackId: string | undefined;
	function addRecordedClip() {
		const index = tracks.findIndex(({ id }) => id === recordingTrackId);
		const track = tracks[index];
		assert.ok(track);
		tracks[index] = { id: track.id, clipCount: track.clipCount + 1, get name() { return track.name; } };
	}
	function reply(command: TracktionProjectCommand): unknown {
		switch (command.kind) {
			case 'render': return { revision: firstPage.revision, itemId: null };
			case 'create':
			case 'open': return { sessionId: 'session', name: 'Imported project', project: firstPage, transport: openedTransport };
			case 'project': return { ...firstPage, revision, tracks: tracks.slice(command.offset, command.offset + 32),
				nextOffset: command.offset + 32 < tracks.length ? command.offset + 32 : null };
			case 'clips': {
				const count = tracks.find(({ id }) => id === command.trackId)?.clipCount ?? 0;
				const next = Math.min(command.offset + TRACKTION_CLIP_PAGE_SIZE, count);
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
			case 'transportStatus': {
				if (waitingForReady) {
					waitingForReady = false;
					transport = { ...transport, ready: true };
				}
				return transport;
			}
			case 'transportObservation': {
				const { ready: _ready, ...observation } = transport;
				return observation;
			}
			case 'prepareOutput': {
				waitingForReady = delayReadiness;
				return transport = { ...transport, ready: !waitingForReady };
			}
			case 'play': return transport = { ...transport, playing: true };
			case 'stop': return transport = { ...transport, playing: false };
			case 'startRecording': {
				recordingTrackId = command.trackId;
				return transport = { ...transport, recording: true };
			}
			case 'finishRecording': {
				transport = { ...transport, recording: false };
				if (command.discard) {
					assert.ok(recoveredBeforeDiscard);
					revision += 2;
					return { revision, itemId: null };
				}
				addRecordedClip();
				return { revision: ++revision, itemId: 'take' };
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
	await act(async () => root.render(<TracktionEditor bridge={bridge} desktopAudioSetup={desktopAudioSetup} />));
	async function click(label: string): Promise<void> {
		const button = dom.container.querySelectorAll('button').find((element) => element.textContent === label);
		assert.ok(button, label);
		await act(async () => { reactProps(button).onClick(); });
	}
	async function loseProject(sessionId: string): Promise<void> {
		await act(async () => { projectLost?.(sessionId, 'The audio engine stopped responding'); });
	}
	async function observeTransport(next: TracktionTransportView): Promise<void> {
		transport = next;
		if (next.interruptedTake) {
			if (next.interruptedTake.itemId && next.interruptedTake.revision !== revision) addRecordedClip();
			revision = next.interruptedTake.revision;
		}
		const poll = pollTransport;
		assert.ok(poll, 'the active desktop transport is being observed');
		await act(async () => { poll(); });
	}
	return { dom, requests, click, loseProject, observeTransport,
		get clipTitleReads() { return clipTitleReads; }, get trackTitleReads() { return trackTitleReads; } };
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

void test('opening a project with its transport observation skips a separate engine request', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { openedTransport: { playing: false, recording: false, frame: 0 } });
	await click('Open projects');
	assert.equal(dom.one('h1').textContent, 'Imported project');
	assert.equal(dom.one('select').options.length, 33);
	assert.equal(dom.one('li').textContent, 'Clip 1 (0–512)');
	assert.deepEqual(requests.map(({ kind }) => kind), ['open', 'project', 'clips']);
});

void test('creating an empty project skips the selected track clip request', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { clipsPerTrack: 0 });
	await click('New project');
	assert.equal(dom.one('select').options.length, 33);
	assert.equal(dom.find('li'), null);
	assert.deepEqual(requests.map(({ kind }) => kind), ['create', 'project', 'transportStatus']);
});

void test('trimming applies the ordered clip returned by the edit across a clip page boundary', async () => {
	const clips = Array.from({ length: 65 }, (_, index) => ({
		id: String(index + 1), name: `Clip ${index + 1}`, start: index * 16, end: index * 16 + 64, sourceOffset: 5,
	}));
	const track = { id: '150', name: 'Audio track', clipCount: clips.length };
	const project: TracktionProjectPage = { revision: 7, sampleRate: 48_000, canUndo: true, canRedo: true, nextOffset: null, tracks: [track] };
	const workspace: TracktionWorkspace = { sessionId: 'session', name: 'Project', project, tracks: [track],
		selectedTrack: track, previousSelection: undefined, clips };
	const original = clips.at(63);
	assert.ok(original);
	const clip = { ...original, start: original.start + 24, end: original.end - 8, sourceOffset: 29 };
	const noRead: TracktionProjectBridge = { async request() { return assert.fail('An acknowledged trim requires no bridge requests'); } };
	const updated = await readTracktionWorkspaceAfterClipEdit(noRead, workspace, {
		revision: 8, itemId: null, history: { canUndo: true, canRedo: false }, trimmedClip: { clip, index: 64 },
	});
	assert.deepEqual(updated.clips, [...clips.slice(0, 63), clips[64], clip]);
	assert.equal(updated.clips[64], clip);
	assert.equal(updated.selectedTrack, track);
	assert.equal(updated.tracks, workspace.tracks);
	assert.deepEqual(updated.project, { ...project, revision: 8, canRedo: false });
});

void test('importing applies the ordered clip and track count without rereading a dense workspace', async () => {
	const tracks = Array.from({ length: 129 }, (_, index) => ({ id: String(index + 1), name: `Track ${index + 1}`, clipCount: 0 }));
	const clips = Array.from({ length: 1499 }, (_, index) => ({
		id: String(index + 200), name: `Clip ${index + 1}`, start: index * 32, end: index * 32 + 32, sourceOffset: 0,
	}));
	const selectedTrack = { id: '129', name: 'Track 129', clipCount: clips.length };
	tracks[128] = selectedTrack;
	const project: TracktionProjectPage = { revision: 7, sampleRate: 48_000, canUndo: false, canRedo: true, nextOffset: 64, tracks: tracks.slice(0, 64) };
	const previousSelection = { trackId: '1', clips: [] };
	const workspace: TracktionWorkspace = { sessionId: 'session', name: 'Project', project, tracks, selectedTrack, clips, previousSelection };
	const noRead: TracktionProjectBridge = { async request() { return assert.fail('An acknowledged import requires no bridge requests'); } };
	const clip = { id: '2000', name: 'Tracktion resolved name', start: 33, end: 62, sourceOffset: 0 };
	const history = { canUndo: true, canRedo: false };
	const updated = await readTracktionWorkspaceAfterClipEdit(noRead, workspace, {
		revision: 8, itemId: clip.id, history, importedClip: { clip, index: 2 },
	});
	assert.deepEqual(updated.clips, [...clips.slice(0, 2), clip, ...clips.slice(2)]);
	assert.deepEqual(updated.selectedTrack, { ...selectedTrack, clipCount: 1500 });
	assert.equal(updated.tracks.at(-1), updated.selectedTrack);
	assert.equal(updated.project.tracks, project.tracks);
	assert.deepEqual(updated.project, { ...project, ...history, revision: 8 });
	assert.equal(updated.previousSelection, previousSelection);
});

void test('a trim refresh reads all track metadata if the engine advances beyond its revision', async () => {
	const tracks = Array.from({ length: 33 }, (_, index) => ({ id: String(index + 1), name: `Track ${index + 1}`, clipCount: 1 }));
	const project = { revision: 7, sampleRate: 48_000, canUndo: true, canRedo: false, nextOffset: 32, tracks: tracks.slice(0, 32) };
	const clip = { id: '1/0', name: 'Original', start: 0, end: 512, sourceOffset: 0 };
	const workspace: TracktionWorkspace = {
		sessionId: 'session', name: 'Project', project, tracks, selectedTrack: tracks[0], clips: [clip],
		previousSelection: { trackId: '33', clips: [clip] },
	};
	const commands: TracktionProjectCommand[] = [];
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			commands.push(command);
			assert.ok(command.kind === 'project' || command.kind === 'clips');
			const reply: TracktionProjectPage | TracktionClipPage = command.kind === 'project'
				? command.offset === 0 ? { ...project, revision: 9 }
					: { ...project, revision: 9, nextOffset: null, tracks: [{ id: '33', name: 'Recovered on track 33', clipCount: 2 }] }
				: { revision: 9, nextOffset: null, clips: [{ ...clip, start: 16 }] };
			return reply as TracktionProjectReply<Command>;
		},
	};
	const refreshed = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, { revision: 8, itemId: null });
	assert.equal(refreshed.project.revision, 9);
	assert.equal(refreshed.tracks.at(-1)?.clipCount, 2);
	assert.equal(refreshed.clips[0]?.start, 16);
	assert.equal(refreshed.previousSelection, undefined);
	assert.deepEqual(commands, [
		{ kind: 'project', sessionId: 'session', offset: 0 },
		{ kind: 'project', sessionId: 'session', offset: 32 },
		{ kind: 'clips', sessionId: 'session', revision: 9, trackId: '1', offset: 0 },
	]);
});

void test('deleting a clip reuses the remaining clips outside the first track page', async () => {
	const tracks = Array.from({ length: 65 }, (_, index) => ({ id: String(index + 1), name: `Track ${index + 1}`, clipCount: 0 }));
	const selectedTrack = { id: '65', name: 'Track 65', clipCount: 2 };
	tracks[64] = selectedTrack;
	const project = { revision: 7, sampleRate: 48_000, canUndo: false, canRedo: true, nextOffset: 64, tracks: tracks.slice(0, 64) };
	const retained = { id: 'retained', name: 'Kept', start: 20, end: 40, sourceOffset: 8 };
	const workspace: TracktionWorkspace = {
		sessionId: 'session', name: 'Project', project, tracks, selectedTrack, previousSelection: undefined,
		clips: [{ ...retained, id: 'removed', name: 'Deleted', start: 0, end: 20 }, retained],
	};
	const refreshedPage: TracktionProjectPage = { ...project, revision: 8, canUndo: true, canRedo: false };
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			assert.deepEqual(command, { kind: 'project', sessionId: 'session', offset: 0 });
			return refreshedPage as TracktionProjectReply<Command>;
		},
	};
	const updated = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, { revision: 8, itemId: null }, { removedFromSource: 'removed' });
	assert.deepEqual(updated.clips, [retained]);
	assert.equal(updated.clips[0], retained);
	assert.equal(updated.selectedTrack?.clipCount, 1);
	assert.equal(updated.tracks.at(-1), updated.selectedTrack);
	assert.equal(updated.project, refreshedPage);

	const noRead: TracktionProjectBridge = { async request() { return assert.fail('The current edit reply is sufficient'); } };
	const acknowledgement = { revision: 8, itemId: null, history: { canUndo: true, canRedo: false } };
	const deleted = await readTracktionWorkspaceAfterClipEdit(noRead, workspace, acknowledgement, { removedFromSource: 'removed' });
	assert.deepEqual(deleted, updated);
	const mixed = await readTracktionWorkspaceWithCachedTracks(noRead, workspace, acknowledgement);
	assert.equal(mixed.clips, workspace.clips);
	assert.equal(mixed.tracks, workspace.tracks);
	assert.deepEqual(mixed.project, refreshedPage);
});

void test('track insertions preserve track and clip selection across the project page boundary', async () => {
	const tracks = Array.from({ length: 64 }, (_, index) => ({ id: String(index + 1), name: `Track ${index + 1}`, clipCount: 0 }));
	const source = { id: '63', name: 'Track 63', clipCount: 1 };
	tracks[62] = source;
	const originalClip = { id: 'a', name: 'Source', start: 0, end: 32, sourceOffset: 0 };
	const copiedClip = { ...originalClip, id: 'b' };
	const project: TracktionProjectPage = { revision: 7, sampleRate: 48_000, canUndo: false, canRedo: true, nextOffset: null, tracks };
	const workspace: TracktionWorkspace = {
		sessionId: 'session', name: 'Project', project, tracks, selectedTrack: source, clips: [originalClip], previousSelection: undefined,
	};
	const history = { canUndo: true, canRedo: false };
	const duplicate = { id: '65', name: 'Track 63 copy', clipCount: 1 };
	const commands: TracktionProjectCommand[] = [];
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			commands.push(command);
			assert.equal(command.kind, 'clips');
			const reply: TracktionClipPage = { revision: 8, nextOffset: null, clips: [copiedClip] };
			return reply as TracktionProjectReply<Command>;
		},
	};
	const copied = await readTracktionWorkspaceAfterTrackInsertion(bridge, workspace, {
		revision: 8, itemId: duplicate.id, history, insertion: { index: 63, track: duplicate },
	});
	assert.deepEqual(copied.tracks.slice(-3), [source, duplicate, tracks[63]]);
	assert.equal(copied.project.tracks.at(-1), duplicate);
	assert.equal(copied.project.nextOffset, 64);
	assert.equal(copied.selectedTrack, duplicate);
	assert.deepEqual(copied.clips, [copiedClip]);
	assert.deepEqual(copied.previousSelection, { trackId: source.id, clips: [originalClip] });
	const newTrack = { id: '66', name: 'New track', clipCount: 0 };
	const appended = await readTracktionWorkspaceAfterTrackInsertion(bridge, copied, {
		revision: 9, itemId: newTrack.id, history, insertion: { index: 65, track: newTrack },
	});
	assert.equal(appended.tracks.at(-1), newTrack);
	assert.equal(appended.project.tracks.at(-1), duplicate);
	assert.equal(appended.selectedTrack, newTrack);
	assert.deepEqual(appended.clips, []);
	assert.deepEqual(commands, [{ kind: 'clips', sessionId: 'session', revision: 8, trackId: duplicate.id, offset: 0 }]);
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
	assert.equal(requests.length, before, 'the cached track’s two pages need no bridge request');

	await selectTrack('33');
	await click('Undo');
	const afterUndo = requests.length;
	await selectTrack('1');
	assert.equal(dom.one('li').textContent, 'Clip 1 (16–528)');
	assert.deepEqual(requests.slice(afterUndo), [0, 64].map((offset) => ({
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

void test('desktop playback and recording timers observe transport without checking readiness', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const { dom, requests, click, observeTransport } = await mountEditor(context, { desktopAudioSetup: true, delayReadiness: true });
	await click('Open projects');
	const beforePlay = requests.length;
	await click('Play');
	await act(async () => { context.mock.timers.tick(25); });
	assert.deepEqual(requests.slice(beforePlay).map(({ kind }) => kind), ['prepareOutput', 'transportStatus', 'play']);
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
	await observeTransport({ ready: true, playing: true, recording: false, frame: 512 });
	assert.equal(requests.at(-1)?.kind, 'transportObservation');
	await observeTransport({ ready: false, playing: false, recording: false, frame: 768, outputInterrupted: true });
	assert.equal(requests.at(-1)?.kind, 'transportObservation');
	assert.equal(dom.one('[role="status"]').textContent, 'Stopped');
	assert.ok(dom.one('[role="alert"]').textContent);

	await click('Record onto the active track');
	await observeTransport({ ready: true, playing: true, recording: true, frame: 4096 });
	assert.equal(requests.at(-1)?.kind, 'transportObservation');
	const beforeRecovery = requests.length;
	await observeTransport({ ready: false, playing: false, recording: false, frame: 8192,
		interruptedTake: { revision: 8, itemId: '10' } });
	assert.deepEqual(requests.slice(beforeRecovery).map(({ kind }) => kind), ['transportObservation', 'project', 'clips']);
	assert.equal(dom.one('ul').querySelectorAll('li').length, 2);
	assert.equal(dom.one('[role="status"]').textContent, 'Recording added to the track');
});

void test('desktop project opening and playback edits observe transport without checking readiness', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { desktopAudioSetup: true });
	await click('Open projects');
	assert.equal(requests.at(-1)?.kind, 'transportObservation');
	assert.equal(dom.one('h1').textContent, 'Imported project');
	await click('Play');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
	await click('Undo');
	assert.equal(requests.at(-1)?.kind, 'transportObservation');
	assert.equal(dom.one('[role="status"]').textContent, 'Playing');
});

void test('playing and stopping a large project reuse its rendered tracks and clips', async (context) => {
	const editor = await mountEditor(context, { clipsPerTrack: 128, trackCount: 512 });
	await editor.click('Open projects');
	assert.equal(editor.dom.one('ul').querySelectorAll('li').length, 128);
	assert.equal(editor.dom.one('select').options.length, 512);
	const initialClipReads = editor.clipTitleReads;
	const initialTrackReads = editor.trackTitleReads;
	assert.ok(initialClipReads >= 128 && initialTrackReads >= 512);
	await editor.click('Play');
	assert.equal(editor.dom.one('[role="status"]').textContent, 'Playing');
	await editor.click('Stop');
	assert.equal(editor.dom.one('[role="status"]').textContent, 'Stopped');
	assert.equal(editor.clipTitleReads - initialClipReads, 0, 'transport changes do not rebuild clip rows');
	assert.equal(editor.trackTitleReads - initialTrackReads, 0, 'transport changes do not rebuild track options');
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

void test('finishing a take refreshes only the recording track in a paginated project', async (context) => {
	const { dom, requests, click } = await mountEditor(context, { trackCount: 129 });
	await click('Open projects');
	await act(async () => {
		reactProps(dom.one('select')).onChange({ currentTarget: { value: '129' } });
	});
	await click('Record onto the active track');
	const beforeStop = requests.length;
	await click('Stop');
	assert.deepEqual(requests.slice(beforeStop).map(({ kind }) => kind), ['finishRecording', 'transportStatus', 'project', 'clips']);
	assert.equal(dom.one('select').options.length, 129);
	assert.equal(dom.one('ul').querySelectorAll('li').length, 2);
	assert.equal(dom.one('[role="status"]').textContent, 'Recording added to the track');
	await click('Save project');
	assert.deepEqual(requests.at(-1), { kind: 'save', sessionId: 'session', revision: 8 });
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
