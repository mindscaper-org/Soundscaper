/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperNativeProjectActionPanel from '../src/common/editor/ui/dialogs/FramescaperNativeProjectActionPanel.tsx';
import { FRAMESCAPER_NATIVE_SERVICES_COPY as copy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { createFramescaperNativeImageSequenceActionRuntimeNativeMedia } from '../src/framescaper/editor-native-image-sequence-action.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('NP027: native picker cancellation is not reported as a completed image import', async () => {
	const unexpected = () => { throw new Error('A cancelled picker must not read, write or publish media'); };
	const projectActions = createFramescaperNativeImageSequenceActionRuntimeNativeMedia({ profile,
		owner: { project: createFramescaperProjectNativeMedia(profile), actions: { edit: { commit: unexpected, undo: unexpected }, project: { save: unexpected } } },
		store: { getMediaAssetMetadata: unexpected, beginMediaAssetWrite: unexpected },
		bridge: { capabilities: async () => createNativeMediaCapabilitySnapshotV1({ masterEnabled:true, entries:[{ domain:'operation', id:'image-sequence-import', buildSupported:true, probeSucceeded:true, selfTestPassed:true, userEnabled:true }] }),
			selectImageSequence: async () => null, readImageSequenceFile: unexpected, releaseImageSequence: unexpected,
			imageSequenceImport: unexpected, writeImageSequenceImportChunk: unexpected, readImageSequenceImportBody: unexpected },
	});
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => root.render(<FramescaperNativeProjectActionPanel copy={copy} surface="image-sequence-import" projectActions={projectActions} title="Image sequence" />));
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0)); });
		assert.equal(dom.one('[role="status"]').textContent, copy.projectActionReady);
		assert.equal(dom.one('[data-framescaper-native-project-action]').hasAttribute('disabled'), false);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
