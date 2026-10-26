/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipFadeOverlays } from '../src/common/editor/ui/timeline/ClipFadeOverlays.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('unselected audio clips expose corner zones and a bare-edge peek without selecting the clip', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); });
	const clip = { id: 'one', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000, fadeOutFrames: 12_000 };
	const rootRef = { current: dom.container as unknown as HTMLDivElement };
	const changes: unknown[] = [];
	const render = async (selected: boolean) => act(async () => root.render(<><div data-clip-id="one" />
		<ClipFadeOverlays rootRef={rootRef} clips={[clip]} selectedIds={new Set(selected ? ['one'] : [])}
			startFrame={0} endFrame={48_000} pixelsPerSecond={200} sampleRate={48_000} blocked={false}
			showFadeShapeHandles crossfadedFadeEdges={new Set()}
			copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out', fadeInShape: 'Fade in shape', fadeOutShape: 'Fade out shape', legacyLinearFadeShape: 'Linear' }}
			onChange={(...args) => changes.push(args)} onTabOut={() => {}} /></>));
	await render(false);
	const zone = dom.one('[data-fade-zone="in"]');
	assert.equal(zone.getAttribute('data-clip-fade-handle'), 'in', 'the corner uses the native fade gesture');
	assert.equal((zone.style as unknown as CSSStyleDeclaration).left, '-16px');
	assert.equal((dom.one('[data-fade-zone="out"]').style as unknown as CSSStyleDeclaration).left, '134px', 'an existing fade owns its boundary');
	await act(async () => reactProps(zone).onMouseEnter({ buttons: 0 }));
	assert.equal(dom.one('[data-fade-peek="in"]').getAttribute('aria-hidden'), 'true');
	assert.deepEqual(changes, [], 'hover is a preview only');
	await render(true);
	assert.equal(dom.container.querySelectorAll('[data-fade-zone]').length, 0);
	assert.equal(dom.one('.audio-editor-clip-fade').getAttribute('data-fade-selected'), 'true');
});
