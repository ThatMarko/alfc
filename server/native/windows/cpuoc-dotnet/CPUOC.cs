using System;
using System.Runtime.InteropServices;
using System.Threading;
using Intel.Overclocking.SDK.Tuning;

namespace CPUOC
{
    public static class NativeExports
    {
        private static ITuningLibrary? tuning;
        private const uint Pl1Id = 48;
        private const uint Pl2Id = 47;

        [ThreadStatic]
        private static string? lastError;

        [UnmanagedCallersOnly(EntryPoint = "cpuoc_init")]
        public static int CpuocInit()
        {
            try
            {
                tuning = null;
                ITuningLibrary candidate = TuningLibrary.Instance;
                if (!candidate.InitializeCheck())
                {
                    throw new InvalidOperationException("Intel XTU initialization was rejected.");
                }
                if (!candidate.IsControlTunable(Pl1Id) || !candidate.IsControlTunable(Pl2Id))
                {
                    throw new NotSupportedException("Intel XTU does not support both package power limits.");
                }
                tuning = candidate;
                lastError = null;
                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        // Calls run on the dedicated Bun hardware worker, preserving SDK thread
        // affinity and keeping these settling delays off the server event loop.
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
                if (!double.IsFinite(pl1) || !double.IsFinite(pl2) ||
                    pl1 != Math.Truncate(pl1) || pl2 != Math.Truncate(pl2) ||
                    pl1 < 0 || pl1 > 200 || pl2 < 0 || pl2 > 200)
                {
                    throw new ArgumentOutOfRangeException(nameof(pl1), "Power limits must be integers between 0 and 200 watts.");
                }
                var previousPl1 = tuning.GetTuningControlByID(Pl1Id);
                var previousPl2 = tuning.GetTuningControlByID(Pl2Id);
                try
                {
                    ApplyLimit(Pl1Id, (decimal)pl1);
                    ApplyLimit(Pl2Id, (decimal)pl2);
                    if (tuning.GetTuningControlByID(Pl1Id) != (decimal)pl1 ||
                        tuning.GetTuningControlByID(Pl2Id) != (decimal)pl2)
                    {
                        throw new InvalidOperationException("Intel XTU did not apply the requested power limits.");
                    }
                }
                catch (Exception applyError)
                {
                    Exception? restoreError = null;
                    try { ApplyLimit(Pl1Id, previousPl1); }
                    catch (Exception ex) { restoreError = ex; }
                    try { ApplyLimit(Pl2Id, previousPl2); }
                    catch (Exception ex) { restoreError = restoreError == null ? ex : new AggregateException(restoreError, ex); }
                    try
                    {
                        if (tuning.GetTuningControlByID(Pl1Id) != previousPl1 ||
                            tuning.GetTuningControlByID(Pl2Id) != previousPl2)
                        {
                            throw new InvalidOperationException("Intel XTU did not restore the previous power limits.");
                        }
                    }
                    catch (Exception ex) { restoreError = restoreError == null ? ex : new AggregateException(restoreError, ex); }
                    if (restoreError != null)
                    {
                        lastError = new AggregateException("CPU tuning failed and previous limits could not be fully restored.", applyError, restoreError).ToString();
                    }
                    else
                    {
                        lastError = applyError.ToString();
                    }
                    return -1;
                }
                lastError = null;
                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
        }

        private static void ApplyLimit(uint id, decimal value)
        {
            if (tuning == null || !tuning.Tune(id, value, false))
            {
                throw new InvalidOperationException($"Intel XTU rejected power limit {id} = {value}.");
            }
            Thread.Sleep(500);
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
