/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';

/** Expose the pinned upstream single-file module without eval, blobs or a global script loader. */
export function fluidSynthModulePlugin() {
	return { name: 'soundscaper-fluid-synth-module', enforce: 'pre',
		async load(id) {
			if (!id.replaceAll('\\', '/').endsWith('/js-synthesizer/externals/libfluidsynth-2.4.6.js')) return null;
			const upstream = await readFile(id, 'utf8');
			const embedded = upstream.match(/"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/u);
			if (!embedded) throw new Error('The pinned FluidSynth runtime has no embedded WASM payload.');
			const reference = this.emitFile({ type: 'asset', name: 'libfluidsynth-2.4.6.wasm', source: Buffer.from(embedded[1], 'base64') });
			const module = upstream.replace(embedded[0], `import.meta.ROLLUP_FILE_URL_${reference}`);
			return `${module}\nexport default Module;\n`;
		},
	};
}
