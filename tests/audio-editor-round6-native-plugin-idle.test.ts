/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { NATIVE_PLUGIN_CONTROL, NativePluginRealtimeProcessor } from '../src/common/editor/native-plugin-realtime-worklet.js'

interface Packet {
	readonly [field: string]: unknown
	readonly kind?: string
	readonly requestId?: string
	readonly input?: Float32Array[]
	readonly output?: Float32Array[]
}
interface Peer {
	onmessage: ((event: { data: Packet }) => void) | null
	postMessage: (message: Packet) => void
	start: () => void
	close: () => void
}
interface Processor {
	readonly port: {
		postMessage: (message: Packet) => void
		onmessage: (event: { data: Packet; ports: Peer[] }) => void
	}
	process: (input: Float32Array[][], output: Float32Array[][]) => boolean
}
const Processor = NativePluginRealtimeProcessor as unknown as new (options: {
	processorOptions: { instanceId: string; inputChannelCount: number; outputChannelCount: number; strictRender: boolean; sampleRate: number }
}) => Processor

function attached(strictRender = false, render: (block: number, output: Float32Array[], input: Float32Array[]) => void = (_block, output) => { for (const channel of output) channel.fill(.125) }) {
	const processor = new Processor({ processorOptions: {
		instanceId: 'native-idle-1', inputChannelCount: 2, outputChannelCount: 2, strictRender, sampleRate: 1000,
	} })
	const control: Packet[] = []
	const processed: Packet[] = []
	processor.port.postMessage = (message) => { control.push(message) }
	const peer: Peer = {
		onmessage: null, start() {}, close() {},
		postMessage(message) {
			if (message.kind === 'process') {
				processed.push({ ...message, input: message.input?.map((plane) => plane.slice()) })
				render(processed.length - 1, message.output ?? [], message.input ?? [])
				this.onmessage?.({ data: { ...message, kind: 'processed' } })
			} else if (message.kind === 'capabilities') {
				this.onmessage?.({ data: { protocolVersion: 1, requestId: message.requestId,
					kind: 'capabilities', parameterCount: 1, hasVendorUi: false } })
			} else if (message.kind === 'open-vendor-ui' || message.kind === 'close-vendor-ui') {
				this.onmessage?.({ data: { protocolVersion: 1, requestId: message.requestId,
					kind: 'vendor-ui', status: message.kind === 'open-vendor-ui' ? 'opened' : 'closed' } })
			}
		},
	}
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer] })
	return { processor, control, processed }
}

test('idle live native plug-in accepts disconnected Web Audio inputs as declared-width silence', () => {
	const { processor, control, processed } = attached()
	const output = [new Float32Array(128), new Float32Array(128)]
	for (let block = 0; block < 5; block += 1) processor.process([[]], [output])
	assert.equal(control.some(({ type }) => type === NATIVE_PLUGIN_CONTROL.fault), false)
	assert.equal(processed.length, 5)
	assert.equal(processed[0]?.input?.length, 2)
	assert.ok(processed.every(({ input }) => input?.every((plane) => plane.every((sample) => sample === 0))))
	assert.deepEqual(output.map((channel) => channel[0]), [.125, .125], 'native tails continue through idle silence')
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.capabilities, requestId: 'capabilities-1' }, ports: [] })
	assert.ok(control.some(({ type }) => type === NATIVE_PLUGIN_CONTROL.capabilitiesResult))
	processor.process([[new Float32Array(128).fill(.5), new Float32Array(128).fill(.25)]], [output])
	assert.deepEqual(processed.at(-1)?.input?.map((channel) => channel[0]), [.5, .25])
})

test('strict native render still refuses missing input channels instead of publishing silence', () => {
	const { processor, control } = attached(true)
	processor.process([[]], [[new Float32Array(128), new Float32Array(128)]])
	assert.ok(control.some(({ type, reason }) => type === NATIVE_PLUGIN_CONTROL.fault && reason === 'topology-mismatch'))
})

test('live native plug-in still refuses a nonempty topology change', () => {
	const { processor, control } = attached()
	processor.process([[new Float32Array(128)]], [[new Float32Array(128), new Float32Array(128)]])
	assert.ok(control.some(({ type, reason }) => type === NATIVE_PLUGIN_CONTROL.fault && reason === 'topology-mismatch'))
})


test('native silence detection drains sparse tails, sleeps after five quiet seconds, and resumes at the same pipeline latency', () => {
	const { processor, processed, control } = attached(false, (block, output, input) => {
		for (const channel of output) channel.fill(input[1]?.[99] ? .25 : block === 20 || block === 60 ? .5 : 0)
	})
	processor.port.onmessage({ data: { type: 'suspend-idle-effect-processing', enabled: true }, ports: [] })
	const input = [new Float32Array(100), new Float32Array(100)]
	const output = [new Float32Array(100), new Float32Array(100)]
	input[0]![0] = 1
	processor.process([input], [output]); input[0]!.fill(0)
	const echoes: number[] = []
	for (let block = 1; block < 150; block++) {
		processor.process([input], [output])
		if (output[0]![0] > 0) echoes.push(block)
	}
	assert.deepEqual(echoes, [24, 64], 'the silence between feedback repeats is preserved')
	const sleeping = processed.length
	assert.ok(sleeping > 100 && sleeping < 130)
	for (let block = 0; block < 20; block++) processor.process([input], [output])
	assert.equal(processed.length, sleeping)
	input[1]![99] = 1e-12
	processor.process([input], [output])
	assert.equal(processed.length, sleeping + 1, 'any nonzero channel wakes the first input block')
	assert.equal(output[0]![0], 0)
	input[1]!.fill(0)
	for (let block = 1; block <= 4; block++) {
		processor.process([input], [output])
		assert.equal(output[0]![0], block === 4 ? .25 : 0, 'wake preserves the four-block native pipeline')
	}
	assert.equal(control.some(packet => packet.type === NATIVE_PLUGIN_CONTROL.fault), false)
})

test('native auto-idle opt-out and strict rendering keep processing silence', () => {
	for (const strictRender of [false, true]) {
		const { processor, processed } = attached(strictRender, (_block, output) => { for (const channel of output) channel.fill(0) })
		processor.port.onmessage({ data: { type: 'suspend-idle-effect-processing', enabled: strictRender }, ports: [] })
		for (let block = 0; block < 150; block++) processor.process([[new Float32Array(100), new Float32Array(100)]], [[new Float32Array(100), new Float32Array(100)]])
		assert.equal(processed.length, 150)
	}
})

test('native control RPC and a live preference opt-out wake a sleeping plug-in without audio input', () => {
	const { processor, processed } = attached(false, (_block, output) => { for (const channel of output) channel.fill(0) })
	const input = [new Float32Array(100), new Float32Array(100)], output = [new Float32Array(100), new Float32Array(100)]
	processor.port.onmessage({ data: { type: 'suspend-idle-effect-processing', enabled: true }, ports: [] })
	for (let block = 0; block < 100; block++) processor.process([input], [output])
	const sleeping = processed.length
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.capabilities, requestId: 'wake-control' }, ports: [] })
	processor.process([input], [output])
	assert.equal(processed.length, sleeping + 1)
	for (let block = 0; block < 100; block++) processor.process([input], [output])
	const resuspended = processed.length
	processor.port.onmessage({ data: { type: 'suspend-idle-effect-processing', enabled: false }, ports: [] })
	for (let block = 0; block < 100; block++) processor.process([input], [output])
	assert.equal(processed.length, resuspended + 100)
})

test('an open vendor editor keeps native DSP active until it closes', () => {
	const { processor, processed } = attached(false, (_block, output) => { for (const channel of output) channel.fill(0) })
	const input = [new Float32Array(100), new Float32Array(100)], output = [new Float32Array(100), new Float32Array(100)]
	processor.port.onmessage({ data: { type: 'suspend-idle-effect-processing', enabled: true }, ports: [] })
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.openVendorUi, requestId: 'open-editor', windowHandleId: 'editor' }, ports: [] })
	for (let block = 0; block < 150; block++) processor.process([input], [output])
	assert.equal(processed.length, 150)
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.closeVendorUi, requestId: 'close-editor', windowHandleId: 'editor' }, ports: [] })
	for (let block = 0; block < 150; block++) processor.process([input], [output])
	assert.ok(processed.length < 220, 'the closed editor permits suspension after the silence reserve')
})
