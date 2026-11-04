/* SPDX-License-Identifier: AGPL-3.0-only */

#include "plugin_stable_identity.h"
#include <cstdio>

#define REQUIRE(expression) do { if (!(expression)) { std::fprintf(stderr, "Plug-in identity check failed at line %d: %s\n", __LINE__, #expression); return 1; } } while (false)

int main()
{
	using soundscaper::stableJucePluginId;
	const auto original = stableJucePluginId("vst2", 0x6779416a, "GGain", "original.dll");
	const auto snapshot = stableJucePluginId("vst2", 0x6779416a, "GGain", "snapshot.dll");
	REQUIRE(original == snapshot);
	REQUIRE(original == "vst2:6779416a");
	REQUIRE(stableJucePluginId("vst2", -1, "", "") == "vst2:ffffffff");
	REQUIRE(stableJucePluginId("vst2", 0, "", "") == "vst2:00000000");
	REQUIRE(stableJucePluginId("vst2", 1, "same-shell", "") != stableJucePluginId("vst2", 2, "same-shell", ""));
	for (const auto *format : {"vst3", "ladspa"}) {
		REQUIRE(stableJucePluginId(format, 1234, "Effect", "original") == stableJucePluginId(format, 1234, "Effect", "snapshot"));
		REQUIRE(stableJucePluginId(format, 1234, "Effect", "") != stableJucePluginId(format, 5678, "Effect", ""));
	}
	REQUIRE(stableJucePluginId("vst3", 1, "First", "") != stableJucePluginId("vst3", 1, "Second", ""));
	REQUIRE(stableJucePluginId("au", 1, "Effect", "AudioUnit:aufx,abcd,vndr") == "au:AudioUnit:aufx,abcd,vndr");
	REQUIRE(stableJucePluginId("lv2", 1, "Effect", "https://example.org/first") == "lv2:https://example.org/first");
	REQUIRE(stableJucePluginId("lv2", 1, "Effect", "urn:second") != stableJucePluginId("lv2", 1, "Effect", "urn:first"));
	REQUIRE(stableJucePluginId("au", 1, "Effect", "").empty());
	REQUIRE(stableJucePluginId("lv2", 1, "Effect", "").empty());
	REQUIRE(stableJucePluginId("unknown", 1, "Effect", "").empty());
	return 0;
}
