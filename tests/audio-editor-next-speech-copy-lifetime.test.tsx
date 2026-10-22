/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TextToSpeechDialog from '../src/common/editor/ui/dialogs/TextToSpeechDialog.tsx';
import type { TextToSpeechPort, TextToSpeechReviewed } from '../src/common/editor/ui/text-to-speech-port.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const request = { text: 'A reviewed narration.', language: 'a', voiceId: 'voice-a', speed: 1 };
const reviewed: TextToSpeechReviewed = {
	audio: new Blob(['RIFF'], { type: 'audio/wav' }), request,
	modelId: 'kokoro-82m', modelVersion: '1', artifactSha256s: ['a'.repeat(64)],
};

for (const pending of [false, true]) test(`speech presentation changes retain ${pending ? 'pending generation' : 'reviewed audio'}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let loads = 0;
	let finish: (value: TextToSpeechReviewed) => void = () => { throw new Error('Generation has not started.'); };
	const generated: AbortSignal[] = [];
	const accepted: TextToSpeechReviewed[] = [];
	const port: TextToSpeechPort = {
		load: async () => { loads++; return { installed: true, voices: [{ id: 'voice-a', language: 'a', label: 'Voice' }],
			initial: request, placement: 'new-track' }; },
		generate: (_request, signal) => {
			generated.push(signal);
			return pending ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reviewed);
		},
		accept: async value => { accepted.push(value); },
	};
	const render = async (copy: Readonly<Record<string, string>>): Promise<void> => {
		await act(async () => { root.render(<TextToSpeechDialog port={port} modelBridge={null} copy={copy}
			locale="en" onClose={() => undefined} />); });
	};
	try {
		await render({});
		await act(async () => { reactProps(button(dom.container, 'Generate preview')).onClick({}); });
		const audio = dom.find('audio');
		assert.equal(Boolean(audio), !pending);
		await render({ 'ui.textToSpeech.title': 'Narration', 'ui.textToSpeech.cancel': 'Cancel narration' });
		assert.equal(loads, 1, 'copy changes must not reload or reset the active speech session');
		assert.equal(generated.length, 1);
		assert.equal(generated[0]?.aborted, false);
		if (pending) {
			assert.ok(button(dom.container, 'Cancel narration'));
			assert.equal(dom.one('textarea').hasAttribute('disabled'), true);
			await act(async () => { finish(reviewed); });
		} else assert.equal(dom.one('audio'), audio, 'retain the same native preview and object URL');
		await act(async () => { reactProps(button(dom.container, 'Add as new track at playhead')).onClick({}); });
		assert.deepEqual(accepted, [reviewed]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('unavailable speech presentation updates its translated explanation without a reload', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		for (const unavailable of ['Unavailable here.', 'Narration is unavailable.']) {
			await act(async () => { root.render(<TextToSpeechDialog port={null} modelBridge={null}
				copy={{ 'ui.textToSpeech.unavailable': unavailable }} locale="en" onClose={() => undefined} />); });
			assert.equal(dom.one('[role="alert"]').textContent, unavailable);
		}
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function button(container: ReactTestElement, label: string): ReactTestElement {
	const found = container.querySelectorAll('button').find(candidate => candidate.textContent === label);
	assert.ok(found, `Missing ${label}`);
	return found;
}
