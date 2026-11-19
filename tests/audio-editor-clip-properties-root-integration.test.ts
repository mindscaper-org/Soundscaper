/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createEditorRootSession } from './helpers/editor-root-session.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Session = Awaited<ReturnType<typeof createEditorRootSession>>;

function currentClip(session: Session) {
	const clip = clipboardProject(session.controller.project).clips[0];
	assert.ok(clip?.kind === 'audio'); return clip;
}

async function storedPcm(session: Session, source: Parameters<typeof readCustodyPcm>[1]) {
	let result: Awaited<ReturnType<typeof readCustodyPcm>> | undefined;
	await session.dom.react.act(async () => { result = await readCustodyPcm(session.environment.store, source); });
	assert.ok(result); return result;
}

function originalRecording() {
	const frames = 384_000, bytes = Buffer.alloc(44 + frames * 2), pcm = new Float32Array(frames);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(96_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
	for (let frame = 0; frame < frames; frame++) {
		const sample = Math.round(Math.sin(2 * Math.PI * 220 * frame / 48_000) * .35 * 32_767);
		bytes.writeInt16LE(sample, 44 + frame * 2); pcm[frame] = (sample || 0) / 32_768;
	}
	return { file: new File([bytes], 'browser-long-tone.wav', { type: 'audio/wav' }), pcm: [pcm] };
}

function text(node: Element): string {
	const clone = node.cloneNode(true); assert.ok(clone instanceof Element);
	for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
	return clone.textContent?.trim() ?? '';
}

function item(session: Session, label: string, root: ParentNode = session.dom.document): HTMLElement {
	const result = [...root.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')]
		.find(node => text(node).startsWith(label));
	assert.ok(result instanceof session.dom.window.HTMLElement, `actual menu item ${label}`);
	return result;
}

async function openProperties(session: Session): Promise<HTMLElement> {
	const { dom } = session;
	const clip = dom.element('[role="group"][aria-label^="browser-long-tone.wav clip"]', session.container);
	await dom.react.act(async () => { clip.focus(); });
	await dom.key(clip, 'Enter');
	await dom.click(item(session, 'Edit', session.container.querySelector('[data-application-menubar]')!));
	const audio = item(session, 'Audio clips');
	await dom.click(audio);
	await dom.wait(() => [...dom.document.querySelectorAll('[role="menuitem"]')].some(node => text(node).startsWith('Clip properties')),
		'the actual Audio clips submenu opens');
	await dom.click(item(session, 'Clip properties'));
	await dom.wait(() => !!session.container.querySelector('[data-workspace-panel="clip-properties"] [data-upstream-clip-properties]'),
		'the actual product properties panel opens');
	return dom.element('[data-workspace-panel="clip-properties"]', session.container);
}

function input(session: Session, panel: HTMLElement, field: string): HTMLInputElement {
	const result = panel.querySelector(`[data-clip-properties-field="${field}"] input`);
	assert.ok(result instanceof session.dom.window.HTMLInputElement); return result;
}

async function fixture(context: TestContext) {
	const session = await createEditorRootSession(context), recording = originalRecording();
	await session.dom.react.act(async () => { await session.controller.actions.project.importFiles([recording.file]); });
	const panel = await openProperties(session);
	const project = clipboardProject(session.controller.project);
	assert.equal(project.clips.length, 1); assert.equal(project.sources.length, 1);
	const source = project.sources[0]!; assert.ok(source.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [48_000, 1, 384_000]);
	assertPcmChannelsEqual(await storedPcm(session, source), recording.pcm, 'actual unchanged original RIFF16 source');
	return { session, recording, panel, source };
}

test('actual root neutral percent pitch and speed leave the authored clip and full input PCM unchanged', async context => {
	const { session, recording, panel, source } = await fixture(context), { dom } = session;
	const before = clipboardProject(session.controller.project);
	const toggle = dom.element('[data-clip-pitch-unit]', panel);
	assert.equal(toggle.getAttribute('aria-pressed'), 'false');
	await dom.click(toggle);
	assert.equal(toggle.getAttribute('aria-pressed'), 'true');
	assert.equal(input(session, panel, 'pitch').value, '0');
	assert.equal(input(session, panel, 'speed').value, '100');
	assert.equal(session.container.querySelector('[aria-label="Clip speed"]') === null, true);
	assert.deepEqual(clipboardDocument(clipboardProject(session.controller.project)), clipboardDocument(before));
	await dom.react.act(async () => { await session.controller.actions.project.flush(); });
	assertPcmChannelsEqual(await storedPcm(session, source), recording.pcm);
	dom.assertHealthy();
});

test('actual linked neutral controls disable rendering and preserve independent pitch in durable project state', async context => {
	const { session, recording, panel, source } = await fixture(context), { dom } = session;
	const pitch = input(session, panel, 'pitch');
	await dom.setValue(pitch, '3');
	await dom.key(pitch, 'Enter');
	await dom.react.act(async () => { pitch.blur(); });
	await dom.wait(() => currentClip(session).pitchCents === 300, 'the actual input commits three semitones');
	const chooseLink = async () => {
		await dom.click(dom.element('[data-clip-audio-settings]', panel));
		await dom.click(item(session, 'Link pitch and tempo'));
	};
	await chooseLink();
	await dom.wait(() => input(session, panel, 'pitch').value === '0', 'neutral linked rate displays zero pitch');
	assert.equal(input(session, panel, 'speed').value, '100');
	const render = dom.element('[data-clip-properties-action="render-pitch-speed"]', panel);
	assert.equal(render.hasAttribute('disabled'), true);
	await dom.react.act(async () => { await session.controller.actions.project.flush(); });
	let storedValue: unknown;
	await dom.react.act(async () => { storedValue = await session.environment.store.loadProject(clipboardProject(session.controller.project).id); });
	const stored = clipboardProject(storedValue);
	const storedClip = stored.clips[0]; assert.ok(storedClip?.kind === 'audio');
	assert.equal(storedClip.pitchCents, 300); assert.equal(storedClip.linkPitchAndTempo, true);
	await chooseLink();
	await dom.wait(() => input(session, panel, 'pitch').value === '3', 'unlinking restores authored independent semitones');
	assert.equal(currentClip(session).pitchCents, 300);
	assert.equal(currentClip(session).linkPitchAndTempo, false);
	assertPcmChannelsEqual(await storedPcm(session, source), recording.pcm);
	dom.assertHealthy();
});
