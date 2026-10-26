/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createDeferredAudioAnalysisService } from '../src/common/editor/controller/analysis/internal/deferred-analysis-service.ts';
import type { AnalysisDependencies } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { createDeferredEditorExportService, type DeferredEditorExportModule } from '../src/common/editor/controller/export/deferred-export-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

function fixture() {
	let project = { id: 'outgoing', revision: 0, sampleRate: 48_000, masterChannels: 1,
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: 32 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }], metadata: {} };
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const entries: string[] = [];
	const dependencies: AnalysisDependencies = { lifetime, copy: ENGLISH_COPY, state: { lastAnalysisRequest: null },
		captureProject: () => projectGeneration.capture(project.id), assertProject: token => projectGeneration.assertCurrent(token),
		getProject: () => project, getSelectedTrackId: () => 'track', getRange: () => ({ startFrame: 0, endFrame: 32 }),
		getActiveSelection: () => ({ startFrame: 0, endFrame: 32 }), getSpectrumWindowSize: () => 2048,
		getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections() {},
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		renderAudio: async () => { entries.push(project.id); return { sampleRate: 48_000, numberOfChannels: 1, length: 32,
			getChannelData: () => new Float32Array(32).fill(.1) }; },
		analyzeChannels: async () => ({}), createVisuals: () => ({}), showAnalysis() {}, setProcessing() {},
		setStatus() {}, publish() {}, handleError: error => { throw error; },
	};
	return { dependencies, entries, lifetime, projectGeneration, getProject: () => project,
		activate(id: string) { project = { ...project, id }; projectGeneration.activate(id); },
		edit() { project = { ...project, revision: project.revision + 1 }; } };
}
for (const kind of ['analysis', 'export'] as const) for (const transition of ['switch', 'aba', 'same', 'edit', 'dispose'] as const) {
	test(`cold ${kind} delegate retains invocation activation through ${transition}`, async () => {
		const f = fixture();
		const runtime = { options: {}, sourceBuffers: new Map(), taskProgress: null, lifetime: f.lifetime,
			projectGeneration: f.projectGeneration, getProject: f.getProject,
			state: { disposed: false, exportAbort: null, exportGeneration: 0, exportOutput: null,
				mobile: false, outputCleanup: null, outputUrl: null },
			createCacheAwareRenderEngine: () => ({}), prepareCommittedTimePitchCaches: async () => undefined,
			throwIfAborted() {}, updateExportProgress() {},
		};
		const exporter = createDeferredEditorExportService(runtime, async () => ({
			createEditorExportService: () => ({ handleExportAction: async () => { f.entries.push(f.getProject().id); },
				persistentAudioDeliveryAvailable: () => true, whenPersistentAudioDeliveryAvailable: async () => undefined }),
		} as unknown as DeferredEditorExportModule));
		const analysis = createDeferredAudioAnalysisService(f.dependencies);
		const invoke = () => kind === 'analysis' ? analysis.findClipping() : exporter.handleExportAction('start');
		const pending = invoke();
		if (transition === 'switch' || transition === 'aba') f.activate('incoming');
		if (transition === 'aba') f.activate('outgoing');
		if (transition === 'edit') f.edit();
		if (transition === 'dispose') f.lifetime.beginDisposal();
		const retired = transition === 'switch' || transition === 'aba' || transition === 'dispose';
		if (retired) await assert.rejects(pending, error => error instanceof Error
			&& (error.name === 'AbortError' || error.name === 'EditorDisposedError'));
		else await pending;
		assert.equal(f.entries.length, retired ? 0 : 1);
		if (transition === 'switch' || transition === 'aba') {
			await invoke(); assert.deepEqual(f.entries, [f.getProject().id], 'fresh owned work remains available');
		}
	});
}
