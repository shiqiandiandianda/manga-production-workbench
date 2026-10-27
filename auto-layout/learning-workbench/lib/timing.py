"""Monotonic generation timing, with display timestamps in Asia/Shanghai."""
import time
from datetime import datetime,timezone,timedelta

def timestamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='milliseconds')

class PhaseTimer:
    def __init__(self,clock=time.monotonic):
        self.clock=clock;self.start=self.changed=clock();self.started_at=timestamp();self.phase='queued';self.durations={}

    def snapshot(self,phase,finished=False):
        now=self.clock()
        if phase!=self.phase:
            self.durations[self.phase]=self.durations.get(self.phase,0)+now-self.changed
            self.phase=phase;self.changed=now
        durations=self.durations|{self.phase:self.durations.get(self.phase,0)+now-self.changed}
        result={'startedAt':self.started_at,'elapsedSeconds':round(now-self.start,3),'phaseSeconds':{k:round(v,3) for k,v in durations.items()}}
        if finished:result['finishedAt']=timestamp()
        return result
