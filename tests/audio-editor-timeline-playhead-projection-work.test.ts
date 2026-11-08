/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTimelinePlaybackFrame } from '../src/common/editor/ui/timeline/timeline-playhead-projection.ts';

function fixture() {
	const events: string[] = [];
	let writesStarted = false;
	const style = (owner: string) => {
		const properties = new Map<string, string>();
		return {
			getPropertyValue: (name: string) => properties.get(name) ?? '',
			setProperty(name: string, value: string) {
				writesStarted = true; events.push(`write:${owner}:${name}`); properties.set(name, value);
			},
		};
	};
	const targets = [{ style: style('ruler') }, { style: style('cursor') }, { style: style('output') }];
	const root = { style: style('root'), querySelectorAll: () => targets };
	const geometry = { scrollLeft: 0, scrollWidth: 2_000, clientWidth: 300 };
	const read = (key: keyof typeof geometry) => {
		if (writesStarted) throw new Error(`Layout read after style write: ${key}`);
		events.push(`read:${key}`);
		return geometry[key];
	};
	const scroll = {
		dataset: { timelineScrollScale: '1' },
		get scrollLeft() { return read('scrollLeft'); },
		get scrollWidth() { return read('scrollWidth'); },
		get clientWidth() { return read('clientWidth'); },
	};
	return {
		events, targets, geometry, style,
		root: root as unknown as HTMLElement, scroll: scroll as unknown as HTMLElement,
		reset() { writesStarted = false; events.length = 0; },
	};
}

const options = { playheadX: 112, follow: true, mode: 'page' as const, viewportWidth: 300,
	leadingInset: 12, suspended: false };

test('playback reads follow geometry before writing only the actual playhead consumers', () => {
	const h = fixture();
	const projection = projectTimelinePlaybackFrame(h.root, h.scroll, options);
	assert.deepEqual(projection, { suspended: false, targetDomScrollX: null });
	assert.deepEqual(h.events, ['read:scrollLeft', 'write:ruler:--timeline-playhead-x',
		'write:cursor:--timeline-playhead-x', 'write:output:--timeline-playhead-x', 'write:root:--timeline-playhead-x']);
	for (const target of h.targets) assert.equal(target.style.getPropertyValue('--timeline-playhead-x'), '112px');
	assert.equal(h.root.style.getPropertyValue('--timeline-playhead-x'), '112px');
});

test('pinned playback resolves deep-zoom scroll bounds before playhead writes', () => {
	const h = fixture();
	h.scroll.dataset.timelineScrollScale = '10';
	const projection = projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, mode: 'pinned', playheadX: 1_012 });
	assert.deepEqual(projection, { suspended: false, targetDomScrollX: 86.2 });
	assert.deepEqual(h.events.slice(0, 3), ['read:scrollLeft', 'read:scrollWidth', 'read:clientWidth']);
});

test('disabled follow and stopped projections do not demand scroll geometry', () => {
	for (const overrides of [{ mode: 'none' as const }, { follow: false }]) {
		const h = fixture();
		projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, ...overrides });
		assert.equal(h.events.some(event => event.startsWith('read:')), false);
	}
});

test('stationary playback avoids repeated writes but initializes a newly mounted paused consumer', () => {
	const h = fixture();
	projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, follow: false });
	h.reset();
	projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, follow: false });
	assert.deepEqual(h.events, []);
	const mounted = { style: h.style('mounted-output') };
	h.targets.push(mounted);
	projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, follow: false });
	assert.deepEqual(h.events, ['write:mounted-output:--timeline-playhead-x']);
	assert.equal(mounted.style.getPropertyValue('--timeline-playhead-x'), '112px');
});

test('manual scroll suspension and DOM scroll tolerance retain their follow semantics', () => {
	const h = fixture();
	assert.deepEqual(projectTimelinePlaybackFrame(h.root, h.scroll, { ...options, playheadX: 1_012, suspended: true }),
		{ suspended: true, targetDomScrollX: null });
	h.reset(); h.geometry.scrollLeft = 850;
	assert.deepEqual(projectTimelinePlaybackFrame(h.root, h.scroll, {
		...options, mode: 'pinned', playheadX: 1_000,
	}), { suspended: false, targetDomScrollX: null });
});
