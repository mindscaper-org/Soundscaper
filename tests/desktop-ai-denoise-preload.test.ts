/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installAiDenoisePreload } from '../desktop/ai-denoise-preload.ts';

test('preload forwards only a same-window closed request with one port', () => {
	let listener!: (event: MessageEvent) => void;
	const target = { addEventListener: (_type: string, callback: (event: MessageEvent) => void) => { listener = callback; } };
	const sent: unknown[][] = [];
	installAiDenoisePreload(target as unknown as Window, { postMessage: (...args) => { sent.push(args); } });
	const request = { sessionId: 'a'.repeat(40), sampleRate: 48000, channelCount: 1 };
	const port = { postMessage: () => undefined, close: () => undefined };
	const event = { source: target, data: { type: 'soundscaper-ai-denoise-connect-v1', request }, ports: [port] };
	listener({ ...event, source: {} } as unknown as MessageEvent);
	assert.equal(sent.length, 0);
	listener(event as unknown as MessageEvent);
	assert.deepEqual(sent, [['soundscaper:v1:ai-denoise:connect', request, [port]]]);
	let closed = 0;
	const stalePort = { postMessage: () => { throw new Error('closed'); }, close: () => { closed++; } };
	assert.doesNotThrow(() => listener({ ...event, data: { ...event.data, request: { ...request, path: '/untrusted' } }, ports: [stalePort] } as unknown as MessageEvent));
	assert.equal(sent.length, 1); assert.equal(closed, 1);
});
