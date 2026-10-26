/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectRecoveryDialog from '../src/common/editor/ui/dialogs/ProjectRecoveryDialog.tsx';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../src/common/i18n/editor-project-recovery-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const outcome of ['success', 'failure'] as const) {
	test(`dismissed Recovery ${outcome} leaves the reopened instance and its reviewed candidate intact`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let resolve!: () => void, reject!: (error: Error) => void;
		const pending = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
		const inspection = { projectId: 'original', title: 'Original', candidates: [{
			key: 'current', kind: 'current' as const, revision: 1, status: 'usable' as const, changes: [], error: null,
		}] };
		let closes = 0, recoveries = 0;
		const actions = {
			list: async () => [{ id: 'original', title: 'Original', revision: 1 }],
			inspect: async () => inspection,
			recover: async () => { recoveries += 1; await pending; },
		};
		function Surface() {
			const [open, setOpen] = useState(true);
			return <><button onClick={() => setOpen(true)}>Reopen Recovery</button>{open && <ProjectRecoveryDialog
				actions={actions} copy={{ ...PROJECT_RECOVERY_COPY_BY_LOCALE.en, close: 'Close' }}
				run={operation => operation()} onClose={() => { closes += 1; setOpen(false); }}
			/>}</>;
		}
		try {
			await act(async () => root.render(<Surface />));
			const create = dom.container.querySelectorAll('button').find(button => button.textContent === PROJECT_RECOVERY_COPY_BY_LOCALE.en.projectRecoveryCreate);
			assert.ok(create); assert.equal(reactProps(create).disabled, false);
			await act(async () => { reactProps(create).onClick(); await Promise.resolve(); });
			const close = dom.container.querySelectorAll('button').find(button => button.getAttribute('aria-label') === 'Close');
			assert.ok(close);
			await act(async () => { reactProps(close).onClick(); });
			assert.equal(dom.find('[data-project-recovery-dialog="true"]'), null);
			const reopen = dom.container.querySelectorAll('button').find(button => button.textContent === 'Reopen Recovery');
			assert.ok(reopen);
			await act(async () => { reactProps(reopen).onClick(); });
			assert.ok(dom.find('[data-project-recovery-dialog="true"]'));
			await act(async () => {
				if (outcome === 'success') resolve(); else reject(new Error('Old recovery failed'));
				await pending.catch(() => undefined);
			});
			assert.equal(closes, 1, 'only the explicit dismissal may close the original instance');
			assert.ok(dom.find('[data-project-recovery-dialog="true"]'), 'the new Recovery remains available');
			assert.ok(!dom.container.textContent.includes('Old recovery failed'));
			assert.ok(dom.container.textContent.includes(PROJECT_RECOVERY_COPY_BY_LOCALE.en.projectRecoveryNoChanges));
			assert.equal(recoveries, 1);
		} finally {
			resolve(); await pending.catch(() => undefined);
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
		}
	});
}
