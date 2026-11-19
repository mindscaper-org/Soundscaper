/* SPDX-License-Identifier: AGPL-3.0-only */
import { createEarGainCalculator } from './gain-calculator.ts';
import { renderEarProgramme } from './render.ts';
import type { EarDeliveryPlan } from '../ear-delivery.ts';

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<{
		plan: EarDeliveryPlan; channels: readonly Float32Array[];
	}>) => void): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;
scope.addEventListener('message', ({ data }) => { void execute(data).catch((error: unknown) => {
	scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
}); });

async function execute(data: Readonly<{ plan: EarDeliveryPlan; channels: readonly Float32Array[] }>): Promise<void> {
	const response = await fetch(new URL('./ear.wasm', import.meta.url));
	if (!response.ok) throw new Error(`The EBU EAR renderer could not be loaded (${response.status}).`);
	const calculator = await createEarGainCalculator(new Uint8Array(await response.arrayBuffer()), data.plan.layout);
	try {
		const channels = renderEarProgramme(data.plan.metadata, data.channels, calculator);
		scope.postMessage({ channels }, channels.map((channel) => channel.buffer));
	} finally { calculator.close(); }
}
