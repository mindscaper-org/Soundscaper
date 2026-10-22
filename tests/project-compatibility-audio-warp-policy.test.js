/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('audio-warp policy records native Soundscaper and read-only Framescaper truth', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-audio-warp-capability');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');

	const evidence = new Set(rule.evidence);
	for (const path of [
		'src/common/editor/audio-warp-domain.ts',
		'src/common/editor/audio-warp-clip-authority.ts',
		'src/common/editor/audio-warp-runtime.ts',
		'src/common/editor/audio-warp-render-parity.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/common/editor/runtime-clip-projection.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/transient-analysis.ts',
		'src/common/editor/storage/transient-analysis-cache.ts',
		'src/common/editor/controller/analysis/transient-analysis-service.ts',
		'src/common/editor/controller/analysis/transient-analysis-pcm-access.ts',
		'src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-authoring-service.ts',
		'src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-composition.ts',
		'src/common/editor/commands/project-source-bin-runtime.js',
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/common/editor/engine/audio-warp-playback-scheduler.ts',
		'src/common/editor/ui/audio-warp-application-menu.ts',
		'src/common/editor/ui/dialogs/AudioWarpDialog.tsx',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'config/production-capabilities.json',
		'tests/audio-editor-audio-warp-domain.test.ts',
		'tests/audio-editor-audio-warp-authoring.test.ts',
		'tests/audio-editor-audio-warp-runtime.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-audio-warp-pcm-parity.test.ts',
		'tests/audio-editor-audio-warp-engine-status.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-transient-analysis.test.ts',
		'tests/audio-editor-transient-analysis-pcm-access.test.ts',
		'tests/audio-editor-audio-warp-controller-composition.test.ts',
		'tests/audio-editor-audio-warp-ui.test.tsx',
		'tests/audio-editor-scape-audio-warp-roundtrip.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-audio-warp-export-service.test.ts',
		'tests/browser/audio-editor-audio-warp.spec.js',
	]) assert.equal(evidence.has(path), true, path);
});
