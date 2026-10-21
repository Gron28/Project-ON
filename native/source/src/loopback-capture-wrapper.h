#pragma once

#include <napi.h>

#include "loopback-capture.h"

static CLoopbackCapture loopbackCapture;
static bool hasActiveProcess;

Napi::Value StartLoopbackCapture(const Napi::CallbackInfo &info);
Napi::Value StopLoopbackCapture(const Napi::CallbackInfo &info);
