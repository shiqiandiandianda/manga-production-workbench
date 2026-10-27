"""Persistent Python -> official Codex app-server -> native imageGeneration.savedPath."""
from __future__ import annotations
import argparse
from collections import OrderedDict, deque
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
import webbrowser
import urllib.parse
import urllib.request
from image_pipeline import open_image, crop_page, align_patch, paste_patch
from reference_pack import pack_references
from native_diagnostics import TurnDiagnostics, safe_text
from system_memory import available_commit_mb

# Both directions of Node's JSONL pipe use UTF-8. Windows pipes otherwise default to GBK.
sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
_request_id = None
_request_started = None


def generation_effort():
    value = os.environ.get("COMIC_CODEX_GENERATION_EFFORT", "low").strip() or "low"
    if value not in ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"):
        raise BridgeError("COMIC_CODEX_GENERATION_EFFORT 不是有效的推理档位", "invalid_generation_effort", "configuration", False, False)
    return value


def validate_generation_effort(server, model, effort):
    # The installed app-server advertises model-specific values. Never silently
    # replace a requested effort or a model when its catalog rejects the value.
    if not model:
        return False
    catalog = getattr(server, "generation_model_catalog", None)
    if catalog is None:
        catalog, cursor = [], None
        for _ in range(20):
            params = {"includeHidden": True}
            if cursor:
                params["cursor"] = cursor
            page = server.rpc("model/list", params, timeout=15)
            catalog.extend(page.get("data", []))
            cursor = page.get("nextCursor")
            if not cursor:
                break
        server.generation_model_catalog = catalog
    entry = next((item for item in catalog if item.get("model") == model or item.get("id") == model), None)
    allowed = {item.get("reasoningEffort") for item in (entry or {}).get("supportedReasoningEfforts", [])}
    if allowed and effort not in allowed:
        raise BridgeError("当前 Codex 模型不支持生图调度推理档位 " + effort + "；请设置兼容档位后重新提交", "unsupported_generation_effort", "configuration", False, False)
    return bool(allowed)


def emit(value):
    value = dict(value)
    if _request_id is not None:
        value["id"] = _request_id
    if _request_started is not None:
        value.setdefault("elapsedMs", round((time.monotonic() - _request_started) * 1000))
    # ASCII JSON safely represents even an OS error containing an isolated surrogate.
    print(json.dumps(value, ensure_ascii=True), flush=True)


def progress(message, stage, phase="connecting", **details):
    emit({"type": "progress", "message": message, "stage": stage, "phase": phase, **details})


class BridgeError(RuntimeError):
    def __init__(self, message, code="codex_connection_failed", stage="connection", retryable=False, may_have_started=False):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.retryable = retryable
        self.may_have_started = may_have_started


RATE_LIMIT_PATTERN = re.compile(
    r"(?:\b429\b|too many requests|rate[ _-]?limit|usage[ _-]?limit|insufficient[ _-]?quota|\bquota\b)",
    re.IGNORECASE,
)


def is_rate_limited(message):
    """True only for an explicit provider rejection (429 / quota), not for a generic timeout.

    A 429 response means the request was refused before any turn/image existed, so the
    caller must not treat the shot as "may have started" and must not auto-retry it.
    """
    return bool(RATE_LIMIT_PATTERN.search(str(message or "")))


def rpc_error(message, stage, started=False):
    message = str(message or "官方 Codex 返回了没有说明的错误")
    if is_rate_limited(message):
        return BridgeError(
            f"官方 Codex 账号已限流或额度用尽（{stage}）：{message}；本次请求已被拒绝，没有提交生成，原图保留。队列会自动暂停后重试。",
            "account_rate_limited",
            stage,
            False,
            False,
        )
    if "workspace routing discovery timed out" in message.lower():
        return BridgeError(f"官方 Codex 工作区路由发现超时（{stage}）；账号状态尚未确认。这是临时连接失败，原图保留。详细信息：{message}", "workspace_routing_timeout", stage, True, started)
    return BridgeError(f"官方 Codex 在 {stage} 阶段失败：{message}；原图保留。", "app_server_rpc_failed", stage, False, started)


def error_event(error):
    if isinstance(error, UnicodeError):
        return {"type": "error", "message": "Python JSONL 输入编码错误：" + str(error), "code": "worker_encoding_error", "stage": "worker/read", "retryable": True, "mayHaveStarted": False}
    if isinstance(error, BridgeError):
        return {"type": "error", "message": safe_text(error, 2000), "code": error.code, "stage": error.stage, "retryable": error.retryable, "mayHaveStarted": error.may_have_started,
                "generationEnded": getattr(error, "generation_ended", False), "diagnostics": getattr(error, "diagnostics", None), "requiredAction": getattr(error, "required_action", None)}
    return {"type": "error", "message": str(error) or error.__class__.__name__, "code": "generation_failed", "stage": "validation", "retryable": False, "mayHaveStarted": False}


class AppServer:
    def __init__(self, command, cwd=None):
        ensure_memory_for_codex()
        environment = dict(os.environ)
        environment.pop("OPENAI_API_KEY", None)
        environment.pop("CODEX_API_KEY", None)
        self.process = subprocess.Popen(
            command + ["app-server", "--listen", "stdio://", "--enable", "image_generation", "-c", 'forced_login_method="chatgpt"', "-c", 'model_provider="openai"'],
            cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", bufsize=1, env=environment,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.messages = queue.Queue()
        self.notifications = deque()
        self.sequence = 0
        self.stderr = ""
        self.account_cache = None
        self.generation_started = False
        self.recycle_after_turn = False
        self.current_stage = "initialize"
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._errors, daemon=True).start()
        try:
            self.rpc("initialize", {"clientInfo": {"name": "comic_strip_studio", "title": "长条漫画工作台", "version": "0.1.0"}, "capabilities": {"experimentalApi": True}}, timeout=20)
            self.send({"method": "initialized", "params": {}})
        except Exception:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                try:
                    self.messages.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
        finally:
            self.messages.put({"_closed": True})

    def _errors(self):
        for line in self.process.stderr:
            self.stderr = (self.stderr + line)[-2000:]

    def send(self, message):
        try:
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as error:
            raise self.connection_error("连接写入失败") from error

    def connection_error(self, reason="连接中断"):
        stage = getattr(self, "current_stage", "connection")
        process = getattr(self, "process", None)
        code = process.poll() if process is not None else None
        # Read only this child process's stderr, never auth/config files or model reasoning.
        detail = safe_text(getattr(self, "stderr", "")[-1800:], 1800)
        suffix = f"退出码 {code}" if code is not None else "退出码尚未返回"
        return BridgeError(f"Codex app-server 在 {stage} 阶段{reason}（{suffix}）；原图保留。" + (" 本机诊断：" + detail if detail else ""), "app_server_closed", stage, True, self.generation_started)

    def receive(self, timeout):
        message = self.messages.get(timeout=timeout)
        if message.get("_closed"):
            raise self.connection_error()
        if message.get("method") == "account/updated":
            self.account_cache = None
        if "method" in message and "id" in message:
            method = message["method"]
            # Auto review stays inside app-server; client approval requests are never blindly approved.
            if method in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval"):
                self.send({"id": message["id"], "result": {"decision": "decline"}})
            elif method == "item/permissions/requestApproval":
                self.send({"id": message["id"], "result": {"permissions": {}, "scope": "turn"}})
            else:
                self.send({"id": message["id"], "error": {"code": -32601, "message": "本工具不执行额外的登录、外部工具或用户问答请求"}})
            return None
        return message

    def rpc(self, method, params, timeout=30):
        if method == "thread/start":
            ensure_memory_for_codex()
        self.current_stage = method
        self.sequence += 1
        request_id = self.sequence
        self.send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                message = self.receive(max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            if not message:
                continue
            if message.get("id") == request_id:
                if "error" in message:
                    raise rpc_error(message["error"].get("message"), method, self.generation_started)
                return message.get("result", {})
            if "method" in message:
                self.notifications.append(message)
        raise BridgeError(f"Codex app-server 在 {method} 阶段请求超时（{timeout} 秒）；账号或网络服务暂未响应，原图保留。", "app_server_timeout", method, True, self.generation_started)

    def events(self, timeout=900):
        self.current_stage = "image_generation"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.notifications:
                yield self.notifications.popleft()
                continue
            try:
                message = self.receive(max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            if message and "method" in message:
                yield message
        raise BridgeError("GPT Image 在图片生成阶段超时（900 秒）；当前镜头没有自动重试，避免重复生图，可重新发起。原图保留。", "image_generation_timeout", "image_generation", True, True)

    def drain(self):
        # No RPC is in flight here. Old thread notifications are never inputs to a new shot.
        self.notifications.clear()
        while not self.messages.empty():
            try:
                self.receive(0.001)
            except queue.Empty:
                break

    def settle_turn(self, thread_id, turn_id, completed=False, interrupt_requested=False):
        completed_received_at = time.monotonic() if completed else None
        if not completed:
            if not interrupt_requested:
                try:
                    self.rpc("turn/interrupt", {"threadId": thread_id, "turnId": turn_id}, timeout=10)
                except (BridgeError, TimeoutError, queue.Empty):
                    pass
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not completed:
                try:
                    event = self.notifications.popleft() if self.notifications else self.receive(max(0.01, deadline - time.monotonic()))
                except (BridgeError, queue.Empty):
                    break
                if event and event.get("method") == "turn/completed" and matches_turn(event.get("params", {}), thread_id, turn_id):
                    completed = True
                    completed_received_at = time.monotonic()
        if not completed:
            # Do not reuse a connection whose old agent may still be running.
            self.recycle_after_turn = True
            return {"completed":False}
        try:
            self.rpc("thread/unsubscribe", {"threadId": thread_id}, timeout=10)
        except (BridgeError, TimeoutError, queue.Empty):
            self.recycle_after_turn = True
        self.notifications.clear()
        return {"completed":True, "completedMonotonic":completed_received_at, "receivedAt":datetime.now(timezone.utc).isoformat()}

    def close(self):
        try:
            self.process.stdin.close()
        except Exception:
            pass
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)


def ensure_memory_for_codex():
    available = available_commit_mb()
    if available is not None and available < 512:
        raise BridgeError(f"系统可用提交内存仅 {available} MB，不足以稳定启动 Codex 会话；请先保存并释放内存，再检查连接。本次未发送生成指令，原图保留。", "system_memory_low", "memory/preflight", False, False)


def account_status(server, force=False):
    cached = getattr(server, "account_cache", None)
    if cached is not None and not force:
        return {**cached, "cached": True}
    progress("正在检查官方 Codex 的 ChatGPT 账号连接", "account/read")
    # Routing discovery has its own ~15s timeout; wait long enough to retain its diagnostic.
    result = server.rpc("account/read", {"refreshToken": False}, timeout=30)
    account = result.get("account")
    status = {"connected": bool(account and account.get("type") == "chatgpt"), "transport": "app-server / stdio", "accountType": account.get("type") if account else None}
    server.account_cache = status
    return status


def reference_path(filename):
    try:
        return Path(filename).resolve(strict=True)
    except OSError as error:
        # Some Windows virtual drives support ordinary file reads but do not
        # implement GetFinalPathNameByHandle, which Path.resolve requires.
        # This fallback applies only to explicit read-only reference inputs.
        if getattr(error, "winerror", None) != 1005:
            raise
        file = Path(os.path.abspath(filename))
        if not file.is_file():
            raise FileNotFoundError(str(file)) from error
        return file


class ReferenceDigestCache:
    def __init__(self, limit=128):
        self.limit = limit
        self.values = OrderedDict()

    def digest(self, filename):
        file = reference_path(filename)
        stat = file.stat()
        key = (str(file), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        if key in self.values:
            self.values.move_to_end(key)
            return self.values[key]
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        self.values[key] = digest
        if len(self.values) > self.limit:
            self.values.popitem(last=False)
        return digest


def verify_saved_path(saved_path, directory):
    candidate = Path(saved_path).resolve(strict=True)
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    allowed = [directory.resolve(), (codex_home / "generated_images").resolve()]
    if not any(candidate.is_relative_to(root) for root in allowed):
        raise ValueError("生成图片不在本任务或 Codex 原生生图目录中")
    if not candidate.is_file():
        raise ValueError("savedPath 没有指向实际图片文件")
    if candidate.stat().st_size > 30 * 1024 * 1024:
        raise ValueError("生成图片超过 30 MB")
    open_image(candidate)
    return candidate


def matches_turn(params, thread_id, turn_id):
    return params.get("threadId") == thread_id and (params.get("turnId") or (params.get("turn") or {}).get("id")) == turn_id


def imagegen_skill_path():
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    candidate = codex_home / "skills" / ".system" / "imagegen" / "SKILL.md"
    return str(candidate.resolve()) if candidate.is_file() else None


def register_generation_slot(server, task):
    """Synchronous proof immediately before turn/start, per task, never in logs."""
    if 'globalSlot' not in task:
        return  # Original standalone tool still uses its own bounded pool.
    slot = task['globalSlot']
    if not isinstance(slot, dict):
        raise BridgeError('统一生图队列身份无效，未开始生图', 'generation_slot_invalid', 'generation/slot')
    origin, token = slot.get('origin', ''), slot.get('token', '')
    if not isinstance(origin, str):
        raise BridgeError('统一生图队列身份无效，未开始生图', 'generation_slot_invalid', 'generation/slot')
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or not isinstance(token, str) or len(token) != 64 or any(char not in '0123456789abcdef' for char in token):
        raise BridgeError('统一生图队列身份无效，未开始生图', 'generation_slot_invalid', 'generation/slot')
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for pid in (os.getpid(), server.process.pid):
            request = urllib.request.Request(origin.rstrip('/') + '/api/generation-slots/track', data=json.dumps({'pid':pid}).encode('utf-8'), method='POST', headers={'Content-Type':'application/json', 'Authorization':'Bearer ' + token})
            with opener.open(request, timeout=5) as response:
                if response.status != 200:
                    raise RuntimeError('slot rejected')
    except Exception:
        raise BridgeError('统一生图队列未确认当前进程，未开始生图；请保持漫画服务运行', 'generation_slot_unavailable', 'generation/slot', False, False) from None


def path_turn_inputs(prompt, references, skill_path=None):
    paths = [str(reference_path(p)) for p in references]
    prompt += "\n本任务本地图片路径清单（只读，JSON 数组，顺序对应图号）：\n" + json.dumps(paths, ensure_ascii=False)
    contents = [{"type": "text", "text": prompt}]
    if skill_path:
        contents.append({"type": "skill", "name": "imagegen", "path": skill_path})
    return contents


def start_generation_thread(server, directory):
    return server.rpc("thread/start", {"cwd": str(directory.resolve()), "sandbox": "workspace-write", "approvalPolicy": "on-request", "approvalsReviewer": "auto_review", "ephemeral": True, "modelProvider": "openai", "config": {"features.image_generation": True}}, timeout=45)


def generate(server, directory, digest_cache=None, skill_path=None):
    started = time.monotonic()
    effort = generation_effort()
    digest_cache = digest_cache or ReferenceDigestCache()
    progress("正在准备当前镜头和图片参考", "references", "reference")
    task = json.loads((directory / "input.json").read_text(encoding="utf-8"))
    prompt = (directory / "request.txt").read_text(encoding="utf-8")
    direct = task.get("referenceMode") == "direct"
    if direct:
        prompt += "\n本次内容与参考顺序已经确定。不要先查看参考图，直接调用一次内置 imagegen，并把全部参考路径按顺序传入 referenced_image_paths，无需额外规划或确认。完成第一张图片后立即结束，不自动返修、再次生图或生成额外候选；需要返修时由用户另行发起。"
    else:
        prompt += "\n本次内容与参考顺序已经确定。每张参考只查看一次；工具支持并行时在一轮中读取全部参考并逐张检查，随后直接调用一次内置 imagegen，无需额外规划或确认。完成第一张图片后立即结束，不自动返修、再次生图或生成额外候选；需要返修时由用户另行发起。"
    references = task.get("referenceFiles", [])
    out = directory / "out"
    out.mkdir(exist_ok=True)
    target = None
    if task.get("action") == "edit":
        if not task.get("cropBox") or not (task.get("basePanelPath") or task.get("basePagePath")):
            raise ValueError("重绘缺少原图与格子裁切区域")
        if task.get("basePanelPath"):
            crop = Path(task["basePanelPath"])
            image = open_image(crop)
            target = image.size
            if target != tuple(task["cropBox"][2:]):
                raise ValueError("局部快照尺寸与格子裁切区域不一致")
        else:
            crop = directory / "crop.png"
            target = crop_page(task["basePagePath"], task["cropBox"], crop)
        references = [str(crop)] + references
        first = "作为 referenced_image_paths 的第一张传入" if direct else "必须先用 view_image 查看"
        image_description = '完整原图（不是画布截图或局部裁切）' if task.get('editScope') == 'full-image' else '当前漫画格子的裁切原图'
        style_rule = '画风按本次项目统一画风设置执行。' if str(task.get('style') or '').strip() else '保持原有画风。'
        prompt = f"编辑路径清单图 1（{image_description}，{first}）。修改要求：{task.get('editPrompt', '')}。保持其他内容，{style_rule}生成同一宽高比的新图，原图比例为 {target[0]}:{target[1]}。后续路径是角色、场景或画风参考。\n" + prompt
    reference_digests = {digest_cache.digest(p) for p in references}
    references, packing_notes, reference_packing = pack_references(directory, references, task.get('referenceRoles', []), edit=task.get('action') == 'edit')
    if reference_packing:
        prompt += '\n' + packing_notes
        reference_digests.update(digest_cache.digest(p) for p in references)
        progress(f"已将{reference_packing['sourceCount']}张参考整理为{reference_packing['attachedCount']}张附图，保留全部原参考", 'reference_pack', 'reference', referencePacking={'sourceCount': reference_packing['sourceCount'], 'attachedCount': reference_packing['attachedCount']})
    thread_id = None
    turn_id = None
    completed = False
    interrupt_requested = False
    saved_path = None
    manifest = None
    generation_started = None
    image_started = None
    image_completed = None
    thread_model = None
    native_image_model = None
    thread_effort = None
    effort_catalog_checked = False
    turn_completed_elapsed_ms = None
    diagnostics = TurnDiagnostics()
    diagnostic_error_code = None
    try:
        progress("正在为当前镜头建立独立 Codex 会话", "thread/start")
        thread = start_generation_thread(server, directory)
        thread_id = thread["thread"]["id"]
        thread_model = thread.get("model")
        thread_effort = thread.get("reasoningEffort")
        effort_catalog_checked = validate_generation_effort(server, thread_model, effort)
        contents = path_turn_inputs(prompt, references, skill_path)
        register_generation_slot(server, task)
        # Sending turn/start may already start inference even if the response is lost.
        server.generation_started = True
        progress("Codex 正在处理当前分镜与图片参考", "turn/start", "reference")
        response = server.rpc("turn/start", {"threadId": thread_id, "input": contents, "effort": effort}, timeout=45)
        turn_id = response.get("turn", {}).get("id")
        if not turn_id:
            raise BridgeError("Codex 未返回当前镜头的 turn id；没有自动重试，原图保留。", "invalid_turn_response", "turn/start", False, True)
        generation_started = time.monotonic()
        prepare_ms = round((generation_started - started) * 1000)
        with (directory / "app-server-events.jsonl").open("w", encoding="utf-8") as log:
            for event in server.events():
                method = event.get("method", "")
                params = event.get("params", {})
                if not matches_turn(params, thread_id, turn_id):
                    continue
                item = params.get("item", {})
                safe = diagnostics.observe(method, params)
                if method in ("item/started", "item/completed", "turn/completed", "error"):
                    safe.update(threadId=thread_id, turnId=turn_id, itemId=item.get("id"), elapsedMs=round((time.monotonic()-started)*1000), receivedAt=datetime.now(timezone.utc).isoformat())
                    log.write(json.dumps(safe, ensure_ascii=False) + "\n")
                    log.flush()
                if method == "item/started" and item.get("type") == "imageGeneration":
                    image_started = time.monotonic()
                    progress("GPT Image 正在生成镜头图片", "image_generation", "generating", prepareMs=prepare_ms, preImageMs=round((image_started-started)*1000), dispatchEffort=effort)
                if method == "item/completed" and item.get("type") == "imageGeneration":
                    if item.get("failure"):
                        failure = item["failure"]
                        message = failure.get("message", "Codex 内置生图失败") if isinstance(failure, dict) else str(failure)
                        raise BridgeError(message, "native_image_failed", "image_generation", False, True)
                    if item.get("savedPath"):
                        saved_path = item["savedPath"]
                        reported_image_model = item.get("imageModelId") or item.get("imageModel")
                        if isinstance(reported_image_model, str) and len(reported_image_model) <= 160:
                            native_image_model = reported_image_model
                        image_completed = time.monotonic()
                if saved_path:
                    # Interrupt immediately, before validation/copy/composition can allow another tool call.
                    interrupt_requested = True
                    try:
                        server.rpc("turn/interrupt", {"threadId": thread_id, "turnId": turn_id}, timeout=10)
                    except (RuntimeError, TimeoutError, queue.Empty):
                        pass
                    progress("原生生图已完成，正在接收并校验结果", "image_generation_completed", "reading", **({"imageGenerationMs":round((image_completed-image_started)*1000)} if image_started is not None else {}))
                    verify_saved_path(saved_path, directory)
                    progress("镜头图片已完成，Python 正在读取原图", "image_read", "reading")
                    break
                if method == "error":
                    failure = params.get("error") or {}
                    if not params.get("willRetry"):
                        raise rpc_error(failure.get("message", "Codex 生图失败"), "image_generation", True)
                if method == "turn/completed":
                    turn_completed_elapsed_ms = round((time.monotonic()-started)*1000)
                    completed = True
                    turn = params.get("turn", {})
                    if turn.get("status") in ("failed", "interrupted"):
                        raise rpc_error((turn.get("error") or {}).get("message", "Codex 未完成生图"), "image_generation", True)
                    break
        if not saved_path:
            reply = safe_text(diagnostics.final_reply, 320)
            detail = "最终答复：" + reply if reply else "没有提供最终答复；请查看任务诊断记录。"
            state = "任务已结束" if completed else "任务结束状态未确认"
            action = " 核对原任务和参考后可人工重新提交；不会自动重试。" if completed else " 请先核查原任务远端状态，不要重复提交。"
            raise BridgeError("Codex " + state + "但未返回 imageGeneration.savedPath；没有实际生图结果，原图保留。" + detail + action, "native_image_missing", "image_generation", False, True)
        native_ms = round((time.monotonic() - generation_started) * 1000)
        original = verify_saved_path(saved_path, directory)
        digest = hashlib.sha256(original.read_bytes()).hexdigest()
        if digest in reference_digests:
            raise BridgeError("Codex 返回了原参考图，没有生成新图片", "reference_image_reused", "image_read", False, True)
        image = open_image(original)
        patch = original
        manifest = {"savedPath": str(patch.resolve()), "sourceSavedPath": str(original), "width": image.width, "height": image.height, "imageToolSeen": True, "action": task.get("action", "generate"), "description": "Codex 内置生图完成", "timings": {"prepareMs": prepare_ms, "nativeMs": native_ms, "dispatchEffort":effort, "inheritedDispatchEffort":thread_effort, "effortCatalogChecked":effort_catalog_checked, "dispatchModel":thread_model, "referenceMode":"direct" if direct else "view", "referenceCount":len(references), "readbackCompletedMs":round((time.monotonic()-started)*1000)}}
        manifest["nativeGeneration"] = {"version": 1, "provider": "codex", "imageModelId": native_image_model, "imageModelState": "reported" if native_image_model else "unknown", "dispatcherModelId": thread_model, "control": "prompt", "actual": {"width": image.width, "height": image.height}}
        if reference_packing:
            manifest['referencePacking'] = reference_packing
        if image_started is not None:
            manifest["timings"]["preImageMs"] = round((image_started-started)*1000)
        if image_started is not None and image_completed is not None:
            manifest["timings"]["imageGenerationMs"] = round((image_completed-image_started)*1000)
        if turn_completed_elapsed_ms is not None:
            manifest["timings"]["turnCompletedMs"] = turn_completed_elapsed_ms
        if target and task.get('editScope') != 'full-image':
            progress("Python 正在校验比例、缩放并贴回蒙版", "composition", "compositing")
            aligned = out / "aligned_patch.png"
            try:
                manifest["alignment"] = align_patch(patch, target, aligned)
                manifest["alignedPath"] = str(aligned.resolve())
                if task.get("basePagePath"):
                    repaired = out / "repaired_page.png"
                    manifest["composition"] = paste_patch(task["basePagePath"], aligned, task["cropBox"], task.get("maskPolygon"), repaired, feather=task.get("feather", 0), border=task.get("border", 0))
                    manifest["repairedPagePath"] = str(repaired.resolve())
            except ValueError as error:
                manifest["alignmentError"] = str(error)
    except Exception as error:
        diagnostic_error_code = getattr(error, "code", "generation_failed")
        if isinstance(error, BridgeError):
            error.diagnostics = diagnostics.snapshot(completed=completed, error_code=diagnostic_error_code)
            error.generation_ended = completed
            error.required_action = error.diagnostics["retry"]["action"]
            raise
        raise BridgeError(str(error) or error.__class__.__name__, "generation_failed", "validation", False, bool(getattr(server, "generation_started", False))) from error
    finally:
        evidence = diagnostics.snapshot(completed=completed, error_code=diagnostic_error_code)
        evidence.update(threadId=thread_id, turnId=turn_id)
        try:
            (directory / "native-diagnostics.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            # A diagnostic disk error must not replace the actual provider failure.
            progress("诊断文件暂时无法写入；任务原始状态仍保留", "diagnostic_write_failed")
        if thread_id and turn_id:
            if hasattr(server, "settle_turn"):
                settled = server.settle_turn(thread_id, turn_id, completed, interrupt_requested=interrupt_requested)
                if manifest and isinstance(settled, dict):
                    manifest["timings"]["turnCompletionObserved"] = settled.get("completed") is True
                    if settled.get("completedMonotonic") is not None:
                        manifest["timings"]["turnCompletedMs"] = round((settled["completedMonotonic"]-started)*1000)
                        manifest["timings"]["turnCompletedReceivedAt"] = settled["receivedAt"]
            elif not completed and not interrupt_requested:
                try:
                    server.rpc("turn/interrupt", {"threadId": thread_id, "turnId": turn_id}, timeout=10)
                except (RuntimeError, TimeoutError, queue.Empty):
                    pass
        elif thread_id and getattr(server, "generation_started", False):
            server.recycle_after_turn = True
    manifest["timings"]["totalMs"] = round((time.monotonic() - started) * 1000)
    if image_completed is not None:
        manifest["timings"]["outputMs"] = round((time.monotonic()-image_completed)*1000)
    (directory / "result.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def rewrite_prompt(server, directory):
    """Text-only revision in its own read-only thread; never replay a submitted turn."""
    prompt = (directory / "request.txt").read_text(encoding="utf-8")
    thread_id = turn_id = None
    completed = False
    reply = ""
    schema = {"type": "object", "properties": {"prompt": {"type": "string", "minLength": 1, "maxLength": 20000}}, "required": ["prompt"], "additionalProperties": False}
    try:
        thread = server.rpc("thread/start", {"cwd": str(directory.resolve()), "sandbox": "read-only", "approvalPolicy": "never", "ephemeral": True, "modelProvider": "openai", "config": {"features.image_generation": False, "features.shell_tool": False, "features.apply_patch_freeform": False, "web_search": "disabled"}}, timeout=45)
        thread_id = thread["thread"]["id"]
        server.generation_started = True
        progress("Codex 正在按修改意见修订提示词", "turn/start", "prompt-rewrite")
        response = server.rpc("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text": prompt}], "outputSchema": schema}, timeout=45)
        turn_id = response.get("turn", {}).get("id")
        if not turn_id:
            raise BridgeError("Codex 未返回修改任务编号，原提示词保留", "invalid_turn_response", "prompt-rewrite", False, True)
        for event in server.events(timeout=180):
            method, params = event.get("method", ""), event.get("params", {})
            if not matches_turn(params, thread_id, turn_id):
                continue
            item = params.get("item", {})
            if method == "item/completed" and item.get("type") == "agentMessage" and item.get("phase") not in ("analysis", "reasoning", "commentary"):
                reply = item.get("text", "")
            if method == "error" and not params.get("willRetry"):
                raise BridgeError((params.get("error") or {}).get("message", "Codex 修改提示词失败"), "prompt_rewrite_failed", "prompt-rewrite", False, True)
            if method == "turn/completed":
                completed = True
                if params.get("turn", {}).get("status") != "completed":
                    raise BridgeError("Codex 修改任务未完成，原提示词保留", "prompt_rewrite_failed", "prompt-rewrite", False, True)
                break
        if not completed:
            raise BridgeError("Codex 修改提示词超时，原提示词保留", "prompt_rewrite_timeout", "prompt-rewrite", False, True)
        try:
            value = json.loads(reply)
            if not isinstance(value.get("prompt"), str) or not value["prompt"].strip() or len(value["prompt"]) > 20000:
                raise ValueError("invalid prompt")
        except (ValueError, TypeError, AttributeError):
            raise BridgeError("Codex 返回的提示词格式无效，原提示词保留", "prompt_rewrite_invalid", "prompt-rewrite", False, True)
        return {"prompt": value["prompt"]}
    finally:
        if thread_id and turn_id:
            server.settle_turn(thread_id, turn_id, completed=completed)


class WorkerSession:
    def __init__(self, command, cwd=None, server_factory=AppServer):
        self.command = command
        self.cwd = cwd
        self.server_factory = server_factory
        self.server = None
        self.digest_cache = ReferenceDigestCache()
        self.skill_path = imagegen_skill_path()

    def close(self):
        if self.server:
            self.server.close()
            self.server = None

    def _prepare(self, force=False):
        if self.server is None:
            progress("正在建立官方 Codex app-server 连接", "initialize")
            self.server = self.server_factory(self.command, self.cwd)
        self.server.generation_started = False
        if hasattr(self.server, "drain"):
            self.server.drain()
        self.server.recycle_after_turn = False
        status = account_status(self.server, force=force)
        progress("官方 Codex 连接已就绪" if status["connected"] else "官方 Codex 尚未使用 ChatGPT 登录", "ready", connected=status["connected"], accountCached=status.get("cached", False))
        return status

    def execute(self, action, directory=None, force=False):
        request_started = time.monotonic()
        for attempt in range(2):
            try:
                status = self._prepare(force=force)
                if action == "status":
                    return status
                if not status["connected"]:
                    raise BridgeError("本机 Codex app-server 尚未使用 ChatGPT 登录，请先完成官方登录", "chatgpt_login_required", "account/read", False, False)
                if action == "probe":
                    progress("正在验证官方 Codex 空会话，不发送生成指令", "thread/start")
                    thread = start_generation_thread(self.server, directory)
                    thread_id = thread["thread"]["id"]
                    try:
                        self.server.rpc("thread/unsubscribe", {"threadId": thread_id}, timeout=10)
                    except BridgeError:
                        self.close()
                    return {**status, "sessionReady": True, "probeOnly": True, "turnStartSent": False}
                if action == "rewrite-prompt":
                    result = rewrite_prompt(self.server, directory)
                    (directory / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                    if self.server.recycle_after_turn:
                        self.close()
                    return result
                ready_ms = round((time.monotonic() - request_started) * 1000)
                result = generate(self.server, directory, self.digest_cache, self.skill_path)
                result["timings"]["connectionMs"] = ready_ms
                if "preImageMs" in result["timings"]:
                    result["timings"]["preImageMs"] += ready_ms
                result["timings"]["totalMs"] = round((time.monotonic() - request_started) * 1000)
                (directory / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                if self.server.recycle_after_turn:
                    # The image is already saved; shut the old app-server down off the request path.
                    old, self.server = self.server, None
                    threading.Thread(target=old.close, daemon=True).start()
                return result
            except Exception as error:
                started = bool(self.server and self.server.generation_started)
                retryable = isinstance(error, BridgeError) and error.retryable
                # Read-only setup may reconnect once. Never replay an already-sent turn/start.
                self.close()
                if retryable and not started and not error.may_have_started and attempt == 0:
                    progress("官方 Codex 准备阶段连接失败，正在重新连接一次", "reconnect", retryCode=error.code)
                    continue
                raise
        raise AssertionError("unreachable")


def serve(command, cwd=None):
    global _request_id, _request_started
    session = WorkerSession(command, cwd)
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                request = json.loads(line)
                _request_id = request.get("id")
                _request_started = time.monotonic()
                action = request.get("action")
                progress("Python 已收到当前请求", "worker/read")
                if action not in ("status", "generate", "probe", "rewrite-prompt"):
                    raise BridgeError("Python 生图连接收到无效请求", "worker_protocol_error")
                directory = Path(request["directory"]).resolve(strict=True) if action in ("generate", "probe", "rewrite-prompt") else None
                result = session.execute(action, directory, request.get("force") is True)
                emit({"type": "result", **result})
            except Exception as error:
                emit(error_event(error))
            finally:
                _request_id = None
                _request_started = None
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["status", "login", "generate", "serve"])
    parser.add_argument("--codex-command", required=True)
    parser.add_argument("--directory")
    options = parser.parse_args()
    command = json.loads(options.codex_command)
    if not isinstance(command, list) or not command or any(not isinstance(part, str) for part in command):
        raise ValueError("Codex 程序参数无效")
    directory = Path(options.directory).resolve() if options.directory else None
    if options.action == "serve":
        serve(command, str(Path.cwd()))
        return
    if options.action in ("status", "generate"):
        session = WorkerSession(command, str(directory) if directory else None)
        try:
            emit({"type": "result", **session.execute(options.action, directory)})
        finally:
            session.close()
        return
    server = AppServer(command)
    try:
        response = server.rpc("account/login/start", {"type": "chatgpt"}, timeout=30)
        url = response.get("authUrl")
        if url:
            from urllib.parse import urlparse
            if urlparse(url).hostname not in ("auth.openai.com", "auth0.openai.com", "chatgpt.com"):
                raise ValueError("登录地址不是官方登录域名")
            webbrowser.open(url)
        progress("请在官方页面完成 ChatGPT 登录", "login")
        for event in server.events(timeout=240):
            if event.get("method") == "account/login/completed":
                params = event.get("params", {})
                if not params.get("success"):
                    raise RuntimeError(params.get("error") or "官方登录未完成")
                emit({"type": "result", "connected": True})
                break
    finally:
        server.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(error_event(error))
        sys.exit(1)

