"""Read-only Windows commit headroom, without spawning PowerShell or changing system settings."""
import ctypes
import os

def available_commit_mb():
    if os.name != 'nt':
        return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ('totalPhys', 'availPhys', 'totalPage', 'availPage', 'totalVirtual', 'availVirtual', 'availExtended')]
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    return round(status.availPage / 1024 / 1024)

if __name__ == '__main__':
    print(available_commit_mb())
