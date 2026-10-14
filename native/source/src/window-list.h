#pragma once

#include <windows.h>
#include <string>

std::string WideToUtf8(const std::wstring &wide);

struct Icon {
    std::vector<uint8_t> buffer;
    int width;
    int height;
};

struct Window
{
    DWORD processId;
    std::string processName;
    HWND hWnd;
    std::string title;
    Icon icon;
    bool isVisible;
};

Icon HIconToBitmap(HICON hIcon);
Icon GetWindowClassIcon(HWND hWnd);
BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam);

Napi::Value GetVisibleWindows(const Napi::CallbackInfo &info);