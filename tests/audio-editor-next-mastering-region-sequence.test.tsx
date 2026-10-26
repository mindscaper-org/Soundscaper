/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createDocumentMasteringSequenceSnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import SoundscaperMasteringSequenceEditor from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceEditor.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import { masteringRegionProject } from './helpers/next-mastering-region-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the mastering editor offers regions from its selected order sequence', async context => {
	const project = masteringRegionProject(), document = createDocumentMasteringSequenceSnapshot(project);
	assert.equal(document.sequences.find(sequence => sequence.id === 'cut-order')!.deliverable, true);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	await act(async () => root.render(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} disabled={false} {...document} createId={() => 'new-entry'} onOperation={() => {}} />));
	const picker = dom.one('[data-mastering-sequence-picker]');
	await act(async () => reactProps(picker).onChange?.({ currentTarget: { value: 'cut-order' } }));
	const options = dom.container.querySelectorAll('option').map(option => option.getAttribute('value'));
	assert.ok(options.includes('cut-b'), 'the secondary order must offer its own new region');
	assert.ok(!options.includes('main-region'), 'a region from another sequence would make this order undeliverable');
	await act(async () => reactProps(picker).onChange?.({ currentTarget: { value: 'main-order' } }));
	const primary = dom.container.querySelectorAll('option').map(option => option.getAttribute('value'));
	assert.ok(primary.includes('main-region'));
	assert.ok(!primary.includes('cut-b'));
});
