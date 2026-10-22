/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { DeliveryQueueDialog } from '../src/common/editor/ui/inspector/DeliveryQueueDialog.jsx';
import { createDeliveryQueueService } from '../src/common/editor/controller/export/internal/delivery/delivery-queue-service.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import type { DeliveryBatch } from '../src/common/editor/delivery-batch.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('queueing another batch during destination preflight keeps separate batch and member identities', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let release!: () => void;
	const preflight = new Promise<void>(resolve => { release = resolve; });
	const captured: DeliveryBatch[] = [];
	const pending: Promise<unknown>[] = [];
	const queue = createDeliveryQueueService({ handleExportAction: () => ({ fileName: 'mix.wav' }) });
	queue.pause();
	const queueActions = { ...queue, enqueueBatch(batch: DeliveryBatch) {
		captured.push(batch);
		const work = preflight.then(() => queue.enqueueBatch(batch));
		pending.push(work);
		return work;
	} };
	const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'wav', label: 'WAV', kind: 'audio', format: 'wav', settings: {} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<DeliveryQueueDialog isOpen
			controller={{ actions: { export: { queue: queueActions, presets: { list: () => [preset] } } } }}
			snapshot={{ selection: null, project: { loop: { enabled: false } } }}
			copy={ENGLISH_COPY} onClose={() => undefined} />));
		const checkbox = dom.one('[data-delivery-batch-preset="wav"]').querySelector('[role="checkbox"]');
		assert.ok(checkbox);
		await act(async () => { reactProps(checkbox).onClick(); });
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.deliveryBatchQueue);
		assert.ok(button);
		assert.equal(button.hasAttribute('disabled'), false);
		await act(async () => {
			reactProps(button).onClick();
			reactProps(button).onClick();
		});
		assert.equal(captured.length, 2);
		assert.notEqual(captured[0]!.batchId, captured[1]!.batchId);
		assert.notEqual(captured[0]!.members[0]!.memberId, captured[1]!.members[0]!.memberId);
		await act(async () => { release(); await Promise.all(pending); });
		assert.equal(queue.list().entries.length, 2);
	} finally {
		await act(async () => { release(); await Promise.allSettled(pending); await Promise.resolve(); root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
