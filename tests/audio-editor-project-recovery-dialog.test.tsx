/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectRecoveryDialog from '../src/common/editor/ui/dialogs/ProjectRecoveryDialog.tsx';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../src/common/i18n/editor-project-recovery-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('project recovery previews repairs and admits a single recovery of the inspected candidate', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let resolve!: () => void;
	const pending = new Promise<void>((done) => { resolve = done; });
	const inspected = { projectId: 'broken', title: 'Voice', candidates: [{
		key: 'current', kind: 'current' as const, revision: 3, status: 'repairable' as const,
		changes: [{ path: 'clips[1]', reason: 'Audio source is missing' }], error: null,
	}] };
	let recoveries = 0;
	let closes = 0;
	try {
		await act(async () => root.render(<ProjectRecoveryDialog
			initialProjectId="broken" copy={{ ...PROJECT_RECOVERY_COPY_BY_LOCALE.en, close: 'Close' }}
			actions={{
				list: async () => [{ id: 'broken', title: 'Voice', revision: 3 }],
				inspect: async () => inspected,
				recover: async (inspection, index) => {
					assert.equal(inspection, inspected);
					assert.equal(index, 0);
					recoveries += 1;
					await pending;
				},
			}}
			run={(operation) => operation()} onClose={() => { closes += 1; }}
		/>));
		assert.match(dom.container.textContent, /Audio source is missing/u);
		const button = dom.container.querySelectorAll('button').find((item) => item.textContent === PROJECT_RECOVERY_COPY_BY_LOCALE.en.projectRecoveryCreate);
		assert.ok(button);
		await act(async () => {
			reactProps(button).onClick();
			reactProps(button).onClick();
			await Promise.resolve();
		});
		assert.equal(recoveries, 1);
		assert.equal(closes, 0);
		await act(async () => { resolve(); await pending; });
		assert.equal(closes, 1);
	} finally {
		resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
