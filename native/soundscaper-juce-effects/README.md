# Bundled JUCE effects

The professional native host includes this CMake subdirectory using its existing
authenticated JUCE and CLAP sources. It installs one flat CLAP library under
`runtime/effects/` on every maintained target. Build-result assembly treats it as
a required member of the closed native runtime; it is never downloaded separately
or copied into a system plug-in directory.

`Processor` owns preparation, gain, convolution, smoothing, IR replacement, and
state. `clap_plugin.cpp` adapts it to the existing native host. Further processors
can reuse that boundary without introducing another transport or editor panel.
The native editor is opened from Plugin Manager's existing vendor-interface action.

SJE1 state stores the effect kind, normalized parameters, IR sample rate, channel
and frame counts, a UTF-8 display name, and planar little-endian float samples.
It contains no filesystem path. Invalid or foreign state leaves the current
processor unchanged. The state and decoded IR limits fit within the existing
native opaque-state envelope.

Focused CTest targets are `soundscaper_juce_effect_processor_test`,
`soundscaper_juce_effect_clap_test`, and `soundscaper_juce_effect_host_test`.
The host test requires the professional host build; adding a third argument runs
its native-editor open/close/reopen check on a machine with a display.
The standalone CMake project accepts `SOUNDSCAPER_JUCE_ROOT` and
`SOUNDSCAPER_CLAP_ROOT` for focused development against the same pinned sources.

See [native services](../../docs/architecture/native-services.md#bundled-juce-effects)
for the admission and initial capability boundary.
