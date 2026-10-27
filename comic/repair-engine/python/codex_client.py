"""Small stdlib client for the installed Codex app-server JSONL protocol."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time

# Alias the same OpenAI Responses provider only inside this image worker.
# Built-in provider IDs cannot be overridden in CLI 0.160.0. Keeping name,
# ChatGPT authentication, and default endpoint while disabling WebSockets
# avoids the repeated 15s handshake retries; TLS and SSE remain unchanged.
WORKBENCH_HTTP_PROVIDER = 'model_providers.workbench-http={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}'


class CodexError(RuntimeError):
    pass


class CodexRequestError(CodexError):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class CodexApprovalRequired(CodexError):
    pass


def find_codex() -> str:
    explicit = os.environ.get('IMAGE_REPAIR_CODEX')
    if explicit:
        executable = Path(explicit).resolve()
        if not executable.is_file():
            raise CodexError('IMAGE_REPAIR_CODEX 指向的 Codex 程序不存在')
        return str(executable)
    installed = shutil.which('codex')
    if installed:
        return installed
    bundled = Path(os.environ.get('LOCALAPPDATA', '')) / 'OpenAI' / 'Codex' / 'bin'
    candidates = list(bundled.glob('*/codex.exe'))
    if candidates:
        return str(max(candidates, key=lambda p: p.stat().st_mtime))
    raise CodexError('未找到 Codex，请先安装并登录 Codex')


# Login/capability and model-catalog answers rarely change. Every job used to ask
# for them again on a freshly started app-server. Positive answers are reused for
# a short time, keyed by the Codex executable and the login file, so a new login,
# logout or Codex update invalidates them immediately. Negative answers are never kept.
CACHE_SECONDS = 600


def _codex_home() -> Path:
    return Path(os.environ.get('CODEX_HOME') or (Path.home() / '.codex'))


def _cache_file() -> Path:
    return Path(tempfile.gettempdir()) / 'image-repair-codex-cache.json'


def capability_cache_key(executable) -> str | None:
    try:
        info = Path(executable).stat()
    except (OSError, TypeError, ValueError):
        return None
    try:
        login_stamp = (_codex_home() / 'auth.json').stat().st_mtime_ns
    except OSError:
        login_stamp = None
    return json.dumps([str(executable), info.st_size, info.st_mtime_ns, str(_codex_home()), login_stamp])


def read_cached(key, field):
    if not key:
        return None
    try:
        saved = json.loads(_cache_file().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    entry = saved.get(field) if isinstance(saved, dict) else None
    if not isinstance(entry, dict) or entry.get('key') != key:
        return None
    age = time.time() - entry.get('savedAt', 0) if isinstance(entry.get('savedAt'), (int, float)) else -1
    return entry.get('value') if 0 <= age <= CACHE_SECONDS else None


def write_cached(key, field, value):
    if not key:
        return
    file = _cache_file()
    try:
        saved = json.loads(file.read_text(encoding='utf-8'))
        if not isinstance(saved, dict):
            saved = {}
    except (OSError, ValueError):
        saved = {}
    saved[field] = {'key': key, 'savedAt': time.time(), 'value': value}
    temporary = file.with_name(f'{file.name}.{os.getpid()}.{threading.get_ident()}.tmp')
    try:
        temporary.write_text(json.dumps(saved, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary, file)
    except OSError:
        # The cache is only an accelerator; a locked or read-only temp folder is harmless.
        try:
            temporary.unlink()
        except OSError:
            pass


class AppServer:
    def __init__(self, cwd: Path):
        self.cwd = cwd.resolve()
        self.messages: queue.Queue = queue.Queue()
        self.sequence = 0
        self.notifications: list[dict] = []
        self.responses: dict = {}
        self.stderr: list[str] = []
        self._vision_model_catalog = None
        self._vision_model_error = None
        self.visual_reasoning_choices: list[dict] = []
        self.generation_reasoning: dict = {}
        # This standalone client consumes native imageGeneration notifications.
        # Code Mode exposes an exec wrapper that this client cannot safely treat
        # as a native PNG result. Disable that route and shell tools only in this
        # child process, retaining the user's model, tier and global config.
        self.execution_policy = {'codeMode': False, 'shellTool': False,
                                 'scope': 'image-repair-app-server-process',
                                 'responsesTransport':'https-sse','providerVendor':'OpenAI',
                                 'authSource':'existing-chatgpt-login'}
        executable = find_codex()
        self._cache_key = capability_cache_key(executable)
        arguments = [executable, '-c', 'features.code_mode.enabled=false',
                     '-c', 'features.shell_tool=false',
                     '-c', WORKBENCH_HTTP_PROVIDER, '-c', 'model_provider="workbench-http"']
        self.process = subprocess.Popen(
            arguments + ['app-server', '--listen', 'stdio://'],
            cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace',
            bufsize=1, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        threading.Thread(target=self._read_output, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()

    def _read_output(self):
        try:
            for line in self.process.stdout:
                try:
                    self.messages.put(json.loads(line))
                except json.JSONDecodeError:
                    continue
        finally:
            self.messages.put(None)

    def _read_errors(self):
        for line in self.process.stderr:
            self.stderr.append(line.strip()[:300])
            self.stderr[:] = self.stderr[-12:]

    def send(self, message: dict):
        if self.process.poll() is not None:
            raise CodexError('Codex app-server 已退出')
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
        self.process.stdin.flush()

    def _next(self, deadline: float, poll: float = 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CodexError('等待 Codex app-server 超时')
        try:
            message = self.messages.get(timeout=min(remaining, poll))
        except queue.Empty:
            if self.process.poll() is not None:
                raise CodexError('Codex app-server 已退出')
            return None
        if message is None:
            raise CodexError('Codex app-server 连接已关闭')
        if 'method' in message and 'id' in message:
            # This bridge performs only native image editing. It does not grant
            # shell, file-change, OAuth or plugin permissions on the user's behalf.
            self.send({'id': message['id'], 'error': {'code': -32601, 'message': 'The image repair client cannot approve this request.'}})
            raise CodexApprovalRequired(f"Codex 请求额外操作，需要交互处理：{message['method']}")
        return message

    def request(self, method: str, params: dict, timeout: float = 25):
        self.sequence += 1
        request_id = self.sequence
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        while True:
            message = self._next(deadline)
            if message is None:
                continue
            if message.get('id') == request_id:
                if 'error' in message:
                    error = message['error']
                    raise CodexRequestError(error.get('message', 'Codex 请求失败'), error.get('code'))
                return message.get('result', {})
            if 'id' in message:
                self.responses[message['id']] = message
            else:
                self.notifications.append(message)

    def initialize(self):
        self.request('initialize', {'clientInfo': {'name': 'local_image_repair', 'title': '补图', 'version': '0.2.0'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized', 'params': {}})

    def capabilities(self, use_cache: bool = True):
        key = getattr(self, '_cache_key', None)
        cached = read_cached(key, 'capabilities') if use_cache else None
        if isinstance(cached, dict) and cached.get('loggedIn') is True and cached.get('imageGeneration') is True:
            return dict(cached)
        account = self.request('account/read', {'refreshToken': False})
        provider = self.request('modelProvider/capabilities/read', {})
        # Never return account identifiers or credentials to the frontend.
        kind = (account.get('account') or {}).get('type')
        result = {'loggedIn': account.get('account') is not None, 'accountType': kind, 'requiresOpenaiAuth': bool(account.get('requiresOpenaiAuth', False)), 'imageGeneration': provider.get('imageGeneration') is True}
        if result['loggedIn'] and result['imageGeneration']:
            write_cached(key, 'capabilities', result)
        return result

    def _advertised_low_effort(self, thread_response):
        """One bounded discovery query; low is accepted only for the exact current model."""
        model = thread_response.get('model')
        selected = None
        if self._vision_model_error is not None:
            raise self._vision_model_error
        if isinstance(model, str) and model:
            if self._vision_model_catalog is None:
                cached = read_cached(getattr(self, '_cache_key', None), 'modelCatalog')
                if isinstance(cached, list):
                    self._vision_model_catalog = cached
            if self._vision_model_catalog is None:
                # One bounded discovery request per client. If the current model
                # is on another page, retain its default instead of adding latency.
                self._vision_model_catalog = []
                try:
                    result = self.request('model/list', {'limit': 100, 'includeHidden': True})
                except CodexRequestError as error:
                    # Older app-servers may lack this method or these parameters.
                    # Permission, connection and all other errors must still stop.
                    if error.code not in (-32601, -32602):
                        self._vision_model_error = error
                        raise
                except Exception as error:
                    self._vision_model_error = error
                    raise
                else:
                    data = result.get('data') if isinstance(result, dict) else None
                    if isinstance(data, list):
                        self._vision_model_catalog = data
                        # Keep only what effort selection reads; no account or pricing fields.
                        write_cached(getattr(self, '_cache_key', None), 'modelCatalog', [
                            {'model': entry.get('model'), 'supportedReasoningEfforts': [
                                {'reasoningEffort': option.get('reasoningEffort')}
                                for option in entry.get('supportedReasoningEfforts') or [] if isinstance(option, dict)]}
                            for entry in data if isinstance(entry, dict) and isinstance(entry.get('model'), str)])
            for entry in self._vision_model_catalog:
                if not isinstance(entry, dict) or entry.get('model') != model:
                    continue
                efforts = entry.get('supportedReasoningEfforts')
                if isinstance(efforts, list) and any(isinstance(option, dict) and option.get('reasoningEffort') == 'low' for option in efforts):
                    selected = 'low'
                break
        return selected

    def simple_vision_effort(self, thread_response):
        """Backward-compatible helper for read-only visual protocol callers."""
        selected = self._advertised_low_effort(thread_response)
        configured = thread_response.get('reasoningEffort')
        self.visual_reasoning_choices.append({'model': thread_response.get('model'), 'configuredEffort': configured, 'effectiveEffort': selected if selected else configured})
        return selected

    def generation_turn_options(self, thread_response, mode='low'):
        """Reduce orchestration reasoning, with no model/tier/image-quality override.

        `effort` is an advertised app-server turn/start field. It changes this
        ephemeral thread, never the user's global config. Fast/priority billing
        and the native image tool's own model/quality remain inherited.
        """
        if mode not in ('low', 'configured'):
            raise CodexError('修图推理模式无效，请选择低推理调度或沿用 Codex 配置')
        selected = self._advertised_low_effort(thread_response) if mode == 'low' else None
        configured = thread_response.get('reasoningEffort')
        self.generation_reasoning = {
            'mode': mode,
            'model': thread_response.get('model'),
            'modelProvider': thread_response.get('modelProvider'),
            'configuredEffort': configured,
            'effectiveEffort': selected if selected else configured,
            'effortSource': 'advertised-low-override' if selected else 'inherited-thread',
            'serviceTier': thread_response.get('serviceTier'),
            'modelOverridden': False,
            'serviceTierOverridden': False,
            'imageModelControlled': False,
            'imageQualityControlled': False,
        }
        return {'effort': selected} if selected else {}

    def idle_events_supported(self) -> bool:
        """True only for the real client; protocol fixtures that override events() keep their own."""
        return type(self).events is AppServer.events and hasattr(self, 'messages')

    def events(self, timeout: float, cancelled=None, idle: bool = False):
        """Yield notifications. With idle=True also yield None about every 0.25 s
        while nothing arrives, so a caller can stop waiting on its own schedule."""
        deadline = time.monotonic() + timeout
        while True:
            if cancelled and cancelled():
                raise CodexError('修图任务已取消')
            if self.notifications:
                yield self.notifications.pop(0)
                continue
            message = self._next(deadline, .25 if idle else 1)
            if message is None:
                if idle:
                    yield None
                continue
            if 'id' in message:
                self.responses[message['id']] = message
            else:
                yield message

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=2)
            except (subprocess.TimeoutExpired, OSError):
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill()
        for pipe in [self.process.stdout, self.process.stderr]:
            if pipe:
                pipe.close()

    def __enter__(self):
        try:
            self.initialize()
        except Exception:
            self.close()
            raise
        return self

    def __exit__(self, *args):
        self.close()


if __name__ == '__main__':
    try:
        with AppServer(Path(__file__).resolve().parents[1]) as client:
            # The connection check always asks Codex; a positive answer refreshes the job cache.
            print(json.dumps(client.capabilities(use_cache=False), ensure_ascii=False))
    except (CodexError, OSError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
