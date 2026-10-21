#include <windows.h>

#include "loopback-capture-wrapper.h"

Napi::Value StartLoopbackCapture(const Napi::CallbackInfo &info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction())
	{
		Napi::TypeError::New(env, "Expected at least (number, function[, function])").ThrowAsJavaScriptException();
		return env.Undefined();
	}

	if (hasActiveProcess)
	{
		Napi::TypeError::New(env, "Already capturing, call \"stopLoopbackCapture\" first or wait for it to finish capturing").ThrowAsJavaScriptException();
		return env.Undefined();
	}

	DWORD processId = info[0].As<Napi::Number>().Uint32Value();
	Napi::Function chunkCallback = info[1].As<Napi::Function>();

	Napi::Function finishCallback;
	if (info.Length() >= 3 && info[2].IsFunction())
	{
		finishCallback = info[2].As<Napi::Function>();
	}

	HRESULT result = loopbackCapture.StartCaptureAsync(processId, true, env, chunkCallback, finishCallback);

	if (!loopbackCapture.onCaptureFinish)
	{
		loopbackCapture.onCaptureFinish = []()
		{
			hasActiveProcess = false;
		};
	}

	if (result == E_INVALIDARG)
	{
		Napi::TypeError::New(env, "Process with that id does not exist").ThrowAsJavaScriptException();
		return env.Undefined();
	}
	else if (result != S_OK)
	{
		Napi::TypeError::New(env, "Unknown error").ThrowAsJavaScriptException();
		return env.Undefined();
	}

	hasActiveProcess = true;

	return env.Undefined();
}

Napi::Value StopLoopbackCapture(const Napi::CallbackInfo &info)
{
	Napi::Env env = info.Env();

	loopbackCapture.StopCaptureAsync();

	return env.Undefined();
}