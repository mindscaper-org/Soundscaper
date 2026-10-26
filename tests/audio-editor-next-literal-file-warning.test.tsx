/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createFileSizeWarningConfirmation } from '../src/common/editor/controller/shared/file-size-warning-confirmation.ts';
import { confirmFileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';
import FileSizeWarningDialog from '../src/common/editor/ui/dialogs/FileSizeWarningDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the file warning displays literal filename replacement tokens and template placeholders', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const confirmation = createFileSizeWarningConfirmation();
	const label = "$&-{size}-$`-$'.raw";
	try {
		await act(async () => { root.render(<FileSizeWarningDialog confirmation={confirmation} copy={{ cancel: 'Cancel' }} />); });
		let operation!: Promise<unknown>;
		await act(async () => { operation = confirmFileSizeWarning(2048, 1024, label, { confirmFileSizeWarning: confirmation.confirm })
			.catch((error: unknown) => error); });
		assert.ok(dom.container.textContent.includes(`${label} is 2 KiB, above the recommended 1 KiB.`), 'filenames must be substituted as literal data in a single pass');
		const cancel = dom.container.querySelectorAll('button').find(button => button.textContent === 'Cancel'); assert.ok(cancel);
		await act(async () => { reactProps(cancel).onClick(); });
		const failure = await operation; assert.ok(failure instanceof Error); assert.equal(failure.name, 'AbortError');
	} finally {
		await act(async () => { confirmation.dispose(); root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
