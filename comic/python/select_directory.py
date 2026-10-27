"""Windows folder picker. Returns one directory path without reading assets."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
import sys


class BrowseInfo(ctypes.Structure):
    _fields_ = [('hwndOwner', wintypes.HWND), ('pidlRoot', ctypes.c_void_p),
                ('pszDisplayName', wintypes.LPWSTR), ('lpszTitle', wintypes.LPCWSTR),
                ('ulFlags', wintypes.UINT), ('lpfn', ctypes.c_void_p),
                ('lParam', ctypes.c_ssize_t), ('iImage', ctypes.c_int)]


def select_directory():
    ole = ctypes.WinDLL('ole32', use_last_error=True)
    shell = ctypes.WinDLL('shell32', use_last_error=True)
    user = ctypes.WinDLL('user32', use_last_error=True)
    ole.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole.CoInitializeEx.restype = ctypes.c_long
    initialized = ole.CoInitializeEx(None, 2)
    ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    shell.SHBrowseForFolderW.argtypes = [ctypes.POINTER(BrowseInfo)]
    shell.SHBrowseForFolderW.restype = ctypes.c_void_p
    shell.SHGetPathFromIDListEx.argtypes = [ctypes.c_void_p, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    shell.SHGetPathFromIDListEx.restype = wintypes.BOOL
    user.GetForegroundWindow.restype = wintypes.HWND
    display = ctypes.create_unicode_buffer(32768)
    options = BrowseInfo()
    options.hwndOwner = user.GetForegroundWindow()
    options.pszDisplayName = ctypes.cast(display, wintypes.LPWSTR)
    options.lpszTitle = '选择资产目录 · 包含子目录'
    options.ulFlags = 0x1 | 0x40
    item = None
    try:
        item = shell.SHBrowseForFolderW(ctypes.byref(options))
        if not item:
            return None
        target = ctypes.create_unicode_buffer(32768)
        if not shell.SHGetPathFromIDListEx(item, target, len(target), 0):
            raise OSError('请选择可读取的本地或共享目录')
        return target.value
    finally:
        if item:
            ole.CoTaskMemFree(item)
        if initialized >= 0:
            ole.CoUninitialize()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if os.name != 'nt':
        raise RuntimeError('请在 Windows 选择目录，或粘贴目录路径')
    if args.check:
        assert ctypes.sizeof(BrowseInfo) == (64 if ctypes.sizeof(ctypes.c_void_p) == 8 else 32)
        options = BrowseInfo()
        display = ctypes.create_unicode_buffer(32768)
        options.pszDisplayName = ctypes.cast(display, wintypes.LPWSTR)
        assert options.pszDisplayName == ''
        print('Windows 目录选择接口结构正常。')
    else:
        print(json.dumps(select_directory(), ensure_ascii=True))
