"""Acquire proof before running an existing repair pipeline; no AI protocol changes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class SlotError(RuntimeError):
    pass


def call(origin: str, token: str, action: str, payload: dict):
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise SlotError('统一生成队列地址无效，未启动生成')
    request = urllib.request.Request(origin.rstrip('/') + '/api/generation-slots/' + action,
        data=json.dumps(payload).encode('utf-8'), method='POST',
        headers={'Content-Type':'application/json', 'Authorization':'Bearer ' + token})
    try:
        # Bypass OS HTTP proxies for a fixed loopback-only address.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SlotError('统一生成队列身份已结束或不匹配，未启动新的生成') from None
    except Exception:
        raise SlotError('无法连接统一生成队列，未启动新的生成') from None


def run(pipeline: Path, arguments: list[str]):
    origin = os.environ.pop('COMIC_GENERATION_SLOT_ORIGIN', '')
    token = os.environ.pop('COMIC_GENERATION_SLOT_TOKEN', '')
    if len(token) != 64 or any(char not in '0123456789abcdef' for char in token):
        raise SlotError('缺少统一生成队列身份，未启动生成')
    # Claim is one-use per attempt: two wrappers with the same token cannot both
    # call turn/start. Register this detached Python before importing pipeline.
    call(origin, token, 'claim', {'pid':os.getpid()})
    children = []
    original_popen = subprocess.Popen

    def tracked_popen(*args, **kwargs):
        child = original_popen(*args, **kwargs)
        children.append(child)
        try:
            # app-server is idle at this point; no stdin has been sent yet.
            call(origin, token, 'track', {'pid':child.pid})
        except Exception:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            raise
        return child

    subprocess.Popen = tracked_popen
    previous_argv = sys.argv
    sys.argv = [str(pipeline), *arguments]
    try:
        runpy.run_path(str(pipeline), run_name='__main__')
    finally:
        sys.argv = previous_argv
        subprocess.Popen = original_popen
        all_stopped = True
        for child in children:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        all_stopped = False
        try:
            # The wrapper itself is about to exit, and every tracked app-server
            # is confirmed stopped. A lost callback leaves a safe stale lease.
            call(origin, token, 'release', {'completed':all_stopped})
        except SlotError:
            pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pipeline', required=True, type=Path)
    options, arguments = parser.parse_known_args()
    try:
        run(options.pipeline.resolve(strict=True), arguments)
    except SlotError as error:
        # Never print bearer credentials, URLs containing them, or response bodies.
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
