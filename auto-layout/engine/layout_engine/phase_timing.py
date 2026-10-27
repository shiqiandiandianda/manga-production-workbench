"""Monotonic, failure-safe timings. Durations are local observations, not speed claims."""
import time
from contextlib import contextmanager
from .model_pipeline import save


class PhaseTimings:
    def __init__(self, path):
        self.path = path
        self.started = time.perf_counter()
        self.entries = []
        self.details = {}
        self.status = 'running'
        self.ended = None

    @contextmanager
    def phase(self, name, **details):
        start = time.perf_counter()
        entry = {'phase': name, 'startOffsetSeconds': round(start-self.started, 6), **details}
        try:
            yield entry
        except BaseException:
            entry['status'] = 'failed'
            raise
        else:
            entry['status'] = 'done'
        finally:
            entry['elapsedSeconds'] = round(time.perf_counter()-start, 6)
            self.entries.append(entry)
            self.flush()

    def snapshot(self):
        return {'timingVersion': 'phase-observation-v1', 'status': self.status,
                'elapsedSeconds': round((self.ended or time.perf_counter())-self.started, 6),
                'phases': self.entries, 'modelQueueSeconds': None, 'firstTokenSeconds': None,
                'unavailableReason': 'CLI文件输出接口不能分离服务排队、首token及输出传输；model_process是整次CLI进程墙钟耗时',
                **self.details}

    def flush(self):
        save(self.path, self.snapshot())

    def finish(self, status, **details):
        self.status = status
        self.ended = time.perf_counter()
        self.details.update(details)
        self.flush()
