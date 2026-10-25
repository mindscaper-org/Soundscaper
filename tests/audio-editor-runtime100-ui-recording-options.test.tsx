/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordingInputSelectors from '../src/common/editor/ui/RecordingInputSelectors.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { TRACK_COPY_BY_LOCALE } from '../src/common/i18n/track-copy.js';

function fixture(channelCount: 1 | 2) {
	const devices = Array.from({ length: 32 }, (_, index) => ({ deviceId: `device-${index}`, label: `Interface ${index}`, channelCount: 64, status: 'available' }));
	const routes = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`track-${index}`, {
		kind: 'device', deviceId: `device-${index % devices.length}`, channelStart: index % 8, channelCount,
	}]));
	return { controller: { actions: { recording: { setTrackInput() {} } } },
		recordingInputs: { routes, devices }, track: { id: 'track-0', name: 'Microphone', type: 'audio' },
		copy: { ...ENGLISH_COPY, ...TRACK_COPY_BY_LOCALE.en }, run: (operation: () => unknown) => operation(), displayAudioSupported: false };
}

for (const width of [1, 2] as const) test(`U38 recording channel options avoid temporary ${width}-channel conflict arrays`, context => {
	const props = fixture(width), before = JSON.stringify(props.recordingInputs);
	const descriptor = Object.getOwnPropertyDescriptor(Array, 'from')!;
	const original = Array.from;
	let allocations = 0;
	Object.defineProperty(Array, 'from', { ...descriptor, value(this: unknown, ...args: unknown[]) {
		const source = args[0];
		if (source && typeof source === 'object' && !Array.isArray(source)
			&& 'length' in source && (source.length === 1 || source.length === 2) && typeof args[1] === 'function') allocations++;
		return Reflect.apply(original, this, args) as unknown;
	} });
	let markup: string;
	try { markup = renderToStaticMarkup(<RecordingInputSelectors {...props} />); }
	finally { Object.defineProperty(Array, 'from', descriptor); }
	const digest = createHash('sha256').update(markup).digest('hex');
	context.diagnostic(`U38 width ${width}: conflict arrays ${allocations}; exact markup SHA256 ${digest}`);
	assert.equal(digest, width === 1 ? 'cea9b9e0f19393ed6abf744733e5e7a4afa2928dbffad448c20ae7b4e3a4c74b'
		: 'a8532ee2a41c6dfe169b29dc8fde385a9a5d956d1dd8f96a457d953e3fc75784');
	assert.equal(JSON.stringify(props.recordingInputs), before);
	assert.match(markup, /<option value="device:device-31">Interface 31<\/option>/u);
	assert.equal(allocations, 0);
});
