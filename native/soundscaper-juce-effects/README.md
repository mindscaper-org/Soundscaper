# Bundled JUCE effects

The professional native host includes this CMake subdirectory using its existing
authenticated JUCE and CLAP sources. It installs one flat CLAP library under
`runtime/effects/` on every maintained target. Build-result assembly treats it as
a required member of the closed native runtime; it is never downloaded separately
or copied into a system plug-in directory.

`Processor` owns preparation, smoothing, IR replacement, and state.
`standard_processors.cpp` and `filter_processors.cpp` wrap JUCE's effect processors;
`clap_plugin.cpp` adapts them to the existing native host. **Effect → JUCE** selects
the requested effect in Plugin Manager, preserving scanning consent and installation
allowance. Each insertion has separate controls and keeps earlier rack instances alive.
The native editor is opened from Plugin Manager's vendor-interface action.

The shared `src/common/editor/juce-effects/catalog.json` defines stable identities,
parameter order, ranges, defaults and choices. CMake generates native metadata from
it. Codes 1 and 2 and their parameter layouts retain compatibility with existing
Gain and Convolution Reverb states. Add new kinds without renumbering existing ones.
The catalogue includes gain, convolution and algorithmic reverbs, chorus, phaser,
compressor, noise gate, limiter, ladder filter, feedback delay, tanh waveshaper,
panner, bias, IIR, FIR, state-variable, first-order and Linkwitz-Riley filters.
The FIR is a 65-tap Hamming-windowed low-pass with 32 samples of reported latency;
IIR and state-variable filters provide low/high/band-pass modes, and first-order
and Linkwitz-Riley filters provide low/high/all-pass modes. Coefficient storage
and delay buffers are allocated during preparation; automation updates existing storage.
GCC builds disable GNU unique exports on the CLAP library and its core so the
last entry reference can unload the library, including its GUI dispatcher. A
later load can therefore open another editor in the same host process.

SJE1 state stores the effect kind, normalized parameters, IR sample rate, channel
and frame counts, a UTF-8 display name, and planar little-endian float samples.
It contains no filesystem path. Invalid or foreign state leaves the current
processor unchanged. The state and decoded IR limits fit within the existing
native opaque-state envelope.

Focused CTest targets are `soundscaper_juce_effect_catalog_test`, `soundscaper_juce_effect_processor_test`,
`soundscaper_juce_effect_clap_test`, and `soundscaper_juce_effect_host_test`.
The host test requires the professional host build; adding a third argument runs
its native-editor open/close/reopen check on a machine with a display.
The standalone CMake project accepts `SOUNDSCAPER_JUCE_ROOT` and
`SOUNDSCAPER_CLAP_ROOT` for focused development against the same pinned sources.

See [native services](../../docs/architecture/native-services.md#bundled-juce-effects)
for the admission and initial capability boundary.
