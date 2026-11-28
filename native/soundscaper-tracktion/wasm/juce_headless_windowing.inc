// SPDX-License-Identifier: AGPL-3.0-only

namespace juce
{
class MouseCursor::PlatformSpecificHandle
{
public:
    explicit PlatformSpecificHandle (MouseCursor::StandardCursorType) {}
    explicit PlatformSpecificHandle (const detail::CustomMouseCursorInfo&) {}
    static void showInWindow (PlatformSpecificHandle*, ComponentPeer*) {}
};
class Desktop::NativeDarkModeChangeDetectorImpl {};

auto Desktop::createNativeDarkModeChangeDetectorImpl() -> std::unique_ptr<NativeDarkModeChangeDetectorImpl> { return {}; }
double Desktop::getDefaultMasterScale() { return 1.0; }
void Desktop::setScreenSaverEnabled (bool) {}
bool Desktop::isScreenSaverEnabled() { return true; }
bool Desktop::isDarkModeActive() const { return false; }
bool Desktop::canUseSemiTransparentWindows() noexcept { return false; }
void Displays::findDisplays (const Desktop&) { displays.clear(); }
ComponentPeer* Component::createNewPeer (const DesktopWindowOptions&) { std::abort(); }
bool Process::isForegroundProcess() { return true; }
Point<float> MouseInputSource::getCurrentRawMousePosition() { return {}; }
void MouseInputSource::setRawMousePosition (Point<float>) {}
bool WindowUtils::areThereAnyAlwaysOnTopWindows() { return false; }

bool KeyPress::isKeyCurrentlyDown (int) { return false; }
void LookAndFeel::playAlertSound() {}
void SystemClipboard::copyTextToClipboard (const String&) {}
String SystemClipboard::getTextFromClipboard() { return {}; }
const int KeyPress::spaceKey = 32;
const int KeyPress::returnKey = 13;
const int KeyPress::escapeKey = 27;
const int KeyPress::backspaceKey = 8;
const int KeyPress::tabKey = 9;
const int KeyPress::leftKey = 256;
const int KeyPress::rightKey = 257;
const int KeyPress::upKey = 258;
const int KeyPress::downKey = 259;
const int KeyPress::pageUpKey = 260;
const int KeyPress::pageDownKey = 261;
const int KeyPress::endKey = 262;
const int KeyPress::homeKey = 263;
const int KeyPress::deleteKey = 264;
const int KeyPress::insertKey = 265;
const int KeyPress::F1Key = 513;
const int KeyPress::F2Key = 514;
const int KeyPress::F3Key = 515;
const int KeyPress::F4Key = 516;
const int KeyPress::F5Key = 517;
const int KeyPress::F6Key = 518;
const int KeyPress::F7Key = 519;
const int KeyPress::F8Key = 520;
const int KeyPress::F9Key = 521;
const int KeyPress::F10Key = 522;
const int KeyPress::F11Key = 523;
const int KeyPress::F12Key = 524;
const int KeyPress::F13Key = 525;
const int KeyPress::F14Key = 526;
const int KeyPress::F15Key = 527;
const int KeyPress::F16Key = 528;
const int KeyPress::F17Key = 529;
const int KeyPress::F18Key = 530;
const int KeyPress::F19Key = 531;
const int KeyPress::F20Key = 532;
const int KeyPress::F21Key = 533;
const int KeyPress::F22Key = 534;
const int KeyPress::F23Key = 535;
const int KeyPress::F24Key = 536;
const int KeyPress::F25Key = 537;
const int KeyPress::F26Key = 538;
const int KeyPress::F27Key = 539;
const int KeyPress::F28Key = 540;
const int KeyPress::F29Key = 541;
const int KeyPress::F30Key = 542;
const int KeyPress::F31Key = 543;
const int KeyPress::F32Key = 544;
const int KeyPress::F33Key = 545;
const int KeyPress::F34Key = 546;
const int KeyPress::F35Key = 547;
const int KeyPress::numberPad0 = 1024;
const int KeyPress::numberPad1 = 1025;
const int KeyPress::numberPad2 = 1026;
const int KeyPress::numberPad3 = 1027;
const int KeyPress::numberPad4 = 1028;
const int KeyPress::numberPad5 = 1029;
const int KeyPress::numberPad6 = 1030;
const int KeyPress::numberPad7 = 1031;
const int KeyPress::numberPad8 = 1032;
const int KeyPress::numberPad9 = 1033;
const int KeyPress::numberPadAdd = 1040;
const int KeyPress::numberPadSubtract = 1041;
const int KeyPress::numberPadMultiply = 1042;
const int KeyPress::numberPadDivide = 1043;
const int KeyPress::numberPadSeparator = 1044;
const int KeyPress::numberPadDecimalPoint = 1045;
const int KeyPress::numberPadEquals = 1046;
const int KeyPress::numberPadDelete = 1047;
const int KeyPress::playKey = 1048;
const int KeyPress::stopKey = 1049;
const int KeyPress::fastForwardKey = 1050;
const int KeyPress::rewindKey = 1051;
}
namespace juce::detail
{
std::unique_ptr<ScopedMessageBoxInterface> ScopedMessageBoxInterface::create (const MessageBoxOptions&)
{
    struct Unavailable final : ScopedMessageBoxInterface
    {
        void runAsync (std::function<void (std::optional<int>)> complete) override { complete(std::nullopt); }
        std::optional<int> runSync() override { return std::nullopt; }
        void close() override {}
    };
    return std::make_unique<Unavailable>();
}
}
