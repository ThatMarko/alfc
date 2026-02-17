using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WmiAPI
{
    // Source generators for System.Text.Json AOT compatibility
    [JsonSerializable(typeof(Dictionary<string, JsonElement>))]
    [JsonSerializable(typeof(List<double>))]
    internal partial class WmiJsonContext : JsonSerializerContext { }

    public static class NativeExports
    {
        private static ManagementObject? wmiGetObject;
        private static ManagementObject? wmiSetObject;
        private static ManagementClass? wmiGetClass;
        private static ManagementClass? wmiSetClass;

        [ThreadStatic]
        private static string? lastError;

        [UnmanagedCallersOnly(EntryPoint = "wmi_init")]
        public static int WmiInit()
        {
            try
            {
                var getTuple = GetWmiClassAndObject("GB_WMIACPI_Get");
                var setTuple = GetWmiClassAndObject("GB_WMIACPI_Set");

                if (getTuple == null || setTuple == null)
                {
                    lastError = "Failed to get WMI class/object instances for GB_WMIACPI";
                    return -1;
                }

                wmiGetClass = getTuple.Item1;
                wmiGetObject = getTuple.Item2;
                wmiSetClass = setTuple.Item1;
                wmiSetObject = setTuple.Item2;

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
                if (wmiGetObject == null || wmiGetClass == null)
                {
                    lastError = "WMI not initialized. Call wmi_init() first.";
                    return IntPtr.Zero;
                }

                string methodName = Marshal.PtrToStringUTF8(methodNamePtr)!;

                ManagementBaseObject? methodParameters = null;
                if (argsJsonPtr != IntPtr.Zero)
                {
                    string argsJson = Marshal.PtrToStringUTF8(argsJsonPtr)!;
                    var args = JsonSerializer.Deserialize(argsJson, WmiJsonContext.Default.DictionaryStringJsonElement);
                    if (args != null)
                    {
                        methodParameters = wmiGetClass.GetMethodParameters(methodName);
                        foreach (var kvp in args)
                        {
                            methodParameters[kvp.Key] = kvp.Value.GetInt32();
                        }
                    }
                }

                ManagementBaseObject result = wmiGetObject.InvokeMethod(methodName, methodParameters, null);

                PropertyDataCollection properties = result.Properties;
                var ret = new List<double>();
                foreach (PropertyData property in properties)
                {
                    ret.Add(Convert.ToDouble(property.Value));
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
                if (wmiSetObject == null || wmiSetClass == null)
                {
                    lastError = "WMI not initialized. Call wmi_init() first.";
                    return -1;
                }

                string methodName = Marshal.PtrToStringUTF8(methodNamePtr)!;

                ManagementBaseObject? methodParameters = null;
                if (argsJsonPtr != IntPtr.Zero)
                {
                    string argsJson = Marshal.PtrToStringUTF8(argsJsonPtr)!;
                    var args = JsonSerializer.Deserialize(argsJson, WmiJsonContext.Default.DictionaryStringJsonElement);
                    if (args != null)
                    {
                        methodParameters = wmiSetClass.GetMethodParameters(methodName);
                        foreach (var kvp in args)
                        {
                            methodParameters[kvp.Key] = kvp.Value.GetInt32();
                        }
                    }
                }

                wmiSetObject.InvokeMethod(methodName, methodParameters, null);
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

        private static Tuple<ManagementClass, ManagementObject>? GetWmiClassAndObject(string className)
        {
            ManagementScope scope = new ManagementScope("root\\WMI", new ConnectionOptions
            {
                EnablePrivileges = true,
                Impersonation = ImpersonationLevel.Impersonate
            });
            ManagementPath path = new ManagementPath(className);
            ManagementClass wmiClass = new ManagementClass(scope, path, null);
            var enumerator = wmiClass.GetInstances().GetEnumerator();

            if (enumerator.MoveNext())
            {
                return new Tuple<ManagementClass, ManagementObject>(wmiClass, (ManagementObject)enumerator.Current);
            }

            return null;
        }
    }
}
