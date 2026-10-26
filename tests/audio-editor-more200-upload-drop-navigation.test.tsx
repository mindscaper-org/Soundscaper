/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudiocomUploadArea from '../src/common/editor/ui/workspace/AudiocomUploadArea.tsx';
import FreesoundUploadArea from '../src/common/editor/ui/workspace/FreesoundUploadArea.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const service of ['audiocom', 'freesound'] as const) {
	test(`a blocked ${service} file drop remains a cancelled browser navigation`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let admitted = 0;
		const onFiles = () => { admitted++; };
		try {
			await act(async () => root.render(service === 'audiocom'
				? <AudiocomUploadArea copy={{}} disabled queue={{ active: false, items: [] }} onFiles={onFiles}
					onPublish={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onRemove={() => undefined} />
				: <FreesoundUploadArea copy={{}} disabled queue={{ active: false, items: [] }} onFiles={onFiles} />));
			const drop = dom.one(`[data-${service}-upload-drop]`);
			for (const handler of ['onDragEnter', 'onDragOver']) {
				let cancelled = false;
				const dataTransfer = { types: ['Files'], dropEffect: 'copy' };
				await act(async () => reactProps(drop)[handler]({ preventDefault() { cancelled = true; }, dataTransfer }));
				assert.equal(cancelled, true, `${handler} must keep the file from navigating the page`);
				assert.equal(dataTransfer.dropEffect, 'none');
			}
			await act(async () => reactProps(drop).onDrop({ preventDefault() {},
				dataTransfer: { files: [new File(['audio'], 'take.wav')], types: ['Files'], getData: () => '' } }));
			assert.equal(admitted, 0);
			assert.ok(!drop.getAttribute('class')?.includes('is-dragging'));
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
