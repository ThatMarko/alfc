// Exercise the actual COM completion logic without a WMI provider or hardware.
// Build on Windows with the same MSVC environment as WmiDll:
// cl /nologo /EHsc WmiNative.test.cpp /link ole32.lib oleaut32.lib wbemuuid.lib
#include "WmiDll.cpp"
#include <cassert>

class FakeCallResult final : public IWbemCallResult {
public:
    HRESULT waitResult = S_OK;
    LONG operationResult = S_OK;
    HRESULT objectResult = S_OK;
    LONG waited = -1;
    int releases = 0;
    int objectReads = 0;

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **) override { return E_NOINTERFACE; }
    ULONG STDMETHODCALLTYPE AddRef() override { return 1; }
    ULONG STDMETHODCALLTYPE Release() override { releases++; return 0; }
    HRESULT STDMETHODCALLTYPE GetResultObject(LONG timeout, IWbemClassObject **result) override {
        assert(timeout == 0);
        objectReads++;
        *result = nullptr;
        return objectResult;
    }
    HRESULT STDMETHODCALLTYPE GetResultString(LONG, BSTR *) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE GetResultServices(LONG, IWbemServices **) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE GetCallStatus(LONG timeout, LONG *status) override {
        waited = timeout;
        *status = operationResult;
        return waitResult;
    }
};

int main() {
    VARIANT raw;
    VariantInit(&raw);
    unsigned int value = 0;
    int width = 0;
    raw.vt = VT_UI1; raw.bVal = 42;
    assert(ReadUnsignedWmiValue(raw, CIM_UINT8, &value, &width) && value == 42 && width == 1);
    raw.vt = VT_I4; raw.lVal = 42;
    assert(ReadUnsignedWmiValue(raw, CIM_UINT16, &value, &width) && value == 42 && width == 2);
    raw.lVal = 65535;
    assert(ReadUnsignedWmiValue(raw, CIM_UINT16, &value, &width) && value == 65535);
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT8, &value, &width));
    raw.lVal = -1;
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT16, &value, &width));
    raw.vt = VT_R8; raw.dblVal = 1.5;
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT8, &value, &width));
    raw.vt = VT_BSTR; raw.bstrVal = SysAllocString(L"42");
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT8, &value, &width));
    VariantClear(&raw);
    raw.vt = VT_NULL;
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT8, &value, &width));
    raw.vt = VT_UI1; raw.bVal = 42;
    assert(!ReadUnsignedWmiValue(raw, CIM_UINT32, &value, &width));

    FakeCallResult success;
    IWbemClassObject *output = nullptr;
    assert(CompleteMethodCall(&success, "test", &output) == S_OK);
    assert(success.waited == WMI_METHOD_TIMEOUT_MS && success.releases == 1 && success.objectReads == 1);
    assert(!g_callTimedOut);

    FakeCallResult rejected;
    rejected.operationResult = WBEM_E_NOT_SUPPORTED;
    assert(CompleteMethodCall(&rejected, "test", nullptr) == static_cast<HRESULT>(WBEM_E_NOT_SUPPORTED));
    assert(rejected.releases == 1 && rejected.objectReads == 0 && !g_callTimedOut);

    FakeCallResult missingOutput;
    missingOutput.objectResult = WBEM_E_NOT_FOUND;
    assert(CompleteMethodCall(&missingOutput, "test", &output) == static_cast<HRESULT>(WBEM_E_NOT_FOUND));
    assert(missingOutput.releases == 1 && !g_callTimedOut);

    FakeCallResult timedOut;
    timedOut.waitResult = WBEM_S_TIMEDOUT;
    assert(CompleteMethodCall(&timedOut, "test", nullptr) == static_cast<HRESULT>(WBEM_E_TIMED_OUT));
    assert(timedOut.releases == 1 && g_callTimedOut);
    assert(wmi_init() == -2);

    // Reset private test state only; production exports never clear a timeout.
    g_callTimedOut = false;
    FakeCallResult lostConnection;
    lostConnection.waitResult = RPC_E_DISCONNECTED;
    assert(CompleteMethodCall(&lostConnection, "test", nullptr) == static_cast<HRESULT>(WBEM_E_TIMED_OUT));
    assert(lostConnection.releases == 1 && lostConnection.objectReads == 0 && g_callTimedOut);

    g_callTimedOut = false;
    FakeCallResult providerTimeout;
    providerTimeout.operationResult = WBEM_E_TIMED_OUT;
    assert(CompleteMethodCall(&providerTimeout, "test", nullptr) == static_cast<HRESULT>(WBEM_E_TIMED_OUT));
    assert(providerTimeout.releases == 1 && g_callTimedOut);
    puts("WMI COM completion checks passed");
}
