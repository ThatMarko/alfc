using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Management.Infrastructure;
using Microsoft.Management.Infrastructure.Options;

namespace WmiAPI
{
    // Source generators for System.Text.Json AOT compatibility
    [JsonSerializable(typeof(Dictionary<string, JsonElement>))]
    [JsonSerializable(typeof(List<double>))]
    internal partial class WmiJsonContext : JsonSerializerContext { }

    public static class NativeExports
    {
        private static CimSession? session;
        private static CimInstance? wmiGetInstance;
        private static CimInstance? wmiSetInstance;

        private const string WmiNamespace = @"root\WMI";
        private const string GetClassName = "GB_WMIACPI_Get";
        private const string SetClassName = "GB_WMIACPI_Set";

        [ThreadStatic]
        private static string? lastError;

        [UnmanagedCallersOnly(EntryPoint = "wmi_init")]
        public static int WmiInit()
        {
            try
            {
                var options = new DComSessionOptions
                {
                    Impersonation = ImpersonationType.Impersonate
                };

                session = CimSession.Create(null, options);

                wmiGetInstance = session
                    .EnumerateInstances(WmiNamespace, GetClassName)
                    .FirstOrDefault();

                wmiSetInstance = session
                    .EnumerateInstances(WmiNamespace, SetClassName)
                    .FirstOrDefault();

                if (wmiGetInstance == null || wmiSetInstance == null)
                {
                    lastError = "Failed to get CIM instances for GB_WMIACPI";
                    session.Dispose();
                    session = null;
                    return -1;
                }

                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        // Caller MUST free returned pointer with free_string()
        [UnmanagedCallersOnly(EntryPoint = "wmi_get")]
        public static IntPtr WmiGet(IntPtr methodNamePtr, IntPtr argsJsonPtr)
        {
            try
            {
                if (session == null || wmiGetInstance == null)
                {
                    lastError = "WMI not initialized. Call wmi_init() first.";
                    return IntPtr.Zero;
                }

                string methodName = Marshal.PtrToStringUTF8(methodNamePtr)!;

                CimMethodParametersCollection? methodParameters = null;
                if (argsJsonPtr != IntPtr.Zero)
                {
                    string argsJson = Marshal.PtrToStringUTF8(argsJsonPtr)!;
                    var args = JsonSerializer.Deserialize(argsJson, WmiJsonContext.Default.DictionaryStringJsonElement);
                    if (args != null)
                    {
                        methodParameters = new CimMethodParametersCollection();
                        foreach (var kvp in args)
                        {
                            methodParameters.Add(
                                CimMethodParameter.Create(kvp.Key, kvp.Value.GetInt32(), CimType.UInt32, CimFlags.In));
                        }
                    }
                }

                CimMethodResult result = session.InvokeMethod(wmiGetInstance, methodName, methodParameters);

                // Collect all output values — matches old System.Management behavior
                // where result.Properties included ReturnValue + all out-parameters
                var ret = new List<double>();
                if (result.ReturnValue != null)
                {
                    ret.Add(Convert.ToDouble(result.ReturnValue.Value));
                }
                if (result.OutParameters != null)
                {
                    foreach (CimMethodParameter param in result.OutParameters)
                    {
                        ret.Add(Convert.ToDouble(param.Value));
                    }
                }

                string resultJson = JsonSerializer.Serialize(ret, WmiJsonContext.Default.ListDouble);
                return Marshal.StringToCoTaskMemUTF8(resultJson);
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return IntPtr.Zero;
            }
        }

        [UnmanagedCallersOnly(EntryPoint = "wmi_set")]
        public static int WmiSet(IntPtr methodNamePtr, IntPtr argsJsonPtr)
        {
            try
            {
                if (session == null || wmiSetInstance == null)
                {
                    lastError = "WMI not initialized. Call wmi_init() first.";
                    return -1;
                }

                string methodName = Marshal.PtrToStringUTF8(methodNamePtr)!;

                CimMethodParametersCollection? methodParameters = null;
                if (argsJsonPtr != IntPtr.Zero)
                {
                    string argsJson = Marshal.PtrToStringUTF8(argsJsonPtr)!;
                    var args = JsonSerializer.Deserialize(argsJson, WmiJsonContext.Default.DictionaryStringJsonElement);
                    if (args != null)
                    {
                        methodParameters = new CimMethodParametersCollection();
                        foreach (var kvp in args)
                        {
                            methodParameters.Add(
                                CimMethodParameter.Create(kvp.Key, kvp.Value.GetInt32(), CimType.UInt32, CimFlags.In));
                        }
                    }
                }

                session.InvokeMethod(wmiSetInstance, methodName, methodParameters);
                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        [UnmanagedCallersOnly(EntryPoint = "free_string")]
        public static void FreeString(IntPtr ptr)
        {
            if (ptr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(ptr);
            }
        }

        // Caller MUST free returned pointer with free_string()
        [UnmanagedCallersOnly(EntryPoint = "get_last_error")]
        public static IntPtr GetLastError()
        {
            return Marshal.StringToCoTaskMemUTF8(lastError ?? "Unknown error");
        }
    }
}
