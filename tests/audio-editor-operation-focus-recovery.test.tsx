/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useOperationFocusRecovery } from '../src/common/editor/ui/useOperationFocusRecovery.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function Probe({ pending, owner, fallback = false }: Readonly<{ pending: boolean; owner: string; fallback?: boolean }>) {
	const capture = useOperationFocusRecovery(pending, owner);
	const input = React.useRef<HTMLInputElement>(null);
	return <><button onClick={() => capture(fallback ? () => input.current : undefined)}>Move marker</button><input ref={input} /></>;
}

test('operation focus recovery retains its owner and never steals a newly chosen focus target', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (pending: boolean, owner = 'clip-a') => {
		await act(async () => root.render(<Probe pending={pending} owner={owner} />));
	};
	try {
		await render(false);
		const button = dom.one('button');
		const other = dom.one('input');
		button.focus();
		reactProps(button).onClick();
		await render(true);
		document.body.focus();
		await render(false);
		assert.equal(document.activeElement, button);
		button.focus();
		reactProps(button).onClick();
		await render(true);
		other.focus();
		await render(false);
		assert.equal(document.activeElement, other);
		button.focus();
		reactProps(button).onClick();
		await render(true);
		document.body.focus();
		await render(false, 'clip-b');
		assert.equal(document.activeElement, document.body);
		await act(async () => root.render(<Probe pending={false} owner="clip-b" fallback />));
		button.focus();
		reactProps(button).onClick();
		await act(async () => root.render(<Probe pending owner="clip-b" fallback />));
		// WebKit can retain the disabled submitter as the active element.
		button.setAttribute('disabled', '');
		assert.equal(document.activeElement, button);
		await act(async () => root.render(<Probe pending={false} owner="clip-b" fallback />));
		assert.equal(document.activeElement, other, 'a disabled active submitter must yield to its editable fallback');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
