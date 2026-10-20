/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	installReactTestDom, reactProps,
} from './helpers/react-test-dom.ts';

test('the Media settings menu reads and changes the selected clip pitch link', async () => {
	const f = await mountedFixture({ linkPitchAndTempo: true });
	try {
		await f.openSettings();
		assert.equal(f.menuItem(ENGLISH_COPY.clipLinkPitchAndTempo).getAttribute('aria-checked'), 'true');
		await f.choose(ENGLISH_COPY.clipLinkPitchAndTempo);
		assert.deepEqual(f.timePitchCalls, [{ linkPitchAndTempo: false }]);
	} finally { await f.cleanup(); }
});

test('linked pitch reads speed and commits semitones or percent without overwriting independent pitch', async () => {
	const f = await mountedFixture({ linkPitchAndTempo: true, speedRatio: 4, pitchCents: 300 });
	try {
		assert.equal(f.pitchValue(), '24');
		await f.commitPitch('12');
		await f.choosePitchUnit(ENGLISH_COPY.clipPitchUnitPercent);
		assert.equal(f.pitchValue(), '300');
		await f.commitPitch('-75');
		assert.deepEqual(f.timePitchCalls, [{ speedRatio: 2 }, { speedRatio: 0.25 }]);
		await f.commitPitch('-100');
		assert.equal(f.failures[0]?.message, ENGLISH_COPY.clipLinkedPitchRange);
		assert.equal(f.timePitchCalls.length, 2);
	} finally { await f.cleanup(); }
});

test('exact semitone entry commits cents through the live property field', async () => {
	const f = await mountedFixture({ pitchCents: 200 });
	try {
		assert.equal(f.pitchValue(), '2');
		for (const text of ['1.01', '-0.07', '12']) await f.commitPitch(text);
		assert.deepEqual(f.timePitchCalls, [{ pitchCents: 101 }, { pitchCents: -7 }, { pitchCents: 1200 }]);
	} finally { await f.cleanup(); }
});

test('percent entry converts frequency change and reports an unsupported silent value to the workspace', async () => {
	const f = await mountedFixture();
	try {
		await f.choosePitchUnit(ENGLISH_COPY.clipPitchUnitPercent);
		for (const text of ['100', '-50']) await f.commitPitch(text);
		assert.deepEqual(f.timePitchCalls, [{ pitchCents: 1200 }, { pitchCents: -1200 }]);
		await f.commitPitch('-100');
		assert.equal(f.failures[0]?.message, ENGLISH_COPY.clipPitchRange);
		assert.equal(f.timePitchCalls.length, 2);
	} finally { await f.cleanup(); }
});

test('empty and out-of-range semitone entries preserve the stored pitch', async () => {
	const f = await mountedFixture({ pitchCents: 200 });
	try {
		await f.commitPitch('');
		assert.deepEqual(f.timePitchCalls, []);
		assert.equal(f.failures.length, 0, 'the native numeric control discards an empty draft');
		await f.commitPitch('13');
		assert.deepEqual(f.timePitchCalls, []);
		assert.equal(f.failures[0]?.message, ENGLISH_COPY.clipPitchRangeSemitones);
	} finally { await f.cleanup(); }
});

async function mountedFixture(clipOverrides: Readonly<Record<string, unknown>> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const currentProject = project(clipOverrides);
	const timePitchCalls: Array<Record<string, unknown>> = [];
	const failures: Error[] = [];
	const controller = { get project() { return currentProject; }, actions: { clip: {
		setTimePitch: (_clipId: string, changes: Record<string, unknown>) => { timePitchCalls.push(changes); },
	} } };
	const run = (operation: () => unknown) => {
		const value = operation();
		void Promise.resolve(value).catch(cause => { failures.push(cause as Error); });
		return value;
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipPropertiesPanel controller={controller} run={run}
		snapshot={{ project: currentProject, selectedClipId: 'shared-clip', capabilities: { audioEffects: true } }} copy={ENGLISH_COPY} />));
	const menuItem = (label: string) => {
		const item = dom.container.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]').find(node =>
			node.querySelector('.context-menu-item-label')?.textContent === label);
		assert.ok(item, label);
		return item;
	};
	const choose = async (label: string) => {
		await act(async () => reactProps(menuItem(label)).onClick({ stopPropagation() {} }));
	};
	const openSettings = async () => {
		const trigger = dom.one('[data-clip-audio-settings]');
		await act(async () => reactProps(trigger).onClick({ currentTarget: trigger }));
	};
	const field = () => dom.one('[data-clip-properties-field="pitch"]');
	const input = () => { const input = field().querySelector('input'); assert.ok(input); return input; };
	return { timePitchCalls, failures, menuItem, choose, openSettings,
		pitchValue: () => input().value,
		commitPitch: async (text: string) => {
			await act(async () => reactProps(input()).onChange({ target: { value: text } }));
			await act(async () => reactProps(field()).onBlur({ target: input() }));
		},
		choosePitchUnit: async (label: string) => { await openSettings(); await choose(ENGLISH_COPY.clipPitchUnit); await choose(label); },
		cleanup: async () => {
			await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(clipOverrides: Readonly<Record<string, unknown>>) {
	const source = createAudioSource({
		id: 'shared-source', storageKey: 'shared-source', name: 'Interview',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: 'Interview',
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
		...clipOverrides,
	});
	return createSoundscaperProject({
		id: 'project', title: 'Project', now: '2026-09-03T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}
