/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { lightTheme, darkTheme } from '@audacity-ui/tokens';
import { NoteRect } from '../vendor/audacity-design-system/components/src/NoteRect/NoteRect.tsx';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MIDI pitch labels stay readable across velocity, selection, track colors and themes', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		for (const theme of [lightTheme, darkTheme]) {
			const colors = [undefined, ...Object.entries(theme.audio.clip).filter(([, value]) => 'header' in value).map(([key]) => key)];
			for (const trackColor of colors) for (const pitch of [60, 61]) for (const velocity of [1, 64, 127]) for (const isSelected of [true, false]) {
				await act(async () => root.render(<ThemeProvider theme={theme}><NoteRect note={{ id: 1, pitch, velocity }}
					x={0} y={0} width={50} height={16} isSelected={isSelected} trackColor={trackColor} onMouseDown={() => {}} /></ThemeProvider>));
				const note = dom.one('[data-note-id="1"]');
				const style = (reactProps(note) as unknown as { style: React.CSSProperties & Record<string, string> }).style;
				assert.equal(style.opacity, 1, 'velocity must not fade pitch text');
				const fill = style[isSelected ? '--note-fill-selected' : '--note-fill'];
				const ratio = wcagContrastRatio(style['--note-label-color'] ?? '#ffffff', fill ?? '');
				assert.ok(ratio >= 4.5, `${trackColor ?? 'default'} pitch${pitch} velocity${velocity} selected${isSelected}: ${ratio.toFixed(2)}:1`);
			}
		}
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
