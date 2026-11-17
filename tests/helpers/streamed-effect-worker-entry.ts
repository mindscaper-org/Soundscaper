/* SPDX-License-Identifier: AGPL-3.0-only */
// The production DSP graph includes legacy TypeScript parameter properties.
import { register } from 'tsx/esm/api';
Object.setPrototypeOf(self, globalThis);
register();
await import('../../src/common/editor/streamed-effects/worker-entry.ts');
