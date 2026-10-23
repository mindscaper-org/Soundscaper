/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { DEFAULT_VIDEO_CLIP_COMPOSITION, type VideoClipComposition } from '../src/common/editor/video-clip-composition.ts';
import VideoCompositionDialog from '../src/common/editor/ui/inspector/VideoCompositionDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const precise: VideoClipComposition = {
	...DEFAULT_VIDEO_CLIP_COMPOSITION,
	crop: { left: 0.0123456789012345, top: 0, right: 0, bottom: 0 },
	transform: {
		...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
		positionX: 1 / 3, anchorY: 1 / 3, scaleX: 1.23456789012345,
		rotationDegrees: 0.123456789012345,
	},
	opacity: 0.876543210987654,
};

for (const operation of ['apply', 'blur', 'change'] as const) {
	test(`composition ${operation} preserves unedited authored precision`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const commands: Array<{ composition: VideoClipComposition }> = [];
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<VideoCompositionDialog
				productId="framescaper" capability
				controller={{ actions: { edit: { commit: (command) => {
					assert.equal(command.type, 'video-composition/set');
					if (command.type === 'video-composition/set') commands.push(command);
				} } } }}
				snapshot={{ project: {
					schemaFamily: 'framescaper', schemaVersion: 1,
					clips: [{ id: 'picture', kind: 'video', videoComposition: precise }],
					tracks: [{ id: 'video', type: 'video', clipIds: ['picture'] }],
					selection: { clipIds: ['picture'] },
				}, selectedClipId: 'picture' }}
				copy={{}} run={(run) => run()} onClose={() => undefined}
			/>));
			if (operation === 'change') {
				await act(async () => reactProps(dom.one('[data-video-composition-field="flip-horizontal"]')).onChange({
					currentTarget: { checked: true },
				}));
			}
			await act(async () => {
				const form = reactProps(dom.one('.audio-editor-clip-inspector'));
				if (operation === 'blur') form.onBlur({ relatedTarget: null });
				else form.onSubmit({ preventDefault: () => undefined });
			});
			if (operation !== 'change') {
				assert.equal(commands.length, 0, 'viewing rounded fields must not author an edit or clear Redo');
			} else {
				assert.equal(commands.length, 1);
				assert.deepEqual(commands[0]?.composition, {
					...precise, transform: { ...precise.transform, flipHorizontal: true },
				}, 'changing one field must preserve every untouched native value');
			}
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
			dom.restore();
		}
	});
}
