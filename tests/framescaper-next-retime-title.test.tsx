/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VideoRetimeDialog from '../src/common/editor/ui/dialogs/VideoRetimeDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

test('the retime inspector identifies the selected native video by its authored title', () => {
	const project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	const clip = project.clips.find(item => item.kind === 'video');
	assert.ok(clip);
	assert.notEqual(clip.title, clip.id);
	const noop = () => undefined;
	const markup = renderToStaticMarkup(<VideoRetimeDialog productId="framescaper" capability editingBlocked={false}
		controller={{ actions: { sequences: { retimeConstant: noop, retimeReset: noop, retimeReverse: noop,
			retimeFreeze: noop, retimeRamp: noop, retimeSet: noop } } }}
		snapshot={{ project, selectedClipId: clip.id }} copy={{}} run={operation => operation()} onClose={noop} />);
	assert.ok(markup.includes(`<h3>${String(clip.title)}</h3>`), markup);
});
