using System;
using System.Collections.Generic;
using System.IO;
using System.Management;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WmiAPI
{
    internal class Request
    {
        [JsonPropertyName("cmd")]
        public string Cmd { get; set; } = "";

        [JsonPropertyName("method")]
        public string? Method { get; set; }

        [JsonPropertyName("args")]
        public Dictionary<string, JsonElement>? Args { get; set; }
    }

    internal class Response
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("data")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<double>? Data { get; set; }

        [JsonPropertyName("error")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Error { get; set; }
    }

    [JsonSerializable(typeof(Request))]
    [JsonSerializable(typeof(Response))]
    [JsonSerializable(typeof(Dictionary<string, JsonElement>))]
    [JsonSerializable(typeof(List<double>))]
    internal partial class WmiJsonContext : JsonSerializerContext { }

    class Program
    {
        private static ManagementObject? wmiGetObject;
        private static ManagementObject? wmiSetObject;
        private static ManagementClass? wmiGetClass;
        private static ManagementClass? wmiSetClass;

        static void Main()
        {
            Console.InputEncoding = Encoding.UTF8;
            var writer = new StreamWriter(Console.OpenStandardOutput(), Encoding.UTF8) { AutoFlush = true };
            Console.SetOut(writer);

            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                Response response;
                try
                {
                    var request = JsonSerializer.Deserialize(line, WmiJsonContext.Default.Request);
                    if (request == null)
                    {
                        response = new Response { Ok = false, Error = "Failed to parse request" };
                    }
                    else
                    {
                        response = request.Cmd switch
                        {
                            "init" => HandleInit(),
                            "get" => HandleGet(request.Method!, request.Args),
                            "set" => HandleSet(request.Method!, request.Args),
                            _ => new Response { Ok = false, Error = $"Unknown command: {request.Cmd}" }
                        };
                    }
                }
                catch (Exception ex)
                {
                    response = new Response { Ok = false, Error = ex.ToString() };
                }

                Console.WriteLine(JsonSerializer.Serialize(response, WmiJsonContext.Default.Response));
            }
        }

        private static Response HandleInit()
        {
            var getTuple = GetWmiClassAndObject("GB_WMIACPI_Get");
            var setTuple = GetWmiClassAndObject("GB_WMIACPI_Set");

            if (getTuple == null || setTuple == null)
            {
                return new Response { Ok = false, Error = "Failed to get WMI class/object instances for GB_WMIACPI" };
            }

            wmiGetClass = getTuple.Item1;
            wmiGetObject = getTuple.Item2;
            wmiSetClass = setTuple.Item1;
            wmiSetObject = setTuple.Item2;

            return new Response { Ok = true };
        }

        private static Response HandleGet(string methodName, Dictionary<string, JsonElement>? args)
        {
            if (wmiGetObject == null || wmiGetClass == null)
            {
                return new Response { Ok = false, Error = "WMI not initialized" };
            }

            ManagementBaseObject? methodParameters = null;
            if (args != null)
            {
                methodParameters = wmiGetClass.GetMethodParameters(methodName);
                foreach (var kvp in args)
                {
                    methodParameters[kvp.Key] = kvp.Value.GetInt32();
                }
            }

            ManagementBaseObject result = wmiGetObject.InvokeMethod(methodName, methodParameters, null);

            var ret = new List<double>();
            foreach (PropertyData property in result.Properties)
            {
                ret.Add(Convert.ToDouble(property.Value));
            }

            return new Response { Ok = true, Data = ret };
        }

        private static Response HandleSet(string methodName, Dictionary<string, JsonElement>? args)
        {
            if (wmiSetObject == null || wmiSetClass == null)
            {
                return new Response { Ok = false, Error = "WMI not initialized" };
            }

            ManagementBaseObject? methodParameters = null;
            if (args != null)
            {
                methodParameters = wmiSetClass.GetMethodParameters(methodName);
                foreach (var kvp in args)
                {
                    methodParameters[kvp.Key] = kvp.Value.GetInt32();
                }
            }

            wmiSetObject.InvokeMethod(methodName, methodParameters, null);

            return new Response { Ok = true };
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
