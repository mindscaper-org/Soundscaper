/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperProjectForRuntimeConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-project-runtime-profile.ts';
import { VideoClipFadeHandles } from '../src/common/editor/ui/timeline/VideoClipFadeHandles.tsx';
import { useTimelineClipUploadDrag } from '../src/common/editor/ui/timeline/useTimelineClipUploadDrag.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
test('nonvideo filmstrips do not look up video opacity owners', async () => {
	const count = 100;
	const project = createFramescaperProject(profile, { id: 'fade-lookup', visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid', name: 'Solid', width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 10, generator: { kind: 'solid', color: '#ffffffff' } }] }, clips: Array.from({ length: count }, (_, i) => ({ schemaVersion: 1, kind: 'generator', id: `c${i}`, sourceId: 'solid', sequenceId: 'main', sequenceStartFrame: i * 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 })), tracks: [{ id: 'pictures', type: 'video', clipIds: Array.from({ length: count }, (_, i) => `c${i}`) }], sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const runtime = framescaperProjectForRuntimeConsumers(profile, project);
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const original = Array.prototype.find;
	let finds = 0;
	Array.prototype.find = function <T>(this: T[], predicate: (value: T, index: number, values: T[]) => unknown, thisArg?: unknown): T | undefined { if (this === project.clips as unknown) finds++; return original.call(this, predicate, thisArg) as T | undefined; };
	try {
		await act(async () => root.render(<>{runtime.clips.map(clip => <VideoClipFadeHandles key={clip.id} controller={{ actions: { edit: { commit: noop } } }} project={project as unknown as React.ComponentProps<typeof VideoClipFadeHandles>['project']} clip={clip} selected={false} visibleStartFrame={clip.timelineStartFrame} visibleEndFrame={clip.timelineStartFrame + clip.durationFrames} pixelsPerSecond={2} sampleRate={48000} blocked={false} copy={{}} run={operation => operation()} />)}</>));
		assert.equal(finds, 0);
		assert.equal(dom.container.childNodes.length, 0);
	} finally { Array.prototype.find = original; await act(async () => root.unmount()); dom.restore(); }
});

test('viewport upload handles reuse the canonical clip index and retire native drag decoration', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const ids = Array.from({ length: 100 }, (_, i) => `clip-${i}`);
	let reads = 0;
	const project = { id: 'upload-project', clips: ids.map(id => ({ get id() { reads++; return id; }, kind: 'audio' })) };
	function View({ revision }: { revision: string }) { const rootRef = useRef<HTMLDivElement>(null); useTimelineClipUploadDrag({ project, rootRef, viewportRevision: revision }); return <div ref={rootRef}>{ids.map(id => <div key={id} data-clip-id={id}><button className="clip-header__menu-button" /></div>)}</div>; }
	let unmounted = false;
	try {
		await act(async () => root.render(<View revision="first" />));
		const initial = reads;
		const handle = dom.one('button');
		assert.equal(Reflect.get(handle, 'draggable'), true);
		for (let i = 0; i < 5; i++) await act(async () => root.render(<View revision={String(i)} />));
		assert.equal(reads, initial);
		await act(async () => root.unmount()); unmounted = true;
		assert.equal(Reflect.get(handle, 'draggable'), false);
	} finally { if (!unmounted) await act(async () => root.unmount()); dom.restore(); }
});

test('routing wire hover retains unchanged edge collision geometry', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const frames: FrameRequestCallback[] = [];
	globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
	const project = createSoundscaperProject({ id: 'routing-hover', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView project={project} graph={project.mixer} disabled={false} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} dismissLabel="Close" onCommit={noop} />));
		const edge = dom.one('[data-routing-edge]');
		const style = reactProps(edge).style;
		await act(async () => reactProps(dom.one('[data-routing-source="track:voice"]')).onKeyDown?.({ key: 'Enter', preventDefault() {} }));
		const viewport = dom.one('.kw-routing-graph__viewport');
		await act(async () => reactProps(viewport).onPointerMove?.({ currentTarget: viewport, clientX: 100, clientY: 100 }));
		await act(async () => { for (const frame of frames.splice(0)) frame(0); });
		assert.equal(reactProps(edge).style, style);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
