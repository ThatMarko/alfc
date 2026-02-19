using System;
using System.Collections.Generic;
using System.IO;
using System.Management;
using System.Text;
using System.Web.Script.Serialization;

namespace WmiAPI
{
    class Program
    {
        private static ManagementObject wmiGetObject;
        private static ManagementObject wmiSetObject;
        private static ManagementClass wmiGetClass;
        private static ManagementClass wmiSetClass;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        static void Main()
        {
            Console.CancelKeyPress += (sender, e) => { e.Cancel = true; };

            Console.InputEncoding = Encoding.UTF8;
            var writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            Console.SetOut(writer);

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                Dictionary<string, object> response;
                try
                {
                    var request = Json.Deserialize<Dictionary<string, object>>(line);
                    if (request == null)
                    {
                        response = ErrorResponse("Failed to parse request");
                    }
                    else
                    {
                        var cmd = (string)request["cmd"];
                        switch (cmd)
                        {
                            case "init":
                                response = HandleInit();
                                break;
                            case "get":
                                response = HandleGet(
                                    (string)request["method"],
                                    request.ContainsKey("args") ? request["args"] as Dictionary<string, object> : null
                                );
                                break;
                            case "set":
                                response = HandleSet(
                                    (string)request["method"],
                                    request.ContainsKey("args") ? request["args"] as Dictionary<string, object> : null
                                );
                                break;
                            default:
                                response = ErrorResponse("Unknown command: " + cmd);
                                break;
                        }
                    }
                }
                catch (Exception ex)
                {
                    response = ErrorResponse(ex.ToString());
                }

                Console.WriteLine(Json.Serialize(response));
            }
        }

        private static Dictionary<string, object> OkResponse()
        {
            return new Dictionary<string, object> { { "ok", true } };
        }

        private static Dictionary<string, object> OkResponse(List<double> data)
        {
            return new Dictionary<string, object> { { "ok", true }, { "data", data } };
        }

        private static Dictionary<string, object> ErrorResponse(string error)
        {
            return new Dictionary<string, object> { { "ok", false }, { "error", error } };
        }

        private static Dictionary<string, object> HandleInit()
        {
            var getTuple = GetWmiClassAndObject("GB_WMIACPI_Get");
            var setTuple = GetWmiClassAndObject("GB_WMIACPI_Set");

            if (getTuple == null || setTuple == null)
            {
                return ErrorResponse("Failed to get WMI class/object instances for GB_WMIACPI");
            }

            wmiGetClass = getTuple.Item1;
            wmiGetObject = getTuple.Item2;
            wmiSetClass = setTuple.Item1;
            wmiSetObject = setTuple.Item2;

            return OkResponse();
        }

        private static Dictionary<string, object> HandleGet(string methodName, Dictionary<string, object> args)
        {
            if (wmiGetObject == null || wmiGetClass == null)
            {
                return ErrorResponse("WMI not initialized");
            }

            ManagementBaseObject methodParameters = null;
            if (args != null)
            {
                methodParameters = wmiGetClass.GetMethodParameters(methodName);
                foreach (var kvp in args)
                {
                    methodParameters[kvp.Key] = Convert.ToInt32(kvp.Value);
                }
            }

            ManagementBaseObject result = wmiGetObject.InvokeMethod(methodName, methodParameters, null);

            var ret = new List<double>();
            foreach (PropertyData property in result.Properties)
            {
                ret.Add(Convert.ToDouble(property.Value));
            }

            return OkResponse(ret);
        }

        private static Dictionary<string, object> HandleSet(string methodName, Dictionary<string, object> args)
        {
            if (wmiSetObject == null || wmiSetClass == null)
            {
                return ErrorResponse("WMI not initialized");
            }

            ManagementBaseObject methodParameters = null;
            if (args != null)
            {
                methodParameters = wmiSetClass.GetMethodParameters(methodName);
                foreach (var kvp in args)
                {
                    methodParameters[kvp.Key] = Convert.ToInt32(kvp.Value);
                }
            }

            wmiSetObject.InvokeMethod(methodName, methodParameters, null);

            return OkResponse();
        }

        private static Tuple<ManagementClass, ManagementObject> GetWmiClassAndObject(string className)
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
