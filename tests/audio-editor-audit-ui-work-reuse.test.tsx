/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import AudioEditorButtonTooltips from '../src/common/editor/ui/AudioEditorButtonTooltips.jsx';
import EditorHelpTooltip from '../src/common/editor/ui/EditorHelpTooltip.tsx';
import { useProjectBinWaveformPath } from '../src/common/editor/ui/workspace/useProjectBinPresentation.ts';
import ProjectAttributionTab from '../src/common/editor/ui/workspace/ProjectAttributionTab.tsx';
import { listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
async function mounted(run: (root: Root, dom: ReturnType<typeof installReactTestDom>) => Promise<void>) {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try { await run(root, dom); } finally { await act(async () => root.unmount()); dom.restore(); }
}

test('explicit button labels bypass subtree cloning while preserving tooltip precedence', async () => mounted(async (root, dom) => {
	const events = new EventTarget();
	const editor = dom.container as unknown as HTMLElement;
	editor.addEventListener = events.addEventListener.bind(events);
	editor.removeEventListener = events.removeEventListener.bind(events);
	await act(async () => root.render(<><button aria-label="Play">Visible text</button><AudioEditorButtonTooltips rootRef={{ current: editor }} /></>));
	const button = dom.one('button');
	let clones = 0;
	Object.assign(button, { cloneNode: () => { clones++; return { querySelectorAll: () => [], textContent: 'Visible text' }; } });
	button.getBoundingClientRect = () => ({ left: 100, right: 124, top: 100, bottom: 124, width: 24, height: 24 });
	const event = Object.assign(new Event('pointerover'), { buttons: 0 });
	Object.defineProperty(event, 'target', { value: button });
	await act(async () => { events.dispatchEvent(event); });
	assert.equal(dom.one('[data-audio-editor-button-tooltip]').textContent, 'Play');
	assert.equal(clones, 0);
}));

test('an open help tooltip retains viewport listeners when scrolling does not move its anchor', async () => mounted(async (root, dom) => {
	const events = new EventTarget();
	let added = 0, removed = 0;
	window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => { if (type === 'resize' || type === 'scroll') added++; events.addEventListener(type, listener, options); }) as typeof window.addEventListener;
	window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => { if (type === 'resize' || type === 'scroll') removed++; events.removeEventListener(type, listener, options); }) as typeof window.removeEventListener;
	await act(async () => root.render(<EditorHelpTooltip subject="Example" description="Description" helpLabel="Help" />));
	await act(async () => reactProps(dom.one('button')).onFocus?.());
	const first = { added, removed };
	for (let index = 0; index < 5; index++) await act(async () => { events.dispatchEvent(new Event('scroll')); });
	assert.deepEqual({ added, removed }, first);
}));

test('unwarped bin waveforms retain their PCM reduction across unrelated project revisions', async () => mounted(async (root) => {
	let reads = 0;
	const samples = new Float32Array(48000).fill(0.5);
	const visual = { buffer: { length: samples.length, numberOfChannels: 1, getChannelData() { reads++; return samples; } } };
	const clip = { id: 'audio', sourceId: 'source', kind: 'audio', durationFrames: 48000 };
	function View({ project }: { project: unknown }) { return <span>{useProjectBinWaveformPath(visual, clip, project)}</span>; }
	const project = { title: 'Before', sampleRate: 48000 };
	await act(async () => root.render(<View project={project} />));
	const initial = reads;
	await act(async () => root.render(<View project={{ ...project, title: 'After' }} />));
	assert.equal(reads, initial);
}));

test('attribution presentation retains its prepared report across UI-only rerenders', async () => mounted(async (root) => {
	const sources = Array.from({ length: 50 }, (_, i) => createAudioSource({ id: `source-${i}`, sampleRate: 48000, frameCount: 48000, channelCount: 1 }));
	const clips = sources.map((source, i) => createAudioClip({ id: `clip-${i}`, sourceId: source.id, timelineStartFrame: i * 48000, durationFrames: 48000 }));
	const raw = createSoundscaperProject({ id: 'attribution-reuse', sources, clips, tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })] });
	let reads = 0;
	const project = { ...raw, sources: raw.sources.map(source => ({ ...source, get id() { reads++; return source.id; } })) };
	const view = () => <ProjectAttributionTab project={project} copy={ENGLISH_COPY} locale="en" />;
	await act(async () => root.render(view()));
	const initial = reads;
	for (let i = 0; i < 5; i++) await act(async () => root.render(view()));
	assert.equal(reads, initial);
}));

test('ADM channel labels resolve each strip in linear work', () => {
	const raw = createSoundscaperProject({ id: 'adm-reuse', tracks: Array.from({ length: 200 }, (_, i) => createAudioTrack({ id: `track-${i}`, name: `Voice ${i}` })) });
	let reads = 0;
	const project = { ...raw, tracks: raw.tracks.map(track => ({ ...track, get id() { reads++; return track.id; } })) };
	const channels = listAdmEditorSourceChannels(project);
	assert.equal(channels.length, 400);
	assert.ok(channels.some(channel => channel.label.includes('Voice 199')));
	assert.ok(reads < 200 * 12, `${reads} identity reads for 200 tracks`);
});

test('capture level updates reuse their locale formatter', async () => mounted(async root => {
	const { FramescaperCaptureSources } = await import('../src/common/editor/ui/workspace/FramescaperCaptureSources.tsx');
	type Props = React.ComponentProps<typeof FramescaperCaptureSources>;
	const capture: Props['capture'] = { destination: null, countdownMs: null, phase: 'previewing', availability: { status: 'available', sourceRoles: ['microphone'] }, requestedRoles: ['microphone'], sources: [{ sourceId: 'mic', role: 'microphone', level: 0.5 }] };
	const noop = () => undefined;
	const props: Props = { capture, selectedRoles: ['microphone'], sourceLocked: false, copy: ENGLISH_COPY, locale: 'en', canListDisplaySources: false, canSelectDevice: false, canConfigureSource: false, onToggleRole: noop, onListDisplaySources: noop, onSelectDisplaySource: noop, onSelectDevice: noop, onConfigureSource: noop };
	const original = Intl.NumberFormat;
	let calls = 0;
	Intl.NumberFormat = new Proxy(original, { construct(target, args, newTarget) { calls++; return Reflect.construct(target, args, newTarget) as Intl.NumberFormat; } });
	try {
		await act(async () => root.render(<FramescaperCaptureSources {...props} />));
		const initial = calls;
		for (let tick = 0; tick < 5; tick++) await act(async () => root.render(<FramescaperCaptureSources {...props} capture={{ ...capture, sources: [{ ...capture.sources[0]!, level: 0.6 + tick / 10 }] }} />));
		assert.equal(calls, initial);
	} finally { Intl.NumberFormat = original; }
}));

test('unrelated ID3 drafts retain decoded artwork while changed artwork is revalidated', async () => mounted(async (root, dom) => {
	const { default: Id3MetadataFields } = await import('../src/common/editor/ui/Id3MetadataFields.tsx');
	const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
	const metadata = { id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Cover', data: png }]) };
	const original = globalThis.atob;
	let calls = 0;
	globalThis.atob = value => { calls++; return original(value); };
	try {
		await act(async () => root.render(<Id3MetadataFields metadata={metadata} copy={ENGLISH_COPY} disabled={false} onUpdate={() => undefined} />));
		const initial = calls;
		const input = dom.container.querySelectorAll('input').find(node => node.parentNode?.textContent.includes('Field name'));
		assert.ok(input);
		for (const text of ['T', 'Ta', 'Tag']) await act(async () => reactProps(input).onChange?.({ currentTarget: { value: text } }));
		assert.equal(calls, initial);
		await act(async () => root.render(<Id3MetadataFields metadata={{ id3Artwork: 'not JSON' }} copy={ENGLISH_COPY} disabled={false} onUpdate={() => undefined} />));
		assert.ok(dom.one('[role="alert"]').textContent);
	} finally { globalThis.atob = original; }
}));

test('background job controls use prepared positions rather than searching the queue per row', async () => {
	const { renderToStaticMarkup } = await import('react-dom/server');
	const { default: Dialog } = await import('../src/common/editor/ui/dialogs/FramescaperNativeServicesDialog.tsx');
	const { framescaperNativeRendererSnapshot, framescaperNativeQueueRow, createFramescaperNativeServicesBridgeFixture } = await import('./helpers/framescaper-native-services-surface-fixture.ts');
	const base = framescaperNativeRendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true });
	const queue = Array.from({ length: 100 }, (_, position) => ({ ...framescaperNativeQueueRow(), position, jobId: String(position).padStart(40, '0') }));
	const original = Array.prototype.indexOf;
	let searches = 0;
	Array.prototype.indexOf = function (this: unknown[], value: unknown, start?: number) { if (value && typeof value === 'object' && 'jobId' in value) searches++; return Reflect.apply(original, this, [value, start]) as number; };
	try {
		const html = renderToStaticMarkup(<Dialog bridge={createFramescaperNativeServicesBridgeFixture().bridge} initialSurface="background-jobs" initialSnapshot={{ ...base, services: { ...base.services, queue } }} onClose={() => undefined} />);
		assert.ok(html.includes('Move earlier'));
		assert.equal(searches, 0);
	} finally { Array.prototype.indexOf = original; }
});
