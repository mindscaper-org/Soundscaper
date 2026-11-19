/* SPDX-License-Identifier: AGPL-3.0-only */

interface FakeMessageEvent { readonly data: unknown }

export class FakePort {
	peer: FakePort | null = null
	closed = false
	readonly listeners = new Set<(event: FakeMessageEvent) => void>()
	onmessage: ((event: FakeMessageEvent) => void) | null = null

	postMessage(message: unknown): void {
		const event = Object.freeze({ data: message })
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(event)
			this.peer?.onmessage?.(event)
		})
	}

	on(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.add(listener) }
	off(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.delete(listener) }
	start(): void {}
	close(): void { this.closed = true }
}

export function channel(UtilityPort = FakePort): Readonly<{ port1: FakePort; port2: FakePort }> {
	const port1 = new UtilityPort()
	const port2 = new FakePort()
	port1.peer = port2
	port2.peer = port1
	return Object.freeze({ port1, port2 })
}

export class ElectronMessagePort extends FakePort {
	override postMessage(message: unknown, transfer: readonly unknown[] = []): void {
		if (transfer.length) throw new TypeError('Port at index 0 is not a valid port')
		super.postMessage(structuredClone(message))
	}
}

export function nextMessage(port: FakePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		const listener = (event: FakeMessageEvent) => {
			port.off('message', listener)
			resolve(event.data as Record<string, unknown>)
		}
		port.on('message', listener)
	})
}

export async function boundedMessage(port: FakePort): Promise<Record<string, unknown>> {
	let timer: ReturnType<typeof setTimeout> | null = null
	try {
		return await Promise.race([
			nextMessage(port),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('persistent audio response timed out')), 100)
			}),
		])
	} finally { if (timer !== null) clearTimeout(timer) }
}
