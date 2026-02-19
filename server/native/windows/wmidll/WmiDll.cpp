#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wbemidl.h>
#include <oleauto.h>
#include <stdio.h>
#include <string.h>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "wbemuuid.lib")

#define MAX_RESULTS 16

static IWbemLocator *g_pLoc = nullptr;
static IWbemServices *g_pSvc = nullptr;

static IWbemClassObject *g_pGetClassDef = nullptr;
static IWbemClassObject *g_pSetClassDef = nullptr;
static BSTR g_getObjectPath = nullptr;
static BSTR g_setObjectPath = nullptr;

static char g_lastError[1024] = {0};
static bool g_comInitialized = false;

static void SetLastErr(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vsnprintf_s(g_lastError, sizeof(g_lastError), _TRUNCATE, fmt, args);
    va_end(args);
}

static wchar_t *Utf8ToWide(const char *str) {
    int len = MultiByteToWideChar(CP_UTF8, 0, str, -1, nullptr, 0);
    if (len <= 0) return nullptr;
    wchar_t *wstr = static_cast<wchar_t *>(malloc(len * sizeof(wchar_t)));
    if (wstr) MultiByteToWideChar(CP_UTF8, 0, str, -1, wstr, len);
    return wstr;
}

static HRESULT GetClassDefAndInstancePath(
    const wchar_t *className,
    IWbemClassObject **ppClassDef,
    BSTR *pObjectPath
) {
    BSTR bstrClass = SysAllocString(className);
    if (!bstrClass) return E_OUTOFMEMORY;

    HRESULT hr = g_pSvc->GetObject(bstrClass, 0, nullptr, ppClassDef, nullptr);
    if (FAILED(hr)) {
        SysFreeString(bstrClass);
        SetLastErr("GetObject failed for class: 0x%08lX", hr);
        return hr;
    }

    IEnumWbemClassObject *pEnum = nullptr;
    hr = g_pSvc->CreateInstanceEnum(bstrClass, WBEM_FLAG_FORWARD_ONLY, nullptr, &pEnum);
    SysFreeString(bstrClass);
    if (FAILED(hr)) {
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("CreateInstanceEnum failed: 0x%08lX", hr);
        return hr;
    }

    IWbemClassObject *pInstance = nullptr;
    ULONG returned = 0;
    hr = pEnum->Next(WBEM_INFINITE, 1, &pInstance, &returned);
    pEnum->Release();

    if (FAILED(hr) || returned == 0) {
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("No instances found for %ls", className);
        return FAILED(hr) ? hr : WBEM_E_NOT_FOUND;
    }

    VARIANT varPath;
    VariantInit(&varPath);
    hr = pInstance->Get(L"__PATH", 0, &varPath, nullptr, nullptr);
    pInstance->Release();

    if (FAILED(hr) || varPath.vt != VT_BSTR) {
        VariantClear(&varPath);
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("Failed to get __PATH: 0x%08lX", hr);
        return FAILED(hr) ? hr : E_FAIL;
    }

    *pObjectPath = SysAllocString(varPath.bstrVal);
    VariantClear(&varPath);
    return S_OK;
}

extern "C" {

__declspec(dllexport) int wmi_init(void) {
    HRESULT hr;

    hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (hr == S_OK) {
        g_comInitialized = true;
    } else if (hr != S_FALSE && hr != RPC_E_CHANGED_MODE) {
        SetLastErr("CoInitializeEx failed: 0x%08lX", hr);
        return -1;
    }

    hr = CoInitializeSecurity(
        nullptr, -1, nullptr, nullptr,
        RPC_C_AUTHN_LEVEL_DEFAULT,
        RPC_C_IMP_LEVEL_IMPERSONATE,
        nullptr, EOAC_NONE, nullptr
    );
    if (FAILED(hr) && hr != RPC_E_TOO_LATE) {
        SetLastErr("CoInitializeSecurity failed: 0x%08lX", hr);
        return -1;
    }

    hr = CoCreateInstance(
        CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
        IID_IWbemLocator, reinterpret_cast<void **>(&g_pLoc)
    );
    if (FAILED(hr)) {
        SetLastErr("CoCreateInstance WbemLocator failed: 0x%08lX", hr);
        return -1;
    }

    BSTR bstrNs = SysAllocString(L"ROOT\\WMI");
    hr = g_pLoc->ConnectServer(bstrNs, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &g_pSvc);
    SysFreeString(bstrNs);
    if (FAILED(hr)) {
        SetLastErr("ConnectServer ROOT\\WMI failed: 0x%08lX", hr);
        return -1;
    }

    hr = CoSetProxyBlanket(
        g_pSvc, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
        RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
        nullptr, EOAC_NONE
    );
    if (FAILED(hr)) {
        SetLastErr("CoSetProxyBlanket failed: 0x%08lX", hr);
        return -1;
    }

    hr = GetClassDefAndInstancePath(L"GB_WMIACPI_Get", &g_pGetClassDef, &g_getObjectPath);
    if (FAILED(hr)) return -1;

    hr = GetClassDefAndInstancePath(L"GB_WMIACPI_Set", &g_pSetClassDef, &g_setObjectPath);
    if (FAILED(hr)) return -1;

    return 0;
}

__declspec(dllexport) int wmi_get(
    const char *method_name,
    int arg_value,
    double *out_results,
    int *out_count
) {
    if (!g_pSvc || !g_pGetClassDef || !g_getObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    *out_count = 0;

    wchar_t *wMethod = Utf8ToWide(method_name);
    if (!wMethod) { SetLastErr("UTF-8 conversion failed"); return -1; }
    BSTR bstrMethod = SysAllocString(wMethod);
    free(wMethod);
    if (!bstrMethod) { SetLastErr("SysAllocString failed"); return -1; }

    IWbemClassObject *pInParams = nullptr;
    HRESULT hr;

    if (arg_value >= 0) {
        IWbemClassObject *pInParamsDef = nullptr;
        hr = g_pGetClassDef->GetMethod(bstrMethod, 0, &pInParamsDef, nullptr);
        if (FAILED(hr)) {
            SysFreeString(bstrMethod);
            SetLastErr("GetMethod(%s) failed: 0x%08lX", method_name, hr);
            return -1;
        }

        hr = pInParamsDef->SpawnInstance(0, &pInParams);
        pInParamsDef->Release();
        if (FAILED(hr)) {
            SysFreeString(bstrMethod);
            SetLastErr("SpawnInstance failed: 0x%08lX", hr);
            return -1;
        }

        VARIANT varArg;
        VariantInit(&varArg);
        varArg.vt = VT_I4;
        varArg.lVal = arg_value;
        hr = pInParams->Put(L"Data", 0, &varArg, 0);
        VariantClear(&varArg);
        if (FAILED(hr)) {
            pInParams->Release();
            SysFreeString(bstrMethod);
            SetLastErr("Put Data failed: 0x%08lX", hr);
            return -1;
        }
    }

    IWbemClassObject *pOutParams = nullptr;
    hr = g_pSvc->ExecMethod(g_getObjectPath, bstrMethod, 0, nullptr, pInParams, &pOutParams, nullptr);

    if (pInParams) pInParams->Release();
    SysFreeString(bstrMethod);

    if (FAILED(hr)) {
        SetLastErr("ExecMethod(%s) failed: 0x%08lX", method_name, hr);
        return -1;
    }

    if (!pOutParams) {
        SetLastErr("ExecMethod(%s) returned no output", method_name);
        return -1;
    }

    hr = pOutParams->BeginEnumeration(WBEM_FLAG_NONSYSTEM_ONLY);
    if (FAILED(hr)) {
        pOutParams->Release();
        SetLastErr("BeginEnumeration failed: 0x%08lX", hr);
        return -1;
    }

    BSTR propName = nullptr;
    VARIANT varVal;
    int count = 0;

    while (pOutParams->Next(0, &propName, &varVal, nullptr, nullptr) == WBEM_S_NO_ERROR) {
        if (count < MAX_RESULTS) {
            VARIANT varDouble;
            VariantInit(&varDouble);
            if (SUCCEEDED(VariantChangeType(&varDouble, &varVal, 0, VT_R8))) {
                out_results[count] = varDouble.dblVal;
            } else {
                out_results[count] = 0.0;
            }
            VariantClear(&varDouble);
            count++;
        }
        SysFreeString(propName);
        VariantClear(&varVal);
    }

    pOutParams->EndEnumeration();
    pOutParams->Release();

    *out_count = count;
    return 0;
}

__declspec(dllexport) int wmi_set(const char *method_name, int arg_value) {
    if (!g_pSvc || !g_pSetClassDef || !g_setObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    wchar_t *wMethod = Utf8ToWide(method_name);
    if (!wMethod) { SetLastErr("UTF-8 conversion failed"); return -1; }
    BSTR bstrMethod = SysAllocString(wMethod);
    free(wMethod);
    if (!bstrMethod) { SetLastErr("SysAllocString failed"); return -1; }

    IWbemClassObject *pInParamsDef = nullptr;
    HRESULT hr = g_pSetClassDef->GetMethod(bstrMethod, 0, &pInParamsDef, nullptr);
    if (FAILED(hr)) {
        SysFreeString(bstrMethod);
        SetLastErr("GetMethod(%s) failed: 0x%08lX", method_name, hr);
        return -1;
    }

    IWbemClassObject *pInParams = nullptr;
    hr = pInParamsDef->SpawnInstance(0, &pInParams);
    pInParamsDef->Release();
    if (FAILED(hr)) {
        SysFreeString(bstrMethod);
        SetLastErr("SpawnInstance failed: 0x%08lX", hr);
        return -1;
    }

    VARIANT varArg;
    VariantInit(&varArg);
    varArg.vt = VT_I4;
    varArg.lVal = arg_value;
    hr = pInParams->Put(L"Data", 0, &varArg, 0);
    VariantClear(&varArg);
    if (FAILED(hr)) {
        pInParams->Release();
        SysFreeString(bstrMethod);
        SetLastErr("Put Data failed: 0x%08lX", hr);
        return -1;
    }

    hr = g_pSvc->ExecMethod(g_setObjectPath, bstrMethod, 0, nullptr, pInParams, nullptr, nullptr);

    pInParams->Release();
    SysFreeString(bstrMethod);

    if (FAILED(hr)) {
        SetLastErr("ExecMethod(%s) failed: 0x%08lX", method_name, hr);
        return -1;
    }

    return 0;
}

__declspec(dllexport) void wmi_cleanup(void) {
    if (g_pGetClassDef) { g_pGetClassDef->Release(); g_pGetClassDef = nullptr; }
    if (g_pSetClassDef) { g_pSetClassDef->Release(); g_pSetClassDef = nullptr; }
    if (g_getObjectPath) { SysFreeString(g_getObjectPath); g_getObjectPath = nullptr; }
    if (g_setObjectPath) { SysFreeString(g_setObjectPath); g_setObjectPath = nullptr; }
    if (g_pSvc) { g_pSvc->Release(); g_pSvc = nullptr; }
    if (g_pLoc) { g_pLoc->Release(); g_pLoc = nullptr; }
    if (g_comInitialized) { CoUninitialize(); g_comInitialized = false; }
}

__declspec(dllexport) const char *wmi_get_last_error(void) {
    return g_lastError;
}

} // extern "C"
