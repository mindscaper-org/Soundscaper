/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TextToSpeechDialog from '../src/common/editor/ui/dialogs/TextToSpeechDialog.tsx';
import type { TextToSpeechPort } from '../src/common/editor/ui/text-to-speech-port.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const invalidScript of [true, false]) void test(`speech ${invalidScript ? 'control-character validation' : 'generation failure'} has localized primary feedback that follows copy changes`, async () => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const prior = scope.IS_REACT_ACT_ENVIRONMENT; scope.IS_REACT_ACT_ENVIRONMENT = true;
	let generated = 0;
	const request = { text: invalidScript ? 'Hello\tworld' : 'Hello world', language: 'a', voiceId: 'voice', speed: 1 };
	const port: TextToSpeechPort = { load: async () => ({ installed: true, voices: [{ id: 'voice', language: 'a', label: 'Authored voice' }], initial: request, placement: 'new-track' }),
		generate: async () => { generated++; throw new Error('Original engine/model diagnostic'); }, accept: async () => undefined };
	const key = invalidScript ? 'ui.textToSpeech.scriptInvalid' : 'ui.textToSpeech.generationFailed';
	const render = (message: string) => <TextToSpeechDialog port={port} modelBridge={null} locale="de" copy={{ [key]: message }} onClose={() => undefined} />;
	try {
		await act(async () => root.render(render('Deutsche Fehlermeldung')));
		const generate = dom.container.querySelectorAll('button').find(button => button.textContent === 'Generate preview'); assert.ok(generate);
		await act(async () => { await reactProps(generate).onClick(); });
		assert.equal(generated, invalidScript ? 0 : 1, 'invalid scripts are refused before invoking the model');
		assert.equal(dom.one('[role="alert"]').textContent, 'Deutsche Fehlermeldung');
		await act(async () => root.render(render('Message français')));
		assert.equal(dom.one('[role="alert"]').textContent, 'Message français');
		if (!invalidScript) assert.match(dom.one('details').textContent, /Original engine\/model diagnostic/u);
	} finally { await act(async () => root.unmount()); scope.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore(); }
});
