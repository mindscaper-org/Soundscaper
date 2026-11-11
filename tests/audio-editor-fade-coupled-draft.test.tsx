/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import ClipFadesDialog from '../src/common/editor/ui/timeline/ClipFadesDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { clipFadeChangeCommand } from '../src/common/editor/ui/timeline/clip-fade-actions.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Edge = 'in' | 'out';
type Changes = Parameters<React.ComponentProps<typeof ClipFadesDialog>['onApply']>[0];

for (const edited of ['in', 'out'] as const) for (const oppositeDraft of ['0.800', '0,8 s']) {
	test(`editing fade-${edited} reports the pushed opposite length after its valid ${oppositeDraft} draft`, async () => {
		await withDialog(async f => {
			const opposite = edited === 'in' ? 'out' : 'in';
			await f.edit(opposite, oppositeDraft);
			assert.equal(f.text(edited), '0.002', 'a non-overlapping edit retains the initial microfade');
			await f.edit(edited, '0.8');
			assert.equal(f.text(edited), '0.8', 'the actively edited draft is retained');
			assert.equal(f.text(opposite), '0.2', 'the opposite field reports the actual pushed length');
			await f.apply();
			assert.equal(f.applied.length, 1);
			assert.equal(f.applied[0]?.[edited === 'in' ? 'fadeInFrames' : 'fadeOutFrames'], 38_400);
			assert.equal(f.applied[0]?.[opposite === 'in' ? 'fadeInFrames' : 'fadeOutFrames'], 9_600);
		});
	});
}

for (const incomplete of ['', '-', '1e', '1.001']) {
	test(`pushing fade-out preserves its incomplete or rejected draft ${JSON.stringify(incomplete)}`, async () => {
		await withDialog(async f => {
			await f.edit('out', '0.8');
			await f.edit('out', incomplete);
			await f.edit('in', '0.8');
			assert.equal(f.text('out'), incomplete);
			assert.equal(f.previews.at(-1)?.fadeOutFrames, 9_600, 'the valid preview still follows the fade-window rule');
			assert.equal(f.applyDisabled(), true, 'an unfinished field cannot silently publish the preview');
			await f.edit('out', '0.1');
			assert.equal(f.applyDisabled(), false, 'completing the existing field remains possible');
			await f.apply();
			assert.equal(f.applied[0]?.fadeOutFrames, 4_800);
		});
	});
}

test('ordinary non-overlapping typing retains both raw valid drafts', async () => {
	await withDialog(async f => {
		await f.edit('out', '0.200 s');
		for (const draft of ['0', '0.', '0.1']) {
			await f.edit('in', draft);
			assert.equal(f.text('in'), draft);
			assert.equal(f.text('out'), '0.200 s');
		}
		await f.apply();
		assert.equal(f.applied[0]?.fadeInFrames, 4_800);
		assert.equal(f.applied[0]?.fadeOutFrames, 9_600);
	});
});

test('imported fade drafts publish both coupled edges through the real command, history, store and Scape', async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new Error('The source requires the shipping PCM decoder.'); } };
	const { controller, store } = await controllerSession(context, { engine: engine as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Fade metadata must not substitute rendered PCM.'); } });
	const input = [new Float32Array(48_000), new Float32Array(48_000)];
	const wave = encodeWav(input, { sampleRate: 48_000, bitDepth: 16, float: false, dither: 'none' });
	await controller.actions.project.importFiles([new File([new Uint8Array(wave)], 'Fade lengths.wav', { type: 'audio/wav' })]);
	const imported = clipboardProject(controller.project), source = imported.sources[0], original = imported.clips[0];
	assert.ok(source?.kind === 'audio' && original?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount, original.durationFrames], [48_000, 48_000, 2, 48_000]);
	assert.deepEqual([original.fadeInFrames, original.fadeOutFrames], [96, 96]);
	controller.actions.timeline.selectClip(original.id);
	const fixture = mountControllerDataDom();
	let opened = 0, closed = 0;
	function Dialog() {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		const [visible, setVisible] = useState(true);
		const value = clipboardProject(snapshot.project);
		const project = { ...value, clips: value.clips.map(clip => {
			assert.ok(clip.kind === 'audio' && typeof clip.timelineStartFrame === 'number' && typeof clip.durationFrames === 'number');
			assert.ok(typeof clip.fadeInFrames === 'number' && typeof clip.fadeOutFrames === 'number');
			assert.ok(clip.fadeInShape === undefined || typeof clip.fadeInShape === 'number');
			assert.ok(clip.fadeOutShape === undefined || typeof clip.fadeOutShape === 'number');
			return { ...clip, timelineStartFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames,
				fadeInFrames: clip.fadeInFrames, fadeOutFrames: clip.fadeOutFrames, fadeInShape: clip.fadeInShape, fadeOutShape: clip.fadeOutShape };
		}), tracks: value.tracks.map(track => {
			assert.ok(Array.isArray(track.clipIds) && track.clipIds.every((id: unknown) => typeof id === 'string'));
			return { ...track, clipIds: track.clipIds };
		}) };
		const clip = project.clips.find(row => row.id === original.id); assert.ok(clip);
		return visible ? <ClipFadesDialog clip={clip} sampleRate={48_000} copy={ENGLISH_COPY} blocked={false}
			portalHost={fixture.dom.container as unknown as Element} onPreview={() => undefined}
			onClose={() => { closed += 1; setVisible(false); }} onApply={changes => {
				void fixture.run(() => {
					const command = clipFadeChangeCommand(project, original.id, 48_000, changes); assert.ok(command);
					return controller.actions.edit.commit(command);
				});
			}} /> : null;
	}
	const field = (edge: Edge) => fixture.dom.container.querySelectorAll('.number-stepper__input')[edge === 'in' ? 0 : 1]!;
	const text = (edge: Edge) => String(reactProps(field(edge)).value);
	const edit = async (edge: Edge, value: string) => { await act(async () => { reactProps(field(edge)).onChange({ target: { value } }); }); };
	const open = async () => { await fixture.render(<Dialog key={++opened} />); };
	const publish = async (before: ReturnType<typeof clipboardProject>, expected: readonly number[]) => {
		const entries = controller.getSnapshot().history.undoEntries.length;
		assert.deepEqual(controller.project, before, 'draft changes must not publish before Apply');
		const button = fixture.dom.container.querySelectorAll('button').find(node => node.textContent === 'Apply'); assert.ok(button);
		await act(async () => { reactProps(button).onClick(); await fixture.settle(); });
		assert.equal(closed, opened); assert.equal(fixture.dom.find('[role="dialog"]'), null);
		const after = clipboardProject(controller.project), clip = after.clips.find(row => row.id === original.id); assert.ok(clip);
		assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames], expected);
		assert.deepEqual(after.sources, imported.sources);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		await act(async () => { await controller.actions.project.flush(); }); assert.deepEqual(await store.loadProject(after.id), after);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
	};
	try {
		await open(); const initial = text('in');
		await edit('out', '0.8'); assert.equal(text('in'), initial);
		for (const edge of ['in', 'out'] as const) {
			const before = clipboardProject(controller.project);
			await edit('in', '0.8'); if (edge === 'out') await edit('out', '0.8');
			assert.deepEqual([text('in'), text('out')], edge === 'in' ? ['0.8', '0.2'] : ['0.2', '0.8']);
			await publish(before, edge === 'in' ? [38_400, 9_600] : [9_600, 38_400]);
			await open(); assert.deepEqual([text('in'), text('out')], edge === 'in' ? ['0.8', '0.2'] : ['0.2', '0.8']);
		}
		const before = clipboardProject(controller.project);
		await edit('out', '0.200 s');
		for (const draft of ['', '0', '0.', '0.1']) await edit('in', draft);
		assert.deepEqual([text('in'), text('out')], ['0.1', '0.200 s']);
		await publish(before, [4_800, 9_600]); await open();
		assert.deepEqual([text('in'), text('out')], ['0.1', '0.2']);
		await act(async () => { await controller.actions.project.flush(); });
		const reopened = await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
			assert.equal(name, 'Fade lengths.wav'); assertPcmChannelsEqual(channels, input, 'every original stereo silence sample');
		});
		assert.deepEqual([reopened.clips[0]?.fadeInFrames, reopened.clips[0]?.fadeOutFrames], [4_800, 9_600]);
	} finally { await fixture.dispose(); }
});

async function withDialog(run: (fixture: {
	readonly applied: Changes[];
	readonly previews: Changes[];
	readonly text: (edge: Edge) => string;
	readonly edit: (edge: Edge, draft: string) => Promise<void>;
	readonly apply: () => Promise<void>;
	readonly applyDisabled: () => boolean;
}) => Promise<void>) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const applied: Changes[] = [], previews: Changes[] = [];
	try {
		await act(async () => root.render(<ClipFadesDialog
			clip={{ id: 'take', timelineStartFrame: 0, durationFrames: 48_000, fadeInFrames: 96, fadeOutFrames: 96 }}
			portalHost={dom.container as unknown as Element} sampleRate={48_000} copy={ENGLISH_COPY} blocked={false}
			onPreview={changes => { previews.push(changes); }} onApply={changes => { applied.push(changes); }} onClose={() => undefined} />));
		const field = (edge: Edge) => dom.container.querySelectorAll('.number-stepper__input')[edge === 'in' ? 0 : 1]!;
		const apply = dom.container.querySelectorAll('button').find(button => button.textContent === 'Apply');
		assert.ok(apply);
		await run({ applied, previews, text: edge => String(reactProps(field(edge)).value),
			edit: async (edge, draft) => { await act(async () => { reactProps(field(edge)).onChange({ target: { value: draft } }); }); },
			apply: async () => { await act(async () => { reactProps(apply).onClick(); }); },
			applyDisabled: () => apply.hasAttribute('disabled'),
		});
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
}
