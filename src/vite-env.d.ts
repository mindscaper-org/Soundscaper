/// <reference types="vite/client" />

declare module '*?raw' {
	const source: string;
	export default source;
}

declare module 'js-synthesizer/externals/libfluidsynth-2.4.6.js' {
	const runtime: unknown;
	export default runtime;
}

declare const __SCAPE_PRODUCT__: 'soundscaper' | 'framescaper' | 'lightscaper';
declare const __SCAPE_VERSION__: string;
declare const __SCAPE_DESKTOP_RENDERER__: boolean;
