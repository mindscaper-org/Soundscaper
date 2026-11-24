/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function removePipeWireFixtureSource(name: 'tracktion.test.microphone' | 'tracktion.test.recovery-microphone' = 'tracktion.test.microphone'): void {
	removeFixtureNode(name);
}

const fixtureSink = 'tracktion.test.speakers';

export function removePipeWireFixtureSink(): void {
	removeFixtureNode(fixtureSink);
}

export function restorePipeWireFixtureSink(): void {
	execFileSync('pw-cli', ['create-node', 'adapter', `{
		factory.name = support.null-audio-sink
		node.name = ${fixtureSink}
		media.class = Audio/Sink
		audio.channels = 2
		audio.position = [ FL FR ]
		adapter.auto-port-config = { mode = dsp monitor = true position = preserve }
		object.linger = true
	}`]);
}

function removeFixtureNode(name: string): void {
	const graph = JSON.parse(execFileSync('pw-dump', { encoding: 'utf8' })) as readonly {
		id: number;
		type: string;
		info?: { props?: Record<string, unknown> };
	}[];
	const node = graph.find(({ type, info }) => type === 'PipeWire:Interface:Node'
		&& info?.props?.['node.name'] === name);
	assert.ok(node && Number.isSafeInteger(node.id), `the private PipeWire fixture has ${name}`);
	execFileSync('pw-cli', ['destroy', String(node.id)]);
}
