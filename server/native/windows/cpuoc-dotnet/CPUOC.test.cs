using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using CPUOC;

// A deterministic SDK substitute exercises the real unmanaged exports without
// requiring Intel XTU, Windows, or laptop hardware. The production project only
// includes CPUOC.cs and references the actual shipped SDK assembly.
namespace Intel.Overclocking.SDK.Tuning
{
    public interface ITuningLibrary
    {
        bool InitializeCheck();
        bool IsControlTunableRealTime(uint id);
        decimal GetTuningControlByID(uint id);
        bool Tune(uint id, decimal value, bool forceReboot);
    }

    public sealed class TuningLibrary : ITuningLibrary
    {
        public static TuningLibrary Instance { get; set; } = new TuningLibrary();
        public bool InitializeResult = true;
        public bool Tunable = true;
        public bool RequiresReboot;
        public bool FailPl2Once;
        public bool ClampPl1Once;
        public bool RejectRestoration;
        public bool MutateBeforePl2Failure;
        public int Calls;
        public readonly Dictionary<uint, decimal> Values = new Dictionary<uint, decimal> { [48] = 45m, [47] = 95m };
        public bool InitializeCheck() => InitializeResult;
        public bool IsControlTunableRealTime(uint id) => Tunable && !RequiresReboot;
        public decimal GetTuningControlByID(uint id) => Values[id];
        public bool Tune(uint id, decimal value, bool forceReboot)
        {
            Calls++;
            if (RejectRestoration && id == 48 && value == 45m) return false;
            if (id == 47 && FailPl2Once) {
                FailPl2Once = false;
                if (MutateBeforePl2Failure) Values[id] = value;
                return false;
            }
            if (id == 48 && ClampPl1Once) { ClampPl1Once = false; Values[id] = 30m; return true; }
            Values[id] = value;
            return true;
        }
    }
}

internal static unsafe class Program
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Main()
    {
        delegate* unmanaged<int> init = &NativeExports.CpuocInit;
        delegate* unmanaged<double, double, int> tune = &NativeExports.CpuocTune;
        delegate* unmanaged<IntPtr> getError = &NativeExports.CpuocGetLastError;
        delegate* unmanaged<IntPtr, void> freeError = &NativeExports.CpuocFreeString;

        var sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { InitializeResult = false };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == -1, "InitializeCheck false must fail");
        Check(tune(37, 106) == -1 && sdk.Calls == 0, "Failed initialization must not allow tuning");
        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { Tunable = false };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == -1, "Unsupported power controls must fail initialization");

        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { RequiresReboot = true };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == -1, "Power controls requiring a reboot cannot support live tuning");

        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary();
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == 0, "Supported SDK should initialize");
        Check(tune(double.NaN, 106) == -1 && sdk.Calls == 0, "Invalid limits must not call the SDK");
        Check(tune(37, 106) == 0, "Supported tune should succeed");
        Check(sdk.Values[48] == 37m && sdk.Values[47] == 106m, "Both requested limits must apply");

        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { FailPl2Once = true };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == 0 && tune(37, 106) == -1, "Tune false must fail");
        Check(sdk.Values[48] == 45m && sdk.Values[47] == 95m, "Partial writes must restore both limits");
        var pointer = getError();
        Check(Marshal.PtrToStringUTF8(pointer)?.Contains("rejected") == true, "Native error must describe rejected hardware tuning");
        freeError(pointer);

        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { ClampPl1Once = true };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == 0 && tune(37, 106) == -1, "Readback mismatch must fail");
        Check(sdk.Values[48] == 45m && sdk.Values[47] == 95m, "Readback mismatch must restore both limits");

        sdk = new Intel.Overclocking.SDK.Tuning.TuningLibrary { FailPl2Once = true, RejectRestoration = true, MutateBeforePl2Failure = true };
        Intel.Overclocking.SDK.Tuning.TuningLibrary.Instance = sdk;
        Check(init() == 0 && tune(37, 106) == -2, "A failed rollback must require a process restart");
        Check(sdk.Values[47] == 95m, "Restoring the second limit must still be attempted when restoring the first fails");
        var callsAfterFailure = sdk.Calls;
        Check(tune(40, 100) == -2 && sdk.Calls == callsAfterFailure, "Uncertain hardware state must reject subsequent tuning");
        Check(init() == -2, "Initialization cannot clear a failed rollback");
        pointer = getError();
        Check(Marshal.PtrToStringUTF8(pointer)?.Contains("Restart ALFC") == true, "Restart requirement must be clear at the native boundary");
        freeError(pointer);
        Console.WriteLine("CPUOC native export tests passed");
    }
}
