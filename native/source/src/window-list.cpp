#include <windows.h>
#include <psapi.h>
#include <string>
#include <vector>
#include <napi.h>

#include "window-list.h"

#pragma comment(lib, "psapi.lib")

std::string WideToUtf8(const std::wstring &wide)
{
    if (wide.empty())
        return std::string();

    int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, &result[0], size, nullptr, nullptr);
    return result;
}

Icon HIconToBitmap(HICON hIcon)
{
    Icon icon;
    
    ICONINFO iconInfo;
    if (!GetIconInfo(hIcon, &iconInfo))
    {
        return icon;
    }

    BITMAP bmp;
    GetObject(iconInfo.hbmColor, sizeof(BITMAP), &bmp);

    icon.width = bmp.bmWidth;
    icon.height = bmp.bmHeight;

    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = bmp.bmWidth;
    bmi.bmiHeader.biHeight = -bmp.bmHeight;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    HDC hdc = GetDC(NULL);
    std::vector<uint8_t> pixels(icon.width * icon.height * (bmi.bmiHeader.biBitCount / 8));

    GetDIBits(hdc, iconInfo.hbmColor, 0, icon.height, pixels.data(), &bmi, DIB_RGB_COLORS);

    icon.buffer = pixels;

    ReleaseDC(NULL, hdc);
    DeleteObject(iconInfo.hbmColor);
    DeleteObject(iconInfo.hbmMask);

    return icon;
}

Icon GetWindowClassIcon(HWND hWnd)
{
    HICON hIcon = (HICON)GetClassLongPtr(hWnd, GCLP_HICON);

    if (!hIcon)
    {
        hIcon = (HICON)GetClassLongPtr(hWnd, GCLP_HICONSM);
    }

    Icon icon = HIconToBitmap(hIcon);
    return icon;
}

BOOL CALLBACK EnumWindowsProc(HWND hWnd, LPARAM lParam)
{
    std::vector<Window> *windows = reinterpret_cast<std::vector<Window> *>(lParam);

    wchar_t windowTitle[256];
    GetWindowTextW(hWnd, windowTitle, sizeof(windowTitle) / sizeof(wchar_t));

    if (wcslen(windowTitle) == 0)
    {
        return TRUE;
    }

    std::string windowTitleUtf8 = WideToUtf8(windowTitle);

    DWORD processId;
    GetWindowThreadProcessId(hWnd, &processId);

    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
    if (hProcess == NULL)
    {
        return TRUE;
    }

    wchar_t processName[MAX_PATH];
    DWORD size = sizeof(processName) / sizeof(wchar_t);
    if (!QueryFullProcessImageNameW(hProcess, 0, processName, &size))
    {
        CloseHandle(hProcess);
        return TRUE;
    }

    std::wstring fullPath(processName);
    size_t lastSlash = fullPath.find_last_of(L"\\");
    std::wstring fileName = (lastSlash != std::wstring::npos) ? fullPath.substr(lastSlash + 1) : fullPath;
    std::string fileNameUtf8 = WideToUtf8(fileName);
    Icon icon = GetWindowClassIcon(hWnd);
    bool isVisible = IsWindowVisible(hWnd);

    Window window;
    window.processId = processId;
    window.processName = fileNameUtf8;
    window.title = windowTitleUtf8;
    window.hWnd = hWnd;
    window.icon = icon;
    window.isVisible = isVisible;

    windows->push_back(window);

    CloseHandle(hProcess);
    return TRUE;
}

Napi::Value GetVisibleWindows(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    std::vector<Window> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));

    std::vector<Window> filteredWindows;
    for (const auto &window : windows)
    {
        if (!window.title.empty() && window.isVisible)
        {
            filteredWindows.push_back(window);
        }
    }

    Napi::Array result = Napi::Array::New(env, filteredWindows.size());
    for (size_t i = 0; i < filteredWindows.size(); i++)
    {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("processId", Napi::Number::New(env, filteredWindows[i].processId));
        obj.Set("processName", Napi::String::New(env, filteredWindows[i].processName));
        obj.Set("title", Napi::String::New(env, filteredWindows[i].title));

        Icon* icon = &filteredWindows[i].icon;

        if (!filteredWindows[i].icon.buffer.empty())
        {
            Napi::Object iconObj = Napi::Object::New(env);
            iconObj.Set("width", Napi::Number::New(env, icon->width));
            iconObj.Set("height", Napi::Number::New(env, icon->height));

            Napi::Buffer<uint8_t> data = Napi::Buffer<uint8_t>::Copy(env, icon->buffer.data(), icon->buffer.size());
            iconObj.Set("buffer", data);

            obj.Set("icon", iconObj);
        }
        else
        {
            obj.Set("icon", env.Null());
        }

        result[i] = obj;
    }

    return result;
}