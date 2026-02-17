using System;
using System.Runtime.InteropServices;
using System.Threading;
using Intel.Overclocking.SDK.Tuning;

namespace CPUOC
{
    public static class NativeExports
    {
        private static ITuningLibrary? tuning;
        private static uint pl1id = 48;
        private static uint pl2id = 47;

        [ThreadStatic]
        private static string? lastError;

        [UnmanagedCallersOnly(EntryPoint = "cpuoc_init")]
        public static int CpuocInit()
        {
            try
            {
                tuning = TuningLibrary.Instance;
                tuning.InitializeCheck();
                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        // 500ms delays between tuning calls match Gigabyte's implementation to prevent API hammering
        [UnmanagedCallersOnly(EntryPoint = "cpuoc_tune")]
        public static int CpuocTune(double pl1, double pl2)
        {
            try
            {
                if (tuning == null)
                {
                    lastError = "CPUOC not initialized. Call cpuoc_init() first.";
                    return -1;
                }

                tuning.Tune(pl1id, (decimal)pl1, false);
                Thread.Sleep(500);
                tuning.Tune(pl2id, (decimal)pl2, false);
                Thread.Sleep(500);

                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        // Caller MUST free returned pointer with cpuoc_free_string()
        [UnmanagedCallersOnly(EntryPoint = "cpuoc_get_last_error")]
        public static IntPtr CpuocGetLastError()
        {
            return Marshal.StringToCoTaskMemUTF8(lastError ?? "Unknown error");
        }

        [UnmanagedCallersOnly(EntryPoint = "cpuoc_free_string")]
        public static void CpuocFreeString(IntPtr ptr)
        {
            if (ptr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(ptr);
            }
        }
    }
}
