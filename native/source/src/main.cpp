#include <napi.h>

#include "window-list.h"
#include "loopback-capture-wrapper.h"

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("getVisibleWindows", Napi::Function::New(env, GetVisibleWindows));
    exports.Set("startLoopbackCapture", Napi::Function::New(env, StartLoopbackCapture));
    exports.Set("stopLoopbackCapture", Napi::Function::New(env, StopLoopbackCapture));
    return exports;
}

NODE_API_MODULE(addon, Init)