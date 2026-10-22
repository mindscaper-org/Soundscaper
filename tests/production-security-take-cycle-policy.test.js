/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const CONTROL_ID = 'durable-routed-take-cycle-capture-and-recovery';

test('routed take-cycle control retains conditional status and durability, recovery, and resource evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.surfaceDisposition, 'conditional');

	assertEvidence(control, [
		'src/common/editor/take-cycle-capture-domain.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-validation.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-service.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-capture-pcm-evidence.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-live-pass-evidence.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-live-capture-spool.ts',
		'src/common/editor/storage/raw-pcm-spool-repository.ts',
		'src/common/editor/take-cycle-recovery-envelope.ts',
		'src/common/editor/storage/take-cycle-recovery-envelope-repository.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-recording-repository-composition.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-current-project-publication-service.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-open-recovery-authority.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-open-recovery-coordinator.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-production-composition.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-app-composition.ts',
		'src/common/editor/controller/recording/internal/take-cycle/take-cycle-recording-app-session.ts',
		'src/common/editor/controller/recording/recording-action-facade.ts',
		'src/common/editor/controller/document/project-mutation-service.ts',
		'src/common/editor/controller/document/internal/project/project-retention-service.ts',
		'src/common/editor/controller/document/project-lock-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/common/editor/ui/take-cycle-recording-menu.ts',
		'src/common/editor/ui/dialogs/TakeCycleRecoveryDialog.tsx',
		'tests/audio-editor-take-cycle-capture-domain.test.ts',
		'tests/audio-editor-take-cycle-capture-resource-bounds.test.ts',
		'tests/audio-editor-take-cycle-capture-storage.test.ts',
		'tests/audio-editor-take-cycle-routed-capture-service.test.ts',
		'tests/audio-editor-take-cycle-repository-composition.test.ts',
		'tests/audio-editor-take-cycle-current-project-publication.test.ts',
		'tests/audio-editor-take-cycle-current-project-settlement.test.ts',
		'tests/audio-editor-take-cycle-recording-app-session.test.ts',
		'tests/audio-editor-take-cycle-production-recovery-storage.test.ts',
		'tests/audio-editor-take-cycle-open-recovery-coordinator.test.ts',
		'tests/audio-editor-recording-cycle-action-facade.test.ts',
		'tests/audio-editor-project-mutation-service.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-take-cycle-ui.test.tsx',
		'tests/helpers/cycle-produced-take-fixture.ts',
		'tests/audio-editor-cycle-produced-take-fixture.test.ts',
		'tests/audio-editor-scape-take-comp-roundtrip.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
		'tests/browser/audio-editor-take-cycle-recording.spec.js',
	]);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
