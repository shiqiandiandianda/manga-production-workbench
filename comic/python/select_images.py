"""Windows image file picker; returns paths only, never reads or copies pixels."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
import sys


class OpenFileName(ctypes.Structure):
    _fields_ = [
        ('lStructSize', wintypes.DWORD), ('hwndOwner', wintypes.HWND),
        ('hInstance', wintypes.HINSTANCE), ('lpstrFilter', wintypes.LPCWSTR),
        ('lpstrCustomFilter', wintypes.LPWSTR), ('nMaxCustFilter', wintypes.DWORD),
        ('nFilterIndex', wintypes.DWORD), ('lpstrFile', wintypes.LPWSTR),
        ('nMaxFile', wintypes.DWORD), ('lpstrFileTitle', wintypes.LPWSTR),
        ('nMaxFileTitle', wintypes.DWORD), ('lpstrInitialDir', wintypes.LPCWSTR),
        ('lpstrTitle', wintypes.LPCWSTR), ('Flags', wintypes.DWORD),
        ('nFileOffset', wintypes.WORD), ('nFileExtension', wintypes.WORD),
        ('lpstrDefExt', wintypes.LPCWSTR), ('lCustData', ctypes.c_ssize_t),
        ('lpfnHook', ctypes.c_void_p), ('lpTemplateName', wintypes.LPCWSTR),
        ('pvReserved', ctypes.c_void_p), ('dwReserved', wintypes.DWORD),
        ('FlagsEx', wintypes.DWORD),
    ]


def selected_paths(raw):
    parts = raw.split('\0\0', 1)[0].split('\0')
    if not parts or not parts[0]:
        return []
    if len(parts) == 1:
        return parts
    return [os.path.join(parts[0], name) for name in parts[1:] if name]


def select_images(multiple=False):
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    comdlg = ctypes.WinDLL('comdlg32', use_last_error=True)
    comdlg.GetOpenFileNameW.argtypes = [ctypes.POINTER(OpenFileName)]
    comdlg.GetOpenFileNameW.restype = wintypes.BOOL
    comdlg.CommDlgExtendedError.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    options = OpenFileName()
    options.lStructSize = ctypes.sizeof(options)
    options.hwndOwner = user32.GetForegroundWindow()
    options.lpstrFilter = '图片 (*.png;*.jpg;*.jpeg;*.webp)\0*.png;*.jpg;*.jpeg;*.webp\0\0'
    options.nFilterIndex = 1
    options.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    options.nMaxFile = len(buffer)
    options.lpstrTitle = '选择本地图片 · 只登记路径'
    # Explorer dialog, existing file/path, resize, and no working-directory change.
    options.Flags = 0x80000 | 0x1000 | 0x800 | 0x800000 | 0x8
    if multiple:
        options.Flags |= 0x200
    if not comdlg.GetOpenFileNameW(ctypes.byref(options)):
        error = comdlg.CommDlgExtendedError()
        if error:
            raise OSError('图片选择窗口未完成：' + hex(error))
        return []
    return selected_paths(buffer[:])


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser()
    parser.add_argument('--multiple', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if os.name != 'nt':
        raise RuntimeError('请在 Windows 使用文件选择，或粘贴图片路径')
    if args.check:
        assert ctypes.sizeof(OpenFileName) == (152 if ctypes.sizeof(ctypes.c_void_p) == 8 else 88)
        assert selected_paths('K:\\素材\0角色 一.png\0参考.png\0\0') == ['K:\\素材\\角色 一.png', 'K:\\素材\\参考.png']
        print('Windows 文件选择接口与中文路径解析正常。')
    else:
        print(json.dumps(select_images(args.multiple), ensure_ascii=True))
