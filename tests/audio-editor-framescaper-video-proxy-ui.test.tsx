/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import {
	createFramescaperVideoProxyApplicationMenuItems,
} from '../src/common/editor/ui/framescaper-video-proxy-application-menu.ts';
import {
	createFramescaperVideoProxyDialogModel,
} from '../src/common/editor/ui/framescaper-video-proxy-dialog-model.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../src/framescaper/editor-video-proxy-action-runtime.ts';

test('the baseline retains proxy projects in one existing menu with product isolation', () => {
	let opens = 0;
	const items = createFramescaperVideoProxyApplicationMenuItems({
		productId: 'framescaper', project: project(),
		copy: {}, open: () => { opens += 1; },
	});
	assert.equal(items.length, 1);
	assert.equal(items[0]?.id, 'video-proxy-manager');
	assert.equal(items[0]?.disabled, false);
	items[0]?.onClick();
	assert.equal(opens, 1);
	assert.deepEqual(createFramescaperVideoProxyApplicationMenuItems({
		productId: 'soundscaper', project: project(), copy: {}, open: () => undefined,
	}), []);
});

test('proxy dialog model targets the selected source and reports offline attached state', () => {
	const value = project();
	(value.sources[0] as Record<string, unknown>).proxyAttachment = { originalAuthorityKind: 'linked' };
	const model = createFramescaperVideoProxyDialogModel({
		project: value, selectedClipId: 'video-clip', missingSourceIds: ['video-source'],
		editingBlocked: false, readOnly: false,
	});
	assert.equal(model.supported, true);
	assert.equal(model.selectedSourceId, 'video-source');
	assert.deepEqual(model.sources, [{
		id: 'video-source', name: 'Camera', attachmentPresent: true,
		originalAuthorityKind: 'linked', originalAvailable: false,
		projectBinClipId: 'bin-video',
	}]);
	assert.equal(model.mutationsDisabled, false);
});

test('the selected proxy dialog exposes pathless attach-existing from its lazy menu surface', () => {
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: async () => undefined,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const markup = renderToStaticMarkup(<FramescaperVideoProxyDialog
		controller={controller}
		snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
		editingBlocked={false}
		copy={{}}
		fileService={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /data-video-proxy-attach-existing="true"/u);
	assert.match(markup, /data-video-proxy-existing-file="true"/u);
	assert.match(markup, /type="file"/u);
	assert.match(markup, /accept="video\/\*"/u);
	assert.match(markup, /data-video-proxy-selection-policy="strict"/u);
	assert.match(markup, /Proxy.*refuses.*Auto.*fall back/iu);
	assert.doesNotMatch(markup, /path=/iu);
});

test('proxy status never promotes an attachment pointer to verified trust', () => {
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'proxy', previewTrust: () => 'unavailable',
		setMode: async () => undefined, pressure: () => null,
		reportPreviewPressure: async () => undefined, generate: async () => undefined,
		attachExisting: async () => undefined, detach: async () => undefined,
		regenerate: async () => undefined, relinkOriginal: async () => 'relinked',
	}));
	const value = project();
	(value.sources[0] as Record<string, unknown>).proxyAttachment = { originalAuthorityKind: 'owned' };
	const markup = renderToStaticMarkup(<FramescaperVideoProxyDialog
		controller={controller}
		snapshot={{ project: value, selectedClipId: 'video-clip', missingSourceIds: [] }}
		editingBlocked={false} copy={{}} fileService={{}}
		run={(operation) => operation()} onClose={() => undefined}
	/>);
	assert.match(markup, /failed verification|missing/iu);
	assert.match(markup, /Proxy mode refuses/iu);
	assert.doesNotMatch(markup, /verified proxy is attached/iu);
});

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Camera', proxyAttachment: null,
		}],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source' }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}
