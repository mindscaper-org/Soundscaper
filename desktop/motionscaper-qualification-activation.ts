/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';

export async function withMotionQualificationActivation<Value>(
	page: Pick<Page, 'evaluateHandle' | 'waitForFunction'>,
	publish: () => Promise<Value>,
): Promise<Value> {
	// Subscribe before the publisher can trigger the native watch. Sampling an
	// idle editor after publication can precede the entire asynchronous adoption.
	const observation = await page.evaluateHandle(() => {
		const selector = '[data-audio-editor-bound="true"]';
		const roots = document.querySelectorAll(selector), editor = roots[0];
		if (roots.length !== 1 || !editor) throw new Error('Linked project activation requires one bound editor.');
		const project = editor.getAttribute('data-project-id');
		if (!project) throw new Error('Linked project activation requires an active project.');
		const pending = () => editor.getAttribute('data-project-activation-pending') === 'true';
		let armed = false, started = false, completed = false, error: string | null = null;
		const changed = 'Linked project root or owner changed during saved revision activation.';
		const unchanged = () => {
			const current = document.querySelectorAll(selector);
			if (!editor.isConnected || current.length !== 1 || current[0] !== editor || editor.getAttribute('data-project-id') !== project) {
				error = changed;
			}
		};
		const inspect = (records: MutationRecord[]) => {
			unchanged();
			// A live-state sample must not hide retirement and restoration within
			// one batch. Removed ancestors also retire the observed editor root.
			if (records.some(record => record.type === 'childList'
				? Array.from(record.removedNodes).some(node => node === editor || node.contains(editor))
				: record.target === editor && ((record.attributeName === 'data-project-id' && record.oldValue !== project)
					|| (record.attributeName === 'data-audio-editor-bound' && record.oldValue !== 'true')))) error = changed;
			// oldValue retains a complete true→false cycle even when both changes
			// arrive in one batch and the live attribute is already absent.
			if (armed) {
				if (pending() || records.some(record => record.target === editor && record.attributeName === 'data-project-activation-pending' && record.oldValue === 'true')) started = true;
				if (started && !pending()) completed = true;
			}
		};
		const observer = new MutationObserver(inspect);
		observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
			attributeFilter: ['data-project-activation-pending', 'data-project-id', 'data-audio-editor-bound'] });
		return {
			arm() {
				// Settle the initial linked revision without counting its queued
				// completion as the next publication-induced activation.
				inspect(observer.takeRecords());
				if (error) throw new Error(error);
				if (pending()) return false;
				armed = true; return true;
			},
			check() { unchanged(); if (error) throw new Error(error); return completed && !pending(); },
			disconnect() { observer.disconnect(); },
		};
	});
	let outcome: { ok: true; value: Value } | { ok: false; error: unknown };
	try {
		const settlingStarted = performance.now();
		const remaining = () => {
			const timeout = 10000 - Math.ceil(performance.now() - settlingStarted);
			if (timeout <= 0) throw new Error('Initial linked project activation exhausted the activation wait budget.');
			return timeout;
		};
		if (!await observation.evaluate(state => state.arm())) {
			const settled = await page.waitForFunction(state => state.arm(), observation, { timeout: remaining() });
			await settled.dispose();
		}
		// Initial settling and the next cycle share the existing wait allowance;
		// the publisher retains its own unchanged deadline.
		const timeout = remaining();
		const receipt = await publish();
		const completed = await page.waitForFunction(state => state.check(), observation, { timeout });
		await completed.dispose();
		outcome = { ok: true, value: receipt };
	} catch (error) {
		outcome = { ok: false, error };
	}
	const errors: unknown[] = [];
	try { await observation.evaluate(state => state.disconnect()); } catch (error) { errors.push(error); }
	try { await observation.dispose(); } catch (error) { errors.push(error); }
	if (errors.length) throw new AggregateError(outcome.ok ? errors : [outcome.error, ...errors], 'Linked project activation observation cleanup failed.');
	if (!outcome.ok) throw outcome.error;
	return outcome.value;
}
