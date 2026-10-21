/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
// Used only inside the fixed Photo M5 launcher after its exact-handle helpers.
// Keep every local path ancestor non-replaceable across CreateProcess; retain
// the executable without write/delete sharing and verify the actual suspended
// process image before its first thread is resumed.
class PhotoWindowsImage final {
 std::vector<HANDLE> held_;
 HANDLE image_ = INVALID_HANDLE_VALUE;
 std::wstring path_, launchPath_;
 static void requireDirectory(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO info{};
  if (handle == INVALID_HANDLE_VALUE || !GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info))
   || (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 || (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) nativeFailure("photo-image-parent", GetLastError());
 }
public:
 explicit PhotoWindowsImage(HANDLE expected) {
  std::array<wchar_t, 32768> name{};
  const DWORD count = GetFinalPathNameByHandleW(expected, name.data(), static_cast<DWORD>(name.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_GUID);
  if (count == 0 || count >= name.size()) nativeFailure("photo-image-volume-name", GetLastError());
  path_ = name.data(); const auto& path = path_;
  // Packaged executable authority is a local volume path. Network namespaces
  // and reparse parents do not silently enter the native execution closure.
  const auto rootEnd = path.find(L"}\\");
  if (path.rfind(L"\\\\?\\Volume{", 0) != 0 || rootEnd == std::wstring::npos) nativeFailure("photo-image-local-volume", ERROR_BAD_PATHNAME);
  const size_t first = rootEnd + 2;
  for (size_t boundary = first; boundary < path.size(); ++boundary) if (boundary == first || path[boundary] == L'\\') {
   const auto parent = path.substr(0, boundary);
   const HANDLE handle = CreateFileW(parent.c_str(), FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
   requireDirectory(handle); held_.push_back(handle);
  }
  image_ = CreateFileW(path.c_str(), GENERIC_READ | FILE_EXECUTE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  FILE_ATTRIBUTE_TAG_INFO info{};
  if (image_ == INVALID_HANDLE_VALUE || !sameFile(expected, image_) || !GetFileInformationByHandleEx(image_, FileAttributeTagInfo, &info, sizeof(info))
   || (info.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) nativeFailure("photo-image-lock", GetLastError());
  // Keep the GUID ancestors and image held, but give CreateProcess an ordinary
  // drive-letter application name derived from that same retained image.
  const DWORD dosCount = GetFinalPathNameByHandleW(image_, name.data(), static_cast<DWORD>(name.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (dosCount == 0) nativeFailure("photo-launch-dos-name", GetLastError());
  if (dosCount >= name.size()) nativeFailure("photo-launch-dos-size", ERROR_INSUFFICIENT_BUFFER);
  const std::wstring dos(name.data(), dosCount);
  if (dos.size() < 8 || dos.rfind(L"\\\\?\\", 0) != 0 || dos[5] != L':' || dos[6] != L'\\'
   || !((dos[4] >= L'A' && dos[4] <= L'Z') || (dos[4] >= L'a' && dos[4] <= L'z'))) nativeFailure("photo-launch-local-drive", ERROR_BAD_PATHNAME);
  launchPath_ = dos.substr(4);
  const HANDLE launch = CreateFileW(launchPath_.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (launch == INVALID_HANDLE_VALUE) nativeFailure("photo-launch-open", GetLastError());
  if (!sameFile(image_, launch)) nativeFailure("photo-launch-identity", ERROR_INVALID_HANDLE);
  held_.push_back(launch); // Retain the validated alias through creation and verification.
 }
 PhotoWindowsImage(const PhotoWindowsImage&) = delete;
 PhotoWindowsImage& operator=(const PhotoWindowsImage&) = delete;
 const std::wstring& path() const noexcept { return launchPath_; }
 void verify(HANDLE process) const {
  std::array<wchar_t, 32768> name{}; DWORD count = static_cast<DWORD>(name.size());
  if (!QueryFullProcessImageNameW(process, PROCESS_NAME_NATIVE, name.data(), &count) || count < 1 || count >= name.size()) nativeFailure("photo-created-image", GetLastError());
  const std::wstring native(name.data()); if (native.rfind(L"\\Device\\", 0) != 0) nativeFailure("photo-created-image-native-path", ERROR_BAD_PATHNAME);
  const std::wstring actualPath = L"\\\\?\\GLOBALROOT" + native;
  const HANDLE actual = CreateFileW(actualPath.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (actual == INVALID_HANDLE_VALUE || !sameFile(image_, actual)) nativeFailure("photo-created-image-identity", GetLastError());
  if (!CloseHandle(actual)) nativeFailure("photo-created-image-close", GetLastError());
 }
 ~PhotoWindowsImage() {
  if (image_ != INVALID_HANDLE_VALUE && !CloseHandle(image_)) { ExitProcess(125); }
  for (auto it = held_.rbegin(); it != held_.rend(); ++it) { if (!CloseHandle(*it)) { ExitProcess(125); } }
 }
};
