const WIN_BUILTIN_ADMINISTRATORS_SID = 26;
const SECURITY_MAX_SID_SIZE = 68;

export async function isElevated(): Promise<boolean> {
  if (process.platform !== "win32") return process.getuid?.() === 0;

  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const library = dlopen("Advapi32.dll", {
    CreateWellKnownSid: {
      args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    CheckTokenMembership: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  });

  try {
    const sid = new Uint8Array(SECURITY_MAX_SID_SIZE);
    const sidSize = new Uint32Array([sid.byteLength]);
    const isMember = new Int32Array(1);
    if (
      library.symbols.CreateWellKnownSid(
        WIN_BUILTIN_ADMINISTRATORS_SID,
        null,
        ptr(sid),
        ptr(sidSize),
      ) === 0
    ) {
      return false;
    }

    // A null token checks the current effective token. A filtered UAC token's
    // deny-only Administrators SID does not count as enabled membership.
    // https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-checktokenmembership
    return (
      library.symbols.CheckTokenMembership(null, ptr(sid), ptr(isMember)) !==
        0 && isMember[0] !== 0
    );
  } finally {
    library.close();
  }
}
