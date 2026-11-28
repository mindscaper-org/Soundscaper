// SPDX-License-Identifier: AGPL-3.0-only

namespace juce::universal_midi_packets
{
auto Endpoints::Impl::Native::make (EndpointsListener&) -> std::unique_ptr<Native> { return {}; }
}
