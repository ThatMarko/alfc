#define WIN32_LEAN_AND_MEAN
#if !defined(_M_X64) && !defined(__x86_64__)
#error WmiDll requires an x64 Windows compiler environment, matching Bun and ALFC.
#endif
#include <windows.h>
#include <wbemidl.h>
#include <oleauto.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "WmiOutput.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "wbemuuid.lib")

#define MAX_RESULTS 16
#define WMI_ENUM_TIMEOUT_MS 5000
#define WMI_METHOD_TIMEOUT_MS 3000
#define MAX_WMI_ARGS 16
#define MAX_ARG_NAME_BYTES 63
#define BSTR_CACHE_INITIAL_CAPACITY 64

// Threading contract: this DLL is not thread-safe. Every export must be
// called from the same dedicated Bun hardware worker through bun:ffi.
// COINIT_MULTITHREADED in wmi_init()
// selects the COM apartment model, not concurrency for these globals.

static wchar_t *Utf8ToWide(const char *str);
static void SetLastErr(const char *fmt, ...);

extern "C" __declspec(dllexport) void wmi_cleanup(void);

struct BstrCacheEntry {
    char key[128];
    BSTR bstr;
};

static BstrCacheEntry *g_bstrCache = nullptr;
static int g_bstrCacheCount = 0;
static int g_bstrCacheCapacity = 0;

// Grows on demand so every distinct method name stays callable (the MOF
// exposes 137); only allocation failure can reject a new name.
static bool BstrCacheGrow(void) {
    int newCapacity =
        g_bstrCacheCapacity > 0 ? g_bstrCacheCapacity * 2
                                : BSTR_CACHE_INITIAL_CAPACITY;
    BstrCacheEntry *grown = static_cast<BstrCacheEntry *>(
        realloc(g_bstrCache, (size_t)newCapacity * sizeof(BstrCacheEntry)));
    if (!grown) {
        return false;
    }
    g_bstrCache = grown;
    g_bstrCacheCapacity = newCapacity;
    return true;
}

static BSTR GetCachedBSTR(const char *method_name) {
    if (!method_name) {
        SetLastErr("Method name is null");
        return nullptr;
    }

    for (int i = 0; i < g_bstrCacheCount; i++) {
        if (strcmp(g_bstrCache[i].key, method_name) == 0) {
            return g_bstrCache[i].bstr;
        }
    }

    if (strlen(method_name) >= sizeof(g_bstrCache[0].key)) {
        SetLastErr("Method name too long for cache: '%s'", method_name);
        return nullptr;
    }

    wchar_t *wMethod = Utf8ToWide(method_name);
    if (!wMethod) {
        SetLastErr("UTF-8 to wide conversion failed for '%s'", method_name);
        return nullptr;
    }
    BSTR bstr = SysAllocString(wMethod);
    free(wMethod);
    if (!bstr) {
        SetLastErr("SysAllocString failed for '%s'", method_name);
        return nullptr;
    }

    if (g_bstrCacheCount >= g_bstrCacheCapacity && !BstrCacheGrow()) {
        SysFreeString(bstr);
        SetLastErr("Out of memory growing the BSTR cache");
        return nullptr;
    }

    strncpy_s(g_bstrCache[g_bstrCacheCount].key,
              sizeof(g_bstrCache[0].key), method_name, _TRUNCATE);
    g_bstrCache[g_bstrCacheCount].bstr = bstr;
    g_bstrCacheCount++;

    return bstr;
}

static IWbemLocator *g_pLoc = nullptr;
static IWbemServices *g_pSvc = nullptr;

static IWbemClassObject *g_pGetClassDef = nullptr;
static IWbemClassObject *g_pSetClassDef = nullptr;
static BSTR g_getObjectPath = nullptr;
static BSTR g_setObjectPath = nullptr;

static char g_lastError[1024] = {0};
static bool g_comInitialized = false;
// A timed-out provider call may still be executing. Never issue another
// hardware operation in this process after its completion becomes unknown.
static bool g_callTimedOut = false;

static void SetLastErr(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vsnprintf_s(g_lastError, sizeof(g_lastError), _TRUNCATE, fmt, args);
    va_end(args);
}

static wchar_t *Utf8ToWide(const char *str) {
    int len = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, str, -1, nullptr, 0);
    if (len <= 0) return nullptr;
    wchar_t *wstr = static_cast<wchar_t *>(malloc(len * sizeof(wchar_t)));
    if (wstr) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, str, -1, wstr, len);
    return wstr;
}

static HRESULT GetClassDefAndInstancePath(
    const wchar_t *className,
    IWbemClassObject **ppClassDef,
    BSTR *pObjectPath
) {
    BSTR bstrClass = SysAllocString(className);
    if (!bstrClass) {
        SetLastErr("SysAllocString failed for WMI class %ls", className);
        return E_OUTOFMEMORY;
    }

    HRESULT hr = g_pSvc->GetObject(bstrClass, 0, nullptr, ppClassDef, nullptr);
    if (FAILED(hr)) {
        SysFreeString(bstrClass);
        SetLastErr("GetObject failed for class: 0x%08lX", hr);
        return hr;
    }

    IEnumWbemClassObject *pEnum = nullptr;
    hr = g_pSvc->CreateInstanceEnum(bstrClass,
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, &pEnum);
    SysFreeString(bstrClass);
    if (FAILED(hr)) {
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("CreateInstanceEnum failed: 0x%08lX", hr);
        return hr;
    }

    IWbemClassObject *pInstance = nullptr;
    ULONG returned = 0;
    hr = pEnum->Next(WMI_ENUM_TIMEOUT_MS, 1, &pInstance, &returned);
    pEnum->Release();

    if (hr == WBEM_S_TIMEDOUT) {
        if (pInstance) pInstance->Release();
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("Timed out enumerating instances for %ls", className);
        return WBEM_E_TIMED_OUT;
    }

    if (FAILED(hr) || returned == 0) {
        if (pInstance) pInstance->Release();
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("No instances found for %ls", className);
        return FAILED(hr) ? hr : static_cast<HRESULT>(WBEM_E_NOT_FOUND);
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
    if (!*pObjectPath) {
        (*ppClassDef)->Release();
        *ppClassDef = nullptr;
        SetLastErr("SysAllocString failed for %ls instance path", className);
        return E_OUTOFMEMORY;
    }
    return S_OK;
}

// Builds a spawned in-params instance carrying every named argument as VT_UI1
// (all GB_WMIACPI input parameters are uint8). arg_names is a NUL-separated
// blob of arg_names_len bytes ending in a NUL; arg_values must provide at
// least arg_count bytes (guaranteed by the JavaScript caller).
static int BuildNamedInParams(
    IWbemClassObject *pClassDef,
    BSTR bstrMethod,
    const char *method_name,
    const char *arg_names,
    int arg_names_len,
    const unsigned char *arg_values,
    int arg_count,
    IWbemClassObject **ppInParams
) {
    if (arg_count < 1 || arg_count > MAX_WMI_ARGS) {
        SetLastErr("Argument count out of range for %s: %d", method_name, arg_count);
        return -1;
    }

    if (!arg_names || !arg_values || arg_names_len < arg_count * 2 ||
        arg_names_len > arg_count * (MAX_ARG_NAME_BYTES + 1)) {
        SetLastErr("Missing argument list for %s", method_name);
        return -1;
    }

    IWbemClassObject *pInParamsDef = nullptr;
    HRESULT hr = pClassDef->GetMethod(bstrMethod, 0, &pInParamsDef, nullptr);
    if (FAILED(hr)) {
        SetLastErr("GetMethod(%s) failed: 0x%08lX", method_name, hr);
        return -1;
    }
    if (!pInParamsDef) {
        SetLastErr("Method %s takes no input parameters", method_name);
        return -1;
    }

    hr = pInParamsDef->SpawnInstance(0, ppInParams);
    pInParamsDef->Release();
    if (FAILED(hr)) {
        SetLastErr("SpawnInstance failed: 0x%08lX", hr);
        return -1;
    }

    const char *cursor = arg_names;
    const char *end = arg_names + arg_names_len;
    for (int i = 0; i < arg_count; i++) {
        const char *segment = cursor;
        while (cursor < end && *cursor != '\0') {
            cursor++;
        }
        size_t length = (size_t)(cursor - segment);
        if (length == 0 || length > MAX_ARG_NAME_BYTES || cursor == end) {
            (*ppInParams)->Release();
            *ppInParams = nullptr;
            SetLastErr("Malformed argument name blob at index %d for %s", i, method_name);
            return -1;
        }
        cursor++; // skip the NUL terminator

        wchar_t wideName[MAX_ARG_NAME_BYTES + 1];
        int written = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, segment, (int)length,
                                          wideName, MAX_ARG_NAME_BYTES);
        if (written <= 0) {
            (*ppInParams)->Release();
            *ppInParams = nullptr;
            SetLastErr("Invalid UTF-8 argument name for %s", method_name);
            return -1;
        }
        wideName[written] = L'\0';

        VARIANT varArg;
        VariantInit(&varArg);
        varArg.vt = VT_UI1;
        varArg.bVal = arg_values[i];
        hr = (*ppInParams)->Put(wideName, 0, &varArg, 0);
        VariantClear(&varArg);
        if (FAILED(hr)) {
            (*ppInParams)->Release();
            *ppInParams = nullptr;
            SetLastErr("Put(%ls) failed for %s: 0x%08lX", wideName, method_name, hr);
            return -1;
        }
    }

    if (cursor != end) {
        (*ppInParams)->Release();
        *ppInParams = nullptr;
        SetLastErr("Trailing argument name data for %s", method_name);
        return -1;
    }

    return 0;
}

// Consume the semisynchronous call reference on every path. A failure to learn
// its completion status is different from a completed operation's failure:
// the former leaves hardware effects unknown and must disable the channel.
static HRESULT CompleteMethodCall(
    IWbemCallResult *call, const char *method_name,
    IWbemClassObject **outParams
) {
    LONG status = E_FAIL;
    HRESULT hr = call->GetCallStatus(WMI_METHOD_TIMEOUT_MS, &status);
    if (hr != WBEM_S_NO_ERROR) {
        g_callTimedOut = true;
        call->Release();
        SetLastErr("ExecMethod(%s) completion is unknown (GetCallStatus 0x%08lX); restart ALFC before issuing more commands", method_name, hr);
        return WBEM_E_TIMED_OUT;
    }
    if (static_cast<HRESULT>(status) == static_cast<HRESULT>(WBEM_E_TIMED_OUT)) {
        g_callTimedOut = true;
    }
    if (FAILED(status)) hr = status;
    if (hr != WBEM_S_NO_ERROR) {
        call->Release();
        SetLastErr("ExecMethod(%s) failed: 0x%08lX", method_name, hr);
        return FAILED(hr) ? hr : E_FAIL;
    }
    if (outParams) hr = call->GetResultObject(0, outParams);
    call->Release();
    if (hr != WBEM_S_NO_ERROR) {
        SetLastErr("Reading output from %s failed: 0x%08lX", method_name, hr);
        return FAILED(hr) ? hr : E_FAIL;
    }
    return S_OK;
}

// Semisynchronous execution bounds the wait without running provider work on
// another application thread. After a timeout, only process restart is safe.
static HRESULT ExecuteMethod(
    BSTR objectPath, BSTR method, const char *method_name,
    IWbemClassObject *inParams, IWbemClassObject **outParams
) {
    if (g_callTimedOut) {
        SetLastErr("WMI call previously timed out; restart ALFC before issuing more commands");
        return WBEM_E_TIMED_OUT;
    }
    IWbemCallResult *call = nullptr;
    HRESULT hr = g_pSvc->ExecMethod(objectPath, method,
        WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, inParams, nullptr, &call);
    if (FAILED(hr) || !call) {
        if (call) call->Release();
        SetLastErr("ExecMethod(%s) failed: 0x%08lX", method_name, hr);
        return FAILED(hr) ? hr : E_FAIL;
    }
    return CompleteMethodCall(call, method_name, outParams);
}

static bool ReadUnsignedWmiValue(
    VARIANT &input, CIMTYPE type, unsigned int *value, int *width
) {
    *width = type == CIM_UINT8 ? 1 : type == CIM_UINT16 ? 2 : 0;
    if (*width == 0) return false;
    // CIM unsigned integers commonly use VT_UI1 or VT_I4. Permit integer
    // containers only; VariantChangeType must not round floats or parse text
    // into apparently valid hardware bytes.
    switch (input.vt) {
        case VT_I1: case VT_UI1: case VT_I2: case VT_UI2:
        case VT_I4: case VT_UI4: case VT_INT: case VT_UINT:
            break;
        default:
            return false;
    }
    VARIANT numeric;
    VariantInit(&numeric);
    HRESULT hr = VariantChangeType(&numeric, &input, 0, VT_UI4);
    bool valid = SUCCEEDED(hr) && numeric.ulVal <= (*width == 1 ? 0xffu : 0xffffu);
    if (valid) *value = numeric.ulVal;
    VariantClear(&numeric);
    return valid;
}

// IWbemClassObject::Next has no defined property order. The method definition's
// ID qualifier specifies parameter order. Emit each uint16 at its full width
// as little-endian bytes, even when its numeric value fits in a single byte.
static int ExecuteGetAndEnumerate(
    BSTR bstrMethod,
    const char *method_name,
    IWbemClassObject *pInParams,
    double *out_results,
    int *out_count
) {
    IWbemClassObject *pOutParams = nullptr;
    HRESULT hr = ExecuteMethod(g_getObjectPath, bstrMethod, method_name, pInParams, &pOutParams);

    if (pInParams) pInParams->Release();

    if (FAILED(hr)) {
        return hr == static_cast<HRESULT>(WBEM_E_TIMED_OUT) ? -2 : -1;
    }

    if (!pOutParams) {
        SetLastErr("ExecMethod(%s) returned no output", method_name);
        return -1;
    }

    IWbemClassObject *outDefinition = nullptr;
    hr = g_pGetClassDef->GetMethod(bstrMethod, 0, nullptr, &outDefinition);
    if (FAILED(hr) || !outDefinition) {
        pOutParams->Release();
        SetLastErr("Cannot read output definition for %s: 0x%08lX", method_name, hr);
        return -1;
    }
    hr = pOutParams->BeginEnumeration(WBEM_FLAG_NONSYSTEM_ONLY);
    if (FAILED(hr)) {
        pOutParams->Release();
        outDefinition->Release();
        SetLastErr("BeginEnumeration failed: 0x%08lX", hr);
        return -1;
    }

    WmiOutputField fields[MAX_RESULTS];
    int fieldCount = 0;
    int byteCount = 0;
    bool valid = true;
    HRESULT nextHr = WBEM_S_NO_ERROR;
    while (valid) {
        BSTR propName = nullptr;
        VARIANT varVal;
        VariantInit(&varVal);
        CIMTYPE type = 0;
        nextHr = pOutParams->Next(0, &propName, &varVal, &type, nullptr);
        if (nextHr != WBEM_S_NO_ERROR) {
            SysFreeString(propName);
            VariantClear(&varVal);
            break;
        }
        if (_wcsicmp(propName, L"ReturnValue") != 0) {
            int width = 0;
            unsigned int value = 0;
            if (!ReadUnsignedWmiValue(varVal, type, &value, &width) ||
                byteCount + width > MAX_RESULTS) {
                SetLastErr("Invalid or oversized output '%ls' from %s", propName, method_name);
                valid = false;
            } else {
                int order = -1;
                IWbemQualifierSet *qualifiers = nullptr;
                if (SUCCEEDED(outDefinition->GetPropertyQualifierSet(propName, &qualifiers))) {
                    VARIANT id;
                    VariantInit(&id);
                    if (SUCCEEDED(qualifiers->Get(L"ID", 0, &id, nullptr)) &&
                        id.vt == VT_I4 && id.lVal >= 0) order = id.lVal;
                    VariantClear(&id);
                    qualifiers->Release();
                }
                fields[fieldCount++] = {order, value, width};
                byteCount += width;
            }
        }
        SysFreeString(propName);
        VariantClear(&varVal);
    }
    pOutParams->EndEnumeration();
    pOutParams->Release();
    outDefinition->Release();

    if (!valid) return -1;
    if (nextHr != WBEM_S_NO_MORE_DATA) {
        SetLastErr("Enumerating output from %s failed: 0x%08lX", method_name, nextHr);
        return -1;
    }

    const char *packingError = PackWmiOutputFields(fields, fieldCount, out_results, MAX_RESULTS, out_count);
    if (packingError) {
        SetLastErr("Invalid output from %s: %s", method_name, packingError);
        return -1;
    }
    return 0;
}

extern "C" {

// Version 2 returns canonical little-endian output bytes, rather than
// unspecified-order numeric property values. Reject stale DLLs in the caller.
__declspec(dllexport) int wmi_abi_version(void) { return 2; }

__declspec(dllexport) int wmi_init(void) {
    if (g_callTimedOut) {
        SetLastErr("WMI call previously timed out; restart ALFC before initializing again");
        return -2;
    }
    wmi_cleanup();

    HRESULT hr;

    hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (hr == S_OK || hr == S_FALSE) {
        g_comInitialized = true;
    } else if (hr != RPC_E_CHANGED_MODE) {
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
        goto fail;
    }

    hr = CoCreateInstance(
        CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
        IID_IWbemLocator, reinterpret_cast<void **>(&g_pLoc)
    );
    if (FAILED(hr)) {
        SetLastErr("CoCreateInstance WbemLocator failed: 0x%08lX", hr);
        goto fail;
    }

    {
        BSTR bstrNs = SysAllocString(L"ROOT\\WMI");
        if (!bstrNs) {
            hr = E_OUTOFMEMORY;
            SetLastErr("SysAllocString failed for WMI namespace");
            goto fail;
        }
        hr = g_pLoc->ConnectServer(bstrNs, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &g_pSvc);
        SysFreeString(bstrNs);
    }
    if (FAILED(hr)) {
        SetLastErr("ConnectServer ROOT\\WMI failed: 0x%08lX", hr);
        goto fail;
    }

    hr = CoSetProxyBlanket(
        g_pSvc, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
        RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
        nullptr, EOAC_NONE
    );
    if (FAILED(hr)) {
        SetLastErr("CoSetProxyBlanket failed: 0x%08lX", hr);
        goto fail;
    }

    hr = GetClassDefAndInstancePath(L"GB_WMIACPI_Get", &g_pGetClassDef, &g_getObjectPath);
    if (FAILED(hr)) goto fail;

    hr = GetClassDefAndInstancePath(L"GB_WMIACPI_Set", &g_pSetClassDef, &g_setObjectPath);
    if (FAILED(hr)) goto fail;

    return 0;

fail:
    wmi_cleanup();
    return -1;
}

__declspec(dllexport) int wmi_get(
    const char *method_name,
    int arg_value,
    double *out_results,
    int *out_count
) {
    if (!method_name || !out_results || !out_count) {
        SetLastErr("wmi_get received a null argument");
        return -1;
    }

    if (!g_pSvc || !g_pGetClassDef || !g_getObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    *out_count = 0;

    BSTR bstrMethod = GetCachedBSTR(method_name);
    if (!bstrMethod) return -1;

    IWbemClassObject *pInParams = nullptr;

    if (arg_value >= 0) {
        if (arg_value > 0xFF) {
            SetLastErr("Data argument for %s is outside uint8 range: %d",
                       method_name, arg_value);
            return -1;
        }

        BYTE value = static_cast<BYTE>(arg_value);
        if (BuildNamedInParams(g_pGetClassDef, bstrMethod, method_name,
                               "Data", static_cast<int>(sizeof("Data")),
                               &value, 1, &pInParams) != 0) {
            return -1;
        }
    }

    return ExecuteGetAndEnumerate(bstrMethod, method_name, pInParams,
                                  out_results, out_count);
}

__declspec(dllexport) int wmi_get_named(
    const char *method_name,
    const char *arg_names,
    int arg_names_len,
    const unsigned char *arg_values,
    int arg_count,
    double *out_results,
    int *out_count
) {
    if (!method_name || !out_results || !out_count) {
        SetLastErr("wmi_get_named received a null argument");
        return -1;
    }

    if (!g_pSvc || !g_pGetClassDef || !g_getObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    *out_count = 0;

    BSTR bstrMethod = GetCachedBSTR(method_name);
    if (!bstrMethod) return -1;

    IWbemClassObject *pInParams = nullptr;
    if (BuildNamedInParams(g_pGetClassDef, bstrMethod, method_name,
                           arg_names, arg_names_len, arg_values, arg_count,
                           &pInParams) != 0) {
        return -1;
    }

    return ExecuteGetAndEnumerate(bstrMethod, method_name, pInParams,
                                  out_results, out_count);
}

__declspec(dllexport) int wmi_set(const char *method_name, int arg_value) {
    if (!method_name) {
        SetLastErr("wmi_set received a null method name");
        return -1;
    }

    if (!g_pSvc || !g_pSetClassDef || !g_setObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    if (arg_value < 0 || arg_value > 0xFF) {
        SetLastErr("Data argument for %s is outside uint8 range: %d",
                   method_name, arg_value);
        return -1;
    }

    BSTR bstrMethod = GetCachedBSTR(method_name);
    if (!bstrMethod) return -1;

    BYTE value = static_cast<BYTE>(arg_value);
    IWbemClassObject *pInParams = nullptr;
    if (BuildNamedInParams(g_pSetClassDef, bstrMethod, method_name,
                           "Data", static_cast<int>(sizeof("Data")),
                           &value, 1, &pInParams) != 0) {
        return -1;
    }

    HRESULT hr = ExecuteMethod(g_setObjectPath, bstrMethod, method_name, pInParams, nullptr);

    pInParams->Release();

    if (FAILED(hr)) {
        return hr == static_cast<HRESULT>(WBEM_E_TIMED_OUT) ? -2 : -1;
    }

    return 0;
}

__declspec(dllexport) int wmi_set_named(
    const char *method_name,
    const char *arg_names,
    int arg_names_len,
    const unsigned char *arg_values,
    int arg_count
) {
    if (!method_name) {
        SetLastErr("wmi_set_named received a null method name");
        return -1;
    }

    if (!g_pSvc || !g_pSetClassDef || !g_setObjectPath) {
        SetLastErr("WMI not initialized");
        return -1;
    }

    BSTR bstrMethod = GetCachedBSTR(method_name);
    if (!bstrMethod) return -1;

    IWbemClassObject *pInParams = nullptr;
    if (BuildNamedInParams(g_pSetClassDef, bstrMethod, method_name,
                           arg_names, arg_names_len, arg_values, arg_count,
                           &pInParams) != 0) {
        return -1;
    }

    HRESULT hr = ExecuteMethod(g_setObjectPath, bstrMethod, method_name, pInParams, nullptr);

    pInParams->Release();

    if (FAILED(hr)) {
        return hr == static_cast<HRESULT>(WBEM_E_TIMED_OUT) ? -2 : -1;
    }

    return 0;
}

__declspec(dllexport) void wmi_cleanup(void) {
    for (int i = 0; i < g_bstrCacheCount; i++) {
        SysFreeString(g_bstrCache[i].bstr);
    }
    g_bstrCacheCount = 0;
    free(g_bstrCache);
    g_bstrCache = nullptr;
    g_bstrCacheCapacity = 0;
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
