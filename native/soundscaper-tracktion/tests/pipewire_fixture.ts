/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function removePipeWireFixtureSource(name: 'tracktion.test.microphone' | 'tracktion.test.recovery-microphone' = 'tracktion.test.microphone'): void {
	const graph = JSON.parse(execFileSync('pw-dump', { encoding: 'utf8' })) as readonly {
		id: number;
		type: string;
		info?: { props?: Record<string, unknown> };
	}[];
	const virtualSource = graph.find(({ type, info }) => type === 'PipeWire:Interface:Node'
		&& info?.props?.['node.name'] === name);
	assert.ok(virtualSource && Number.isSafeInteger(virtualSource.id), 'the private PipeWire fixture has its virtual source');
	execFileSync('pw-cli', ['destroy', String(virtualSource.id)]);
}
