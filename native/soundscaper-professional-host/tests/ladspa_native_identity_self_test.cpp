/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ladspa_plugin_metadata.h"
#include <chrono>
#include <cstdio>
#include <filesystem>

#define REQUIRE(expression) do { if (!(expression)) { std::fprintf(stderr, "LADSPA identity check failed at line %d: %s\n", __LINE__, #expression); return 1; } } while (false)

int main(int argc, char **argv)
{
	if (argc != 2) return 2;
	int32_t nativeId = 0;
	REQUIRE(soundscaper::readLadspaNativeId(argv[1], 0, nativeId) == SOUNDSCAPER_PRO_OK);
	REQUIRE(nativeId == 424242); // The native UniqueID is not JUCE's descriptor index (0).
	const auto directory = std::filesystem::temp_directory_path() / ("soundscaper-ladspa-id-"
		+ std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
	REQUIRE(std::filesystem::create_directory(directory));
	struct Cleanup {
		std::filesystem::path directory;
		~Cleanup() { std::error_code ignored; std::filesystem::remove_all(directory, ignored); }
	} cleanup{directory};
	const auto snapshot = directory / std::filesystem::path(argv[1]).filename();
	std::filesystem::copy_file(argv[1], snapshot);
	int32_t movedId = 0;
	REQUIRE(soundscaper::readLadspaNativeId(snapshot.string(), 0, movedId) == SOUNDSCAPER_PRO_OK);
	REQUIRE(nativeId == movedId);
	REQUIRE(soundscaper::readLadspaNativeId(snapshot.string(), 1, movedId) == SOUNDSCAPER_PRO_PLUGIN_MALFORMED);
	REQUIRE(soundscaper::readLadspaNativeId((directory / "missing.so").string(), 0, movedId) == SOUNDSCAPER_PRO_PLUGIN_UNREADABLE);
	return 0;
}
