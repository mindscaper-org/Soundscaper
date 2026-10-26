/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTimelineTrackRemovalFocus } from '../src/common/editor/ui/timeline/track-removal-focus.ts';
import { prepareTimelineLabelRemovalFocus } from '../src/common/editor/ui/timeline/label-removal-focus.ts';
import { createTimelineClipRemovalFocus } from '../src/common/editor/ui/timeline/timeline-clip-removal-focus.ts';

void test('U13 removed track neighbour lookup is linear and respects transferred focus', () => {
	let reads = 0, focusCalls = 0, selected = '';
	const body = {};
	const document = { activeElement: body, body };
	const rows = Array.from({ length: 400 }, (_, index) => ({ isConnected: true, get dataset() { reads++; return { trackId: String(index) }; }, closest: (selector: string) => selector === '[data-audio-editor]' ? editor : null,
		querySelector: () => ({ isConnected: true, focus: () => { focusCalls++; } }) }));
	const editor = { isConnected: true, querySelectorAll: () => survivors, querySelector: () => null };
	let survivors = rows;
	const focused = { isConnected: true, closest: () => rows[0] };
	document.activeElement = focused;
	const restore = prepareTimelineTrackRemovalFocus(document as unknown as Document, id => { selected = id; });
	survivors = rows.slice(200); rows[0]!.isConnected = false; focused.isConnected = false; document.activeElement = body;
	const previous = globalThis.requestAnimationFrame;
	globalThis.requestAnimationFrame = callback => { callback(0); return 1; };
	try {
		reads = 0; restore?.(); assert.equal(selected, '200'); assert.equal(focusCalls, 1);
		assert.ok(reads <= 405, `survivor dataset reads ${reads}`);
		document.activeElement = {}; restore?.(); assert.equal(focusCalls, 1);
	} finally { globalThis.requestAnimationFrame = previous; }
});

void test('U14 label removal finds the first surviving neighbour in linear work and respects focus ownership', () => {
	let reads = 0, focusedId = '';
	const body = {}; const document = { activeElement: body, body };
	const labels = Array.from({ length: 400 }, (_, index) => ({ isConnected: true, get dataset() { reads++; return { labelId: String(index) }; }, focus: () => { focusedId = String(index); } }));
	let survivors = labels;
	const lane = { isConnected: true, ownerDocument: document, contains: () => true, querySelectorAll: () => survivors };
	document.activeElement = labels[0]!;
	const restore = prepareTimelineLabelRemovalFocus(lane as unknown as HTMLElement, '0');
	survivors = labels.slice(200); labels[0]!.isConnected = false; document.activeElement = body;
	const previous = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = callback => { callback(0); return 1; };
	try {
		reads = 0; restore?.(); assert.equal(focusedId, '200'); assert.ok(reads <= 400, `label dataset reads ${reads}`);
		focusedId = ''; document.activeElement = {}; restore?.(); assert.equal(focusedId, '');
	} finally { globalThis.requestAnimationFrame = previous; }
});

void test('U15 clip removal uses current-node membership once and releases remembered detached nodes', () => {
	let selected = '', includesCalls = 0;
	const body = {}; const document = { body, activeElement: body };
	const clips = Array.from({ length: 400 }, (_, index) => ({ isConnected: true, dataset: { clipId: String(index) }, hasAttribute: () => true, getAttribute: () => 'group', closest: () => null, focus: () => { selected = String(index); } }));
	let survivors = clips;
	const root = { ownerDocument: document, isConnected: true, contains: () => true, querySelectorAll: () => survivors, querySelector: () => null };
	const reader = createTimelineClipRemovalFocus(() => root as unknown as HTMLElement);
	reader.remember(clips[0] as unknown as HTMLElement);
	clips[0]!.isConnected = false; survivors = clips.slice(200);
	const includes = Array.prototype.includes;
	Array.prototype.includes = function (this: unknown[], ...args: [unknown, number?]) { includesCalls++; return Reflect.apply(includes, this, args) as boolean; };
	try {
		reader.restore(); assert.equal(selected, '200'); assert.equal(includesCalls, 0);
		selected = ''; reader.restore(); assert.equal(selected, '');
	} finally { Array.prototype.includes = includes; }
});
