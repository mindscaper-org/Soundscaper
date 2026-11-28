// SPDX-License-Identifier: AGPL-3.0-only

namespace juce
{
Typeface::Ptr Font::Native::getDefaultPlatformTypefaceForFont (const Font&) { return {}; }
auto Typeface::findSystemTypeface() -> Ptr { return {}; }
auto Typeface::createFromFontImpl (const Font&) -> Ptr { return {}; }
ImagePixelData::Ptr NativeImageType::create (Image::PixelFormat format, int width, int height, bool clearImage) const
{
    return SoftwareImageType().create(format, width, height, clearImage);
}
}
