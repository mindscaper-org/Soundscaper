/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { setImmediate as nextTurn } from 'node:timers/promises'
import test from 'node:test'

import type { NativePluginRackEffect } from '../src/common/editor/native-plugin-effect.ts'
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts'
import type { SoundscaperNativePluginBindingCommand } from '../src/soundscaper/editor-project-commands.ts'
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'
import { createSoundscaperNativePluginProjectBinding } from '../src/common/editor/ui/soundscaper-native-plugin-project-binding.ts'
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts'
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js'
import { controllerSession } from './helpers/soundscaper-controller-session.ts'

const NOW = '2026-08-24T00:00:00.000Z'

test('the retired native plug-in controller adapter is absent', async () => {
	await assert.rejects(access(new URL('../src/soundscaper/editor-native-plugin-actions.ts', import.meta.url)), { code: 'ENOENT' })
})

test('native plug-in authoring publishes the rack slot and state in one undoable V29 revision', () => {
	const initial = project()
	const history = createSoundscaperProjectHistory(initial)
	const authored = executeSoundscaperProjectCommand(history, binding('author'), { now: NOW })

	assert.equal(authored.present.revision, initial.revision + 1)
	assert.deepEqual(nativeEffects(authored.present), [effect()])
	assert.deepEqual(authored.present.nativePluginStates, [state()])
	assert.equal(authored.undoStack.length, 1)

	const undone = undoSoundscaperProjectCommand(authored)
	assert.deepEqual(nativeEffects(undone.present), [])
	assert.deepEqual(undone.present.nativePluginStates, [])
	assert.equal(undone.undoStack.length, 0)

	const redone = redoSoundscaperProjectCommand(undone)
	assert.deepEqual(nativeEffects(redone.present), [effect()])
	assert.deepEqual(redone.present.nativePluginStates, [state()])
})

test('the canonical binding commits once and publishes its rack to playback', async context => {
	const engine = { ...createMemoryEngine(), appliedProjects: [] as unknown[] }
	const { controller, store } = await controllerSession(context, {
		engine: engine as unknown as NonNullable<Parameters<typeof controllerSession>[1]>['engine'],
	})
	const initial = project()
	await store.saveProject(initial)
	await controller.actions.project.openById(initial.id)
	await nextTurn()
	engine.appliedProjects.length = 0

	const result = controller.actions.edit.commit(binding('author'))
	assert.ok(validateSoundscaperProject(result))
	assert.equal(result.revision, initial.revision + 1)
	assert.deepEqual(nativeEffects(result), [effect()])
	assert.deepEqual(result.nativePluginStates, [state()])
	await nextTurn()
	assert.equal(engine.appliedProjects.length, 1)
	assert.deepEqual(nativeEffects(engine.appliedProjects[0] as ReturnType<typeof project>), [effect()])
})

test('undoing a hosted plug-in bypass restores the rack and saved state in one step', () => {
	let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project()), binding('author'), { now: NOW })
	const original = history
	const commit = (command: unknown) => {
		history = executeSoundscaperProjectCommand(history, command as AudioEditorCommand, { now: NOW })
		return history.present
	}
	let savedBypasses = 0
	const projectBinding = createSoundscaperNativePluginProjectBinding({
		get project() { return history.present },
		getSnapshot: () => ({ selectedTrackId: 'track-1' }),
		actions: {
			nativePlugins: {
				commitBinding() { return assert.fail('Bypass must not bind another plug-in') },
				upsert() { return assert.fail('Bypass must use its continuity port') },
				setBypassed(instanceId, bypassed) {
					const saved = history.present.nativePluginStates.find(row => row.instanceId === instanceId)
					assert.ok(saved)
					const result = commit({ type: 'native-plugin-state/upsert',
						state: { ...saved, bypassed, continuity: bypassed ? 'bypass' : 'live' } })
					savedBypasses++
					return result
				},
			},
			effects: {
				update(_scope, trackId, effectId, changes) {
					return commit({ type: 'effect/update', scope: 'track', trackId, effectId, changes })
				},
			},
		},
	})
	// This is the sequence used by the renderer after its control reply. The
	// persisted state update must join the corresponding rack bypass.
	commit({ type: 'effect/update', scope: 'track', trackId: 'track-1',
		effectId: 'native-effect-1', changes: { bypassed: true } })
	projectBinding.setBypassed('native-instance-1', true)
	assert.equal(savedBypasses, 1)
	assert.equal(history.present.nativePluginStates[0]?.bypassed, true)
	assert.equal(history.present.nativePluginStates[0]?.continuity, 'bypass')
	assert.equal(history.undoStack.length, original.undoStack.length + 1)
	const undone = undoSoundscaperProjectCommand(history)
	assert.deepEqual(nativeEffects(undone.present), [effect()])
	assert.deepEqual(undone.present.nativePluginStates, [state()])
})

test('saving unchanged opaque plug-in state leaves a multi-effect project clean', () => {
	let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project()), binding('author'), { now: NOW })
	history = executeSoundscaperProjectCommand(history, binding('author', {
		effect: effect({ id: 'native-effect-2', params: { instanceId: 'native-instance-2', latencyFrames: 128 } }),
		state: state({ instanceId: 'native-instance-2' }),
	}), { now: NOW })
	const saved = executeSoundscaperProjectCommand(history, { type: 'native-plugin-state/upsert', state: state() }, { now: NOW })
	assert.equal(saved, history)
})

test('a late native state failure cannot publish the otherwise valid rack mutation', () => {
	const history = createSoundscaperProjectHistory(project())
	const invalid = binding('author', {
		state: state({ stateBody: {
			...state().stateBody,
			bodyId: `native-plugin-state:${'d'.repeat(64)}`,
		} }),
	})

	assert.throws(
		() => executeSoundscaperProjectCommand(history, invalid),
		/derived from its SHA-256/iu,
	)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
	assert.equal(history.undoStack.length, 0)
})

test('a generic rack command cannot bypass the atomic native plug-in binding', () => {
	const initial = project()
	const history = createSoundscaperProjectHistory(initial)

	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'effect/add', scope: 'track', trackId: 'track-1', effect: effect(),
	} as never), /native plug-in.*binding|atomic native/iu)
	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'track/add',
		track: {
			...structuredClone(initial.tracks[0]),
			id: 'track-2', name: 'Track 2', effects: [effect({ id: 'native-effect-2' })],
		},
	} as never), /native plug-in.*binding|atomic native/iu)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
	assert.equal(history.undoStack.length, 0)
})

test('native plug-in restore updates the exact rack slot and state in one reversible revision', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const restoredEffect = effect({ bypassed: true, params: {
		instanceId: 'native-instance-1', latencyFrames: 256,
	} })
	const restoredState = state({
		stateBody: body('e'), bypassed: true, continuity: 'bypass', latencySamples: 256,
	})
	const restored = executeSoundscaperProjectCommand(authored, binding('restore', {
		effect: restoredEffect, state: restoredState,
	}), { now: '2026-08-24T00:00:01.000Z' })

	assert.equal(restored.present.revision, authored.present.revision + 1)
	assert.deepEqual(nativeEffects(restored.present), [restoredEffect])
	assert.deepEqual(restored.present.nativePluginStates, [restoredState])
	assert.equal(restored.undoStack.length, authored.undoStack.length + 1)

	const undone = undoSoundscaperProjectCommand(restored)
	assert.deepEqual(nativeEffects(undone.present), [effect()])
	assert.deepEqual(undone.present.nativePluginStates, [state()])
})

test('a failed restore leaves both the prior rack projection and prior state untouched', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const before = JSON.stringify(authored)
	assert.throws(() => executeSoundscaperProjectCommand(authored, binding('restore', {
		effect: effect({ params: { instanceId: 'native-instance-1', latencyFrames: 256 } }),
		state: state({ latencySamples: 128 }),
	})), /runtime projection/iu)
	assert.equal(JSON.stringify(authored), before)
	assert.deepEqual(nativeEffects(authored.present), [effect()])
	assert.deepEqual(authored.present.nativePluginStates, [state()])
})

test('a state-only restore still owns one revision while an exact restore remains a no-op', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const restoredState = state({ stateBody: body('f') })
	const restored = executeSoundscaperProjectCommand(authored, binding('restore', {
		state: restoredState,
	}), { now: '2026-08-24T00:00:01.000Z' })
	assert.equal(restored.present.revision, authored.present.revision + 1)
	assert.deepEqual(nativeEffects(restored.present), [effect()])
	assert.deepEqual(restored.present.nativePluginStates, [restoredState])

	const noOp = executeSoundscaperProjectCommand(restored, binding('restore', {
		state: restoredState,
	}))
	assert.equal(noOp, restored)
})

test('removing native plug-in state retires its product-owned requirement', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const removed = executeSoundscaperProjectCommand(authored, {
		type: 'native-plugin-state/remove', instanceId: 'native-instance-1',
	} as never, { now: '2026-08-24T00:00:01.000Z' })

	assert.deepEqual(removed.present.nativePluginStates, [])
	assert.equal(removed.present.featureRequirements.requirements.some(({ id, featureId }) => (
		id.startsWith('soundscaper.native-plugin.')
		|| featureId.startsWith('org.soundscaper.native-plugin.')
	)), false)
})

test('generic rack removal atomically retires its native state and requirement', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const removed = executeSoundscaperProjectCommand(authored, {
		type: 'effect/remove', scope: 'track', trackId: 'track-1', effectId: 'native-effect-1',
	} as never, { now: '2026-08-24T00:00:01.000Z' })

	assert.deepEqual(nativeEffects(removed.present), [])
	assert.deepEqual(removed.present.nativePluginStates, [])
	assert.equal(removed.present.featureRequirements.requirements.some(({ id, featureId }) => (
		id.startsWith('soundscaper.native-plugin.')
		|| featureId.startsWith('org.soundscaper.native-plugin.')
	)), false)
	assert.equal(removed.present.revision, authored.present.revision + 1)

	const undone = undoSoundscaperProjectCommand(removed)
	assert.deepEqual(nativeEffects(undone.present), [effect()])
	assert.deepEqual(undone.present.nativePluginStates, [state()])
})

test('the narrow native binding command does not widen V29 generic mixed batches', () => {
	const history = createSoundscaperProjectHistory(project())
	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'batch',
		commands: [
			{ type: 'effect/add', scope: 'track', trackId: 'track-1', effect: effect() },
			{ type: 'native-plugin-state/upsert', state: state() },
		],
	} as never), /native-plugin-state|unsupported editor command/iu)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
})

function project() {
	return createSoundscaperProject({
		id: 'native-binding-v29', title: 'Atomic native binding', now: NOW,
		tracks: [{ type: 'audio', id: 'track-1', name: 'Track' }],
	} as never)
}

function binding(
	operation: SoundscaperNativePluginBindingCommand['operation'],
	overrides: Readonly<Record<string, unknown>> = {},
): SoundscaperNativePluginBindingCommand {
	return {
		type: 'native-plugin/bind', operation, trackId: 'track-1',
		effect: effect(), state: state(), ...overrides,
	} as SoundscaperNativePluginBindingCommand
}

function effect(overrides: Readonly<Record<string, unknown>> = {}): NativePluginRackEffect {
	return {
		id: 'native-effect-1', type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId: 'native-instance-1', latencyFrames: 128 },
		context: {
			format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'b'.repeat(64),
		},
		...overrides,
	} as NativePluginRackEffect
}

function state(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		instanceId: 'native-instance-1', format: 'clap', stablePluginId: 'org.example.effect',
		binarySha256: 'b'.repeat(64), stateBody: body('c'), enabled: true, bypassed: false,
		continuity: 'live', latencySamples: 128, ...overrides,
	}
}

function body(digit: string) {
	const sha256 = digit.repeat(64)
	return {
		kind: 'native-plugin-state' as const,
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: 1,
		sha256,
	}
}

function nativeEffects(projectValue: ReturnType<typeof project>): readonly unknown[] {
	return projectValue.tracks[0]?.type === 'audio' ? projectValue.tracks[0].effects : []
}
