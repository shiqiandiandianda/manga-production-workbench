"""Defence in depth for synthetic Python tests; not an OS sandbox."""
import os
import builtins
import io
import re
import socket
import subprocess
import sys
import json

_ports = os.environ.get('QUALITY_PORTS_FILE')
if not _ports or not os.environ.get('QUALITY_RUN_DIR'):
    raise RuntimeError('QUALITY_GUARD: missing Python isolation settings')
_roots = tuple(os.path.normcase(os.path.realpath(os.environ[k])) for k in ('QUALITY_STAGE', 'QUALITY_RUN_DIR'))
_read_roots = _roots + tuple(os.path.normcase(os.path.realpath(p)) for p in json.loads(os.environ.get('QUALITY_READ_ROOTS', '[]')) + [sys.base_prefix, sys.prefix])
def _check_read(file):
    if isinstance(file, int):
        return
    target = os.path.normcase(os.path.realpath(os.fsdecode(os.fspath(file))))
    if not any(target == root or target.startswith(root + os.sep) for root in _read_roots):
        raise RuntimeError('QUALITY_GUARD: read outside test directory and declared dependencies ' + target)
def _check_write(file):
    if isinstance(file, int):
        return
    target = os.path.normcase(os.path.realpath(os.fspath(file)))
    if not any(target == root or target.startswith(root + os.sep) for root in _roots):
        raise RuntimeError('QUALITY_GUARD: write outside test directory ' + target)
_open = builtins.open
_io_open = io.open
def _guard_open(file, mode='r', *args, **kwargs):
    if any(flag in mode for flag in ('w', 'a', 'x', '+')):
        _check_write(file)
    else:
        _check_read(file)
    return _open(file, mode, *args, **kwargs)
def _guard_io_open(file, mode='r', *args, **kwargs):
    if any(flag in mode for flag in ('w', 'a', 'x', '+')):
        _check_write(file)
    else:
        _check_read(file)
    return _io_open(file, mode, *args, **kwargs)
builtins.open = _guard_open
io.open = _guard_io_open
_os_open = os.open
def _guard_os_open(file, flags, *args, **kwargs):
    if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
        _check_write(file)
    else:
        _check_read(file)
    return _os_open(file, flags, *args, **kwargs)
os.open = _guard_os_open
for _name in ('listdir', 'scandir'):
    _original = getattr(os, _name)
    def _wrap_read(original):
        def guarded(file='.', *args, **kwargs):
            _check_read(file)
            return original(file, *args, **kwargs)
        return guarded
    setattr(os, _name, _wrap_read(_original))
for _name in ('remove', 'unlink', 'mkdir', 'rmdir', 'chmod'):
    _original = getattr(os, _name)
    def _wrap(original):
        def guarded(file, *args, **kwargs):
            _check_write(file)
            return original(file, *args, **kwargs)
        return guarded
    setattr(os, _name, _wrap(_original))
for _name in ('rename', 'replace'):
    _original = getattr(os, _name)
    def _wrap_pair(original):
        def guarded(source, target, *args, **kwargs):
            _check_write(source)
            _check_write(target)
            return original(source, target, *args, **kwargs)
        return guarded
    setattr(os, _name, _wrap_pair(_original))
_connect = socket.socket.connect
_listen = socket.socket.listen
_bind = socket.socket.bind
_local = ('localhost', '127.0.0.1', '::1')

def _guard_connect(self, address):
    if not isinstance(address, tuple) or address[0] not in _local:
        raise RuntimeError('QUALITY_GUARD: external or named socket blocked')
    try:
        with open(_ports, encoding='utf-8') as f:
            allowed = str(address[1]) in f.read().split()
    except OSError:
        allowed = False
    if not allowed:
        raise RuntimeError('QUALITY_GUARD: unregistered socket blocked')
    return _connect(self, address)

def _guard_bind(self, address):
    if not isinstance(address, tuple) or address[0] not in _local:
        raise RuntimeError('QUALITY_GUARD: server must bind to loopback')
    return _bind(self, address)

def _guard_listen(self, *args):
    result = _listen(self, *args)
    address = self.getsockname()
    with open(_ports, 'a', encoding='utf-8') as f:
        f.write(str(address[1]) + '\n')
    return result

socket.socket.connect = _guard_connect
socket.socket.bind = _guard_bind
socket.socket.listen = _guard_listen
_popen = subprocess.Popen
class _GuardedPopen(_popen):
    def __init__(self, args, *a, **kw):
        command = args[0] if isinstance(args, (tuple, list)) else str(args)
        if re.search(r'(?:^|[\\/\s])(docker|ssh|scp|sudo|su|codex|dreamina|jimeng|powershell|pwsh|cmd)(?:\.exe|\.cmd)?(?:\s|$)', str(command), re.I):
            raise RuntimeError('QUALITY_GUARD: privileged or live CLI blocked')
        super().__init__(args, *a, **kw)
subprocess.Popen = _GuardedPopen
