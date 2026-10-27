"""Read text once with the local Windows Simplified Chinese OCR engine.

No Codex connection or cloud fallback is used. Coordinates always refer to the
unmodified input image, even when a white-backed copy is resized for WinRT.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image

from codex_client import CodexError


MAX_IMAGE_DIMENSION = 2048
ENGINE = 'Windows.Media.Ocr'
LANGUAGE = 'zh-Hans-CN'
_CJK = (r'\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff'
        r'\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65'
        r'\u2014\u2018-\u201f\u2026\U00020000-\U0003134f')
_CJK_SPACES = re.compile(r'(?<=[' + _CJK + r'])[ \t]+(?=[' + _CJK + r'])')


class LocalOCRError(CodexError):
    """Local OCR failed; callers must keep the original image intact."""


class LocalOCRUnavailable(LocalOCRError):
    """Windows PowerShell, WinRT or the fixed Chinese OCR language is absent."""


class LocalOCRCancelled(LocalOCRError):
    pass


class LocalOCRTimeout(LocalOCRError):
    pass


def normalize_text(text: str) -> str:
    """Remove OCR-inserted CJK spaces while retaining English spaces/newlines."""
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    return '\n'.join(_CJK_SPACES.sub('', line).strip() for line in text.split('\n')).strip()


def _check_cancelled(cancelled):
    if cancelled and cancelled():
        raise LocalOCRCancelled('本地文字识别已取消')


def _powershell() -> str:
    if sys.platform != 'win32':
        raise LocalOCRUnavailable('本地中文 OCR 仅支持 Windows，未调用云端识别')
    root = os.environ.get('SystemRoot') or os.environ.get('WINDIR')
    executable = Path(root) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe' if root else None
    if executable and executable.is_file():
        return str(executable)
    installed = shutil.which('powershell.exe')
    if installed:
        return installed
    raise LocalOCRUnavailable('未找到 Windows PowerShell 5，本地文字识别不可用')


def _prepare_image(image_path: Path):
    """Create an atomic, opaque temporary PNG beside the job's input image."""
    staging = target = None
    completed = False
    try:
        with Image.open(image_path) as source:
            original = source.size
            if min(original) <= 0:
                raise LocalOCRError('本地识别图片尺寸无效')
            rgba = source.convert('RGBA')
            try:
                white = Image.new('RGBA', original, (255, 255, 255, 255))
                try:
                    white.alpha_composite(rgba)
                    opaque = white.convert('RGB')
                finally:
                    white.close()
            finally:
                rgba.close()
        try:
            ratio = min(1.0, MAX_IMAGE_DIMENSION / max(original))
            prepared = tuple(max(1, round(value * ratio)) for value in original)
            if opaque.size != prepared:
                resized = opaque.resize(prepared, Image.Resampling.LANCZOS)
                opaque.close()
                opaque = resized
            handle, name = tempfile.mkstemp(prefix='.local-ocr-', suffix='.tmp', dir=image_path.parent)
            os.close(handle)
            staging = Path(name)
            target = staging.with_suffix('.png')
            opaque.save(staging, format='PNG')
            os.replace(staging, target)
            staging = None
            completed = True
            return target, original, prepared
        finally:
            opaque.close()
    except LocalOCRError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise LocalOCRError(f'无法准备本地识别图片：{error}') from error
    finally:
        if staging:
            staging.unlink(missing_ok=True)
        # The successful target is owned by recognize_image until process exit.
        if target and not completed:
            target.unlink(missing_ok=True)


def _stop_process(process):
    if process is not None and process.poll() is None:
        try:
            process.kill()
        except OSError:
            pass
        try:
            process.communicate(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            pass


def _run_recognition(command, cancelled, deadline):
    process = None
    try:
        _check_cancelled(cancelled)
        if time.monotonic() >= deadline:
            raise LocalOCRTimeout('本地文字识别超时，原图未修改')
        try:
            process = subprocess.Popen(
                command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding='utf-8', errors='replace',
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        except OSError as error:
            raise LocalOCRUnavailable(f'无法启动本地中文 OCR：{error}') from error
        while True:
            _check_cancelled(cancelled)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise LocalOCRTimeout('本地文字识别超时，原图未修改')
            try:
                stdout, stderr = process.communicate(timeout=min(0.1, remaining))
                break
            except subprocess.TimeoutExpired:
                continue
        _check_cancelled(cancelled)
        if process.returncode:
            message = '本地中文 OCR 执行失败'
            code = None
            try:
                error = json.loads(stderr.strip().lstrip('\ufeff'))['error']
                if isinstance(error, dict):
                    code = error.get('code')
                    if isinstance(error.get('message'), str):
                        message = error['message'][:600]
            except (ValueError, KeyError, TypeError):
                if stderr.strip():
                    message += '：' + stderr.strip()[:600]
            error_type = LocalOCRUnavailable if process.returncode == 2 or code == 'unavailable' else LocalOCRError
            raise error_type(message)
        try:
            return json.loads(stdout.strip().lstrip('\ufeff'))
        except (ValueError, TypeError) as error:
            raise LocalOCRError('本地 OCR 返回的 JSON 无效') from error
    finally:
        _stop_process(process)
        if process is not None:
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()


def _map_result(value, original, prepared):
    if (not isinstance(value, dict) or value.get('engine') != ENGINE or value.get('language') != LANGUAGE
            or isinstance(value.get('width'), bool) or isinstance(value.get('height'), bool)
            or value.get('width') != prepared[0] or value.get('height') != prepared[1]
            or not isinstance(value.get('lines'), list)):
        raise LocalOCRError('本地 OCR 返回的图片尺寸、引擎或文字结构无效')
    lines = []
    for line in value['lines']:
        if not isinstance(line, dict) or not isinstance(line.get('text'), str) or not isinstance(line.get('words'), list):
            raise LocalOCRError('本地 OCR 返回的行结构无效')
        words = []
        for word in line['words']:
            box = word.get('box') if isinstance(word, dict) else None
            if (not isinstance(word, dict) or not isinstance(word.get('text'), str)
                    or not isinstance(box, list) or len(box) != 4
                    or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in box)):
                raise LocalOCRError('本地 OCR 返回的文字坐标无效')
            x, y, width, height = box
            if (x < -1 or y < -1 or width <= 0 or height <= 0
                    or x + width > prepared[0] + 1 or y + height > prepared[1] + 1):
                raise LocalOCRError('本地 OCR 返回的文字坐标超出图片')
            left, top = max(0, x), max(0, y)
            right, bottom = min(prepared[0], x + width), min(prepared[1], y + height)
            if right <= left or bottom <= top:
                raise LocalOCRError('本地 OCR 返回的文字坐标无效')
            scale_x, scale_y = original[0] / prepared[0], original[1] / prepared[1]
            mapped = [left * scale_x, top * scale_y, (right - left) * scale_x, (bottom - top) * scale_y]
            words.append({'text': normalize_text(word['text']), 'box': [round(n, 4) for n in mapped]})
        lines.append({'text': normalize_text(line['text']), 'words': words})
    return {'engine': ENGINE, 'language': LANGUAGE, 'width': original[0], 'height': original[1],
            'text': '\n'.join(line['text'] for line in lines), 'lines': lines}


def recognize_image(image_path, cancelled=None, timeout=30) -> dict:
    """Return local OCR lines/word boxes in original pixels, or explicitly fail.

    Empty text is a successful result with ``lines=[]``. A caller extracting
    original dialogue must reject it; a caller checking residual text can use it.
    Cancellation is polled during the child process and terminates that process.
    """
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise LocalOCRError('本地 OCR 超时时间必须是正数')
    started = time.monotonic()
    _check_cancelled(cancelled)
    executable = _powershell()
    script = Path(__file__).with_name('windows_ocr.ps1')
    if not script.is_file():
        raise LocalOCRUnavailable('本地中文 OCR 脚本缺失')
    image_path = Path(image_path).resolve()
    if not image_path.is_file():
        raise LocalOCRError('本地识别图片不存在')
    temporary = None
    try:
        temporary, original, prepared = _prepare_image(image_path)
        command = [executable, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                   '-File', str(script), '-ImagePath', str(temporary)]
        value = _run_recognition(command, cancelled, started + timeout)
        result = _map_result(value, original, prepared)
        _check_cancelled(cancelled)
        result['durationMs'] = round((time.monotonic() - started) * 1000, 2)
        return result
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
