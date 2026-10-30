/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FreesoundPanel, { type FreesoundPanelState } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { LocalModelManagerDialogView } from '../src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx';
import type { LocalModelManagerSnapshot } from '../src/common/editor/ui/local-model-manager-store.ts';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;

test('preview ticks leave every inactive Freesound result untouched', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const reads = Array.from({ length: 20 }, () => 0);
	const results = reads.map((_, i) => ({ soundId: i + 1, get name() { reads[i] = (reads[i] ?? 0) + 1; return `Sound ${i}`; }, username: 'Recorder', soundUrl: `https://freesound.org/s/${i + 1}/`, licenseName: 'CC0', licenseCode: 'cc0' as const, licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', durationSeconds: 10, durationLabel: '0:10' }));
	const state: FreesoundPanelState = { query: 'rain', license: 'all', sort: 'relevance', page: 1, pageCount: 1, totalResults: 20, status: 'ready', previewingSoundId: 1, previewPaused: false, previewPositionSeconds: 0, results };
	const props = { copy: FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en, disabled: false, onSearch: noop, onPreview: noop, onPausePreview: noop, onResumePreview: noop, onSeekPreview: noop, onInsertAtPlayhead: noop, onAddToProjectBin: noop };
	try {
		await act(async () => root.render(<FreesoundPanel {...props} state={state} />));
		const initial = [...reads];
		for (let tick = 1; tick <= 5; tick++) await act(async () => root.render(<FreesoundPanel {...props} state={{ ...state, previewPositionSeconds: tick / 2 }} />));
		assert.deepEqual(reads.slice(1), initial.slice(1));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('one model progress publication leaves every other model row untouched', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const reads = Array.from({ length: 20 }, () => 0);
	const models = reads.map((_, i) => ({ modelId: `model-${i}`, version: '1.0.0', task: 'speech-recognition', availability: 'installable' as const, get downloadBytes() { reads[i] = (reads[i] ?? 0) + 1; return 1024 * 1024; }, installedBytes: null, attributionRequired: false }));
	const snapshot: LocalModelManagerSnapshot = { phase: 'ready', runtimeAvailable: true, runtimeReason: null, models, busyModelIds: ['model-0'], installingModelIds: ['model-0'], cancellingModelIds: [], progress: [], maintenanceOperation: null, lastResult: null, notices: [], noticesLoaded: false, error: null };
	const props = { copy: ENGLISH_COPY, locale: 'en', onClose: noop, onInstall: noop, onInstallPreseeded: noop, onCancelInstall: noop, onRemove: noop, onReconcile: noop, onGarbageCollect: noop, onShowNotices: noop, onRelocate: noop, onRetry: noop };
	try {
		await act(async () => root.render(<LocalModelManagerDialogView {...props} snapshot={snapshot} />));
		const initial = [...reads];
		for (let tick = 1; tick <= 5; tick++) await act(async () => root.render(<LocalModelManagerDialogView {...props} snapshot={{ ...snapshot, progress: [{ modelId: 'model-0', fileName: 'model.onnx', completedBytes: tick, totalBytes: 1024 }] }} />));
		assert.deepEqual(reads.slice(1), initial.slice(1));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
