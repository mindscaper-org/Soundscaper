/* SPDX-License-Identifier: AGPL-3.0-only */
import { NATIVE_PLUGIN_CONTROL } from './native-plugin-realtime-contract.ts';

type Answer = Record<string, unknown>;
type Request = (kind: string, fields?: Record<string, unknown>) => Promise<Answer>;
const claimed = new WeakSet<MessagePort>();
const waiting = new Map<string, (port: MessagePort) => void>();
const controls = new Map<string, Request>();

export function acceptNativeMidiPort(offer: unknown, ports: readonly MessagePort[]): boolean {
	if (ports[0] && claimed.has(ports[0])) return true;
	const value = offer as { instanceId?: string; portContractVersion?: number; purpose?: string } | null;
	const accept = value?.instanceId ? waiting.get(value.instanceId) : undefined;
	if (!accept || value?.portContractVersion !== 1 || value.purpose !== 'plugin-rpc' || ports.length !== 1) return false;
	claimed.add(ports[0]!);
	accept(ports[0]!);
	return true;
}

export function expectNativeMidiPort(id: string) {
	let timer: ReturnType<typeof setTimeout>;
	let rejectWait: (error: Error) => void = () => undefined;
	const promise = new Promise<MessagePort>((resolve, reject) => {
		rejectWait = reject;
		timer = setTimeout(() => { waiting.delete(id); reject(new Error('Native instrument port timed out.')); }, 10_000);
		waiting.set(id, port => { clearTimeout(timer); waiting.delete(id); resolve(port); });
	});
	void promise.catch(() => undefined);
	return { promise, cancel: () => { clearTimeout(timer); waiting.delete(id); rejectWait(new Error('Native instrument opening cancelled.')); } };
}

export function nativeMidiControl(id: string, type: string, bytes?: Uint8Array, fields: Record<string, unknown> = {}): Promise<Answer> | null {
	const request = controls.get(id);
	if (!request) return null;
	const kinds: Record<string, string> = {
		[NATIVE_PLUGIN_CONTROL.saveState]: 'save-state', [NATIVE_PLUGIN_CONTROL.loadState]: 'load-state',
		[NATIVE_PLUGIN_CONTROL.capabilities]: 'capabilities', [NATIVE_PLUGIN_CONTROL.describeParameters]: 'parameters',
		[NATIVE_PLUGIN_CONTROL.readParameter]: 'parameter-get', [NATIVE_PLUGIN_CONTROL.writeParameter]: 'parameter-set',
		[NATIVE_PLUGIN_CONTROL.openVendorUi]: 'open-vendor-ui', [NATIVE_PLUGIN_CONTROL.closeVendorUi]: 'close-vendor-ui',
	};
	const kind = kinds[type];
	return kind ? request(kind, { ...fields, ...(bytes ? { bytes } : {}) }) : Promise.reject(new Error('Unsupported native instrument control.'));
}

/** One admitted port owns its request queue and all timeout/close cleanup. */
export function createNativeMidiRpc(id: string, port: MessagePort) {
	let sequence = 0, closed = false;
	const pending = new Map<string, { resolve(value: Answer): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
	const fail = (error: Error) => {
		for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
		pending.clear();
	};
	port.onmessage = event => {
		const answer = event.data as Answer;
		if (!answer || answer.protocolVersion !== 1) { fail(new Error('Invalid native instrument reply.')); return; }
		if (answer.kind === 'fault') { fail(new Error(String(answer.detail ?? answer.code))); return; }
		const item = pending.get(String(answer.requestId));
		if (!item) return;
		pending.delete(String(answer.requestId)); clearTimeout(item.timer); item.resolve(answer);
	};
	port.start();
	const request: Request = (kind, fields = {}) => new Promise((resolve, reject) => {
		if (closed) { reject(new Error('Native instrument session is closed.')); return; }
		const requestId = `m${++sequence}`;
		const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Native instrument request timed out.')); }, 10_000);
		pending.set(requestId, { resolve, reject, timer });
		try { port.postMessage({ ...fields, protocolVersion: 1, kind, requestId }); }
		catch (error) { pending.delete(requestId); clearTimeout(timer); reject(error as Error); }
	});
	controls.set(id, request);
	return { request, close() {
		if (closed) return;
		closed = true; controls.delete(id); port.close(); fail(new Error('Native instrument session closed.'));
	} };
}
