/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	appendParallelStackProcessingMenu,
	type ParallelStackMenuItem,
} from '../src/common/editor/ui/parallel-stack-menu.ts';
import type { ParallelStackPreferences } from '../src/common/editor/engine/parallel-stack-preferences.ts';
import { organizeNativePreferences } from '../src/common/editor/ui/local-processing-menus.ts';
import type { AssistanceMenuEntry } from '../src/common/editor/ui/assistance-task-catalog.ts';

const preferences = { enabled: false, workerLimit: 'auto', pipelineFrames: 768 } as const;
function find(items: readonly ParallelStackMenuItem[], id: string): ParallelStackMenuItem {
	for (const item of items) {
		if (item.id === id) return item;
		if (item.items) {
			try { return find(item.items, id); } catch { /* Search the remaining groups. */ }
		}
	}
	throw new Error(`Missing menu: ${id}`);
}

test('parallel processing is menu-only in Soundscaper on both hosts and defaults off', () => {
	const changed: Partial<ParallelStackPreferences>[] = [];
	const input = { productId: 'soundscaper', blocked: false, preferences,
		status: { state: 'off', sampleRate: 48000 } as const };
	assert.deepEqual(appendParallelStackProcessingMenu([], { ...input, productId: 'framescaper' }, () => undefined), []);
	const menus = appendParallelStackProcessingMenu([], input, (patch) => { changed.push(patch); });
	assert.equal(menus[0]?.label, 'Processing');
	assert.equal(find(menus, 'parallel-stack-enabled').checked, false);
	assert.match(find(menus, 'parallel-stack-latency').label, /16 ms at 48000 Hz/);
	find(menus, 'parallel-stack-enabled').onClick?.();
	find(menus, 'parallel-stack-workers-4').onClick?.();
	find(menus, 'parallel-stack-buffering-1536').onClick?.();
	assert.deepEqual(changed, [{ enabled: true }, { workerLimit: 4 }, { pipelineFrames: 1536 }]);
});

test('parallel processing stays separate from Audio setup and keeps status readable while playback blocks changes', () => {
	const menus = appendParallelStackProcessingMenu([{
		id: 'native-audio', label: 'Audio setup', items: [{ id: 'native-device', label: 'Device' }],
	}], { productId: 'soundscaper', blocked: true, preferences: { ...preferences, enabled: true },
		status: { state: 'failed', reason: 'Missed a deadline', sampleRate: 48000 },
	}, () => { throw new Error('Must not change while playing'); });
	assert.equal(menus.length, 2);
	assert.equal(menus[0]?.items?.some((item) => item.id === 'parallel-stack-processing'), false);
	assert.equal(find(menus, 'native-device').label, 'Device');
	const toggle = find(menus, 'parallel-stack-enabled');
	assert.equal(toggle.disabled, true);
	assert.match(toggle.disabledReason ?? '', /Stop playback and recording/);
	assert.equal(toggle.onClick, undefined);
	assert.match(find(menus, 'parallel-stack-status').label, /Missed a deadline.*Next playback uses standard/);
});

test('Audio setup moves to Audio preferences while processing moves to Advanced', () => {
	const menus = appendParallelStackProcessingMenu([{
		id: 'native-audio', label: 'Audio setup', items: [{ id: 'native-device', label: 'Device' }],
	}], { productId: 'soundscaper', blocked: false, preferences,
		status: { state: 'off' },
	}, () => undefined);
	const adapt = (item: ParallelStackMenuItem): AssistanceMenuEntry => ({ ...item, items: item.items?.map(adapt) });
	const [tools] = organizeNativePreferences([{ id: 'tools', label: 'Tools', items: menus.map(adapt) }]);
	assert.deepEqual(tools?.items, []);
	const native = tools?.nativePreferences as readonly (ParallelStackMenuItem & { section: string })[];
	const audio = native.filter((item) => item.section === 'audio');
	const advanced = native.filter((item) => item.section === 'advanced');
	assert.ok(audio.some((item) => item.items?.some((child) => child.id === 'native-device')));
	assert.ok(advanced.some((item) => item.id === 'parallel-stack-processing'));
	assert.equal(find(advanced, 'parallel-stack-enabled').checked, false);
	assert.throws(() => find(audio, 'parallel-stack-processing'), /Missing menu/u);
});

test('browser processing moves into Advanced without requiring native audio devices', () => {
	const menus = appendParallelStackProcessingMenu([], {
		productId: 'soundscaper', blocked: false, preferences, status: { state: 'off' },
	}, () => undefined);
	const adapt = (item: ParallelStackMenuItem): AssistanceMenuEntry => ({ ...item, items: item.items?.map(adapt) });
	const [tools] = organizeNativePreferences([{ id: 'tools', label: 'Tools', items: menus.map(adapt) }]);
	assert.deepEqual(tools?.items, []);
	const native = tools?.nativePreferences as readonly ParallelStackMenuItem[];
	assert.equal((native[0] as ParallelStackMenuItem & { section: string }).section, 'advanced');
	assert.equal(find(native, 'parallel-stack-workers-auto').checked, true);
	assert.equal(find(native, 'parallel-stack-buffering-768').checked, true);
});
