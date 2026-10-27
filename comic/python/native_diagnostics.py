"""Bounded final-answer/error evidence; never collect reasoning or tool arguments."""
import re


def safe_text(value, limit=12000):
    text = str(value or "")
    text = re.sub(r"(?:sk-|sk_proj_)[A-Za-z0-9_-]{8,}", "[redacted-key]", text)
    text = re.sub(r"Bearer\s+[^\s\"']+", "Bearer [redacted]", text, flags=re.I)
    text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[redacted-token]", text)
    text = re.sub(r"((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+", r"\1[redacted]", text, flags=re.I)
    return text[:limit]


class TurnDiagnostics:
    def __init__(self):
        self.final_reply = ""
        self.last_reply = ""
        self.reply_phase = None
        self.final_reply_explicit = False
        self.reply_count = 0
        self.image_started = 0
        self.image_completed = 0
        self.image_saved = False
        self.reference_views = 0
        self.turn_status = None
        self.last_error = None

    def observe(self, method, params):
        item = params.get("item") or {}
        kind = item.get("type")
        safe = {"method": method, "itemType": kind, "status": item.get("status"), "savedPath": item.get("savedPath")}
        if method == "item/started" and kind == "imageGeneration":
            self.image_started += 1
        if method == "item/completed":
            if kind == "imageGeneration":
                self.image_completed += 1
                self.image_saved |= bool(item.get("savedPath"))
                if item.get("failure"):
                    self.last_error = self.error(item["failure"])
                    safe["failure"] = self.last_error
            elif kind == "imageView":
                self.reference_views += 1
            elif kind == "agentMessage" and item.get("phase") not in ("analysis", "reasoning"):
                self.last_reply = safe_text(item.get("text"))
                self.reply_phase = item.get("phase") or "unspecified"
                if self.reply_phase == "final_answer":
                    self.final_reply = self.last_reply
                    self.final_reply_explicit = True
                self.reply_count += 1
                safe.update(reply=self.last_reply, replyPhase=self.reply_phase)
        if method == "error":
            self.last_error = self.error(params.get("error"))
            safe.update(error=self.last_error, willRetry=params.get("willRetry") is True)
        if method == "turn/completed":
            turn = params.get("turn") or {}
            self.turn_status = turn.get("status")
            # Legacy transports omit phase. Only use that last message after
            # observed turn completion; commentary is never a final answer.
            if not self.final_reply_explicit and self.reply_phase == "unspecified":
                self.final_reply = self.last_reply
            safe["turnStatus"] = self.turn_status
            if turn.get("error"):
                self.last_error = self.error(turn["error"])
                safe["error"] = self.last_error
        return safe

    @staticmethod
    def error(value):
        if isinstance(value, dict):
            return {"code": safe_text(value.get("code"), 100), "message": safe_text(value.get("message"), 4000)}
        return {"code": "", "message": safe_text(value, 4000)}

    def snapshot(self, *, completed=False, error_code=None):
        if self.image_saved:
            classification = "native_image_returned"
        elif error_code == "native_image_failed":
            classification = "native_image_failed"
        elif error_code == "account_rate_limited":
            # The provider returned 429/quota before accepting turn/start: nothing was
            # submitted, so this must not be reported as an unknown remote state.
            classification = "rate_limited_not_started"
        elif self.turn_status in ("failed", "interrupted"):
            classification = "turn_" + self.turn_status
        elif completed:
            classification = "completed_without_image" if not self.image_started and not self.image_completed else "image_event_without_saved_path"
        else:
            classification = "remote_state_unknown"
        rate_limited = error_code == "account_rate_limited"
        return {"classification": classification, "finalReply": self.final_reply, "lastAgentReply": self.last_reply,
                "replyPhase": self.reply_phase, "finalReplyExplicit": self.final_reply_explicit, "replyCount": self.reply_count,
                "lastError": self.last_error, "turnStatus": self.turn_status,
                "imageStarted": self.image_started, "imageCompleted": self.image_completed,
                "imageSaved": self.image_saved, "referenceViews": self.reference_views,
                "remoteEnded": completed,
                "retry": {"automatic": False,
                          "action": "retry_after_cooldown" if rate_limited else ("review_and_explicit_resubmit" if completed and not self.image_saved else "inspect_existing_job_and_remote_state"),
                          "note": "账号限流或额度用尽，本次没有提交生成；队列暂停冷却后自动继续，不要重复提交。" if rate_limited else "保留原图；先核对当前镜头、参考、原任务和候选。明确结束且没有结果才人工重新提交；不保证推理未计费。"}}
