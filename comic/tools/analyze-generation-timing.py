"""Summarise where background image-generation time goes, from existing job records.

Reads only jobs/*/automation.json (no network, no Codex). Run from the package root:

    python tools/analyze-generation-timing.py              # all completed jobs
    python tools/analyze-generation-timing.py --days 3     # only the last 3 days
    python tools/analyze-generation-timing.py --csv timing.csv

Columns (seconds):
  startup  worker start -> turn/start sent (app-server start, login/capability checks, thread/start, crop prep)
  think    turn/start -> first native image starts (model reading prompt and images before calling the tool)
  image    from the first native image starting to the last one finishing (two parallel images overlap)
  between  idle gap between image 1 ending and image 2 starting (old serial bubble jobs; 0 when parallel)
  tail     last image finished -> turn/completed (final message / JSON)
  after    turn/completed -> job completed (review turn, local checks, file writes)
  total    whole attempt
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
from pathlib import Path


def kind_of(state: dict) -> str:
    version = state.get('workflowVersion')
    if version == 3:
        return 'V3 气泡分离'
    if version == 2 or state.get('textSource') == 'human-confirmed-original':
        return 'V2 校对后去字'
    return '普通修图'


def number(value):
    return value if isinstance(value, (int, float)) else None


def analyse(state: dict) -> dict | None:
    if state.get('status') != 'completed':
        return None
    timing = state.get('generationTiming') or {}
    started = number(state.get('startedAt'))
    requested = number(timing.get('requestedAt'))
    finished = number(state.get('updatedAt'))
    turn_done = number(timing.get('turnCompletedAt'))
    if turn_done is None:
        turn_done = number(timing.get('nativeAcceptedAt'))
    if turn_done is None:
        # Parallel V3 attempts record completion per image role, not at the top level.
        ends = [number(turn.get('turnCompletedAt')) or number(turn.get('finishedAt'))
                for role, turn in (timing.get('turns') or {}).items()
                if role in ('bubbles', 'background') and isinstance(turn, dict)]
        if ends and all(end is not None for end in ends):
            turn_done = max(ends)
    images = sorted((image for image in timing.get('images') or [] if number(image.get('startedAt')) and number(image.get('completedAt'))),
                    key=lambda image: image['startedAt'])
    row = {'kind': kind_of(state), 'effort': (state.get('generationReasoning') or {}).get('effectiveEffort'),
           'images': len(images), 'startup': None, 'think': None, 'image': None, 'between': None,
           'tail': None, 'after': None, 'total': number(state.get('elapsedSeconds'))}
    if started and requested:
        row['startup'] = requested - started
    if requested and images:
        row['think'] = images[0]['startedAt'] - requested
        row['image'] = max(image['completedAt'] for image in images) - images[0]['startedAt']
        if len(images) > 1:
            row['between'] = max(0, images[1]['startedAt'] - images[0]['completedAt'])
        if turn_done:
            row['tail'] = turn_done - max(image['completedAt'] for image in images)
    if turn_done and finished:
        row['after'] = finished - turn_done
    return row


def summary(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return '   -        -   '
    p90 = values[min(len(values) - 1, round(0.9 * (len(values) - 1)))]
    return f'{statistics.median(values):6.1f}  {p90:6.1f}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jobs', type=Path, default=Path(__file__).resolve().parents[1] / '补图工作台' / 'jobs')
    parser.add_argument('--days', type=float)
    parser.add_argument('--csv', type=Path)
    args = parser.parse_args()
    cutoff = time.time() - args.days * 86400 if args.days else 0
    rows = []
    for file in sorted(args.jobs.glob('*/automation.json')):
        try:
            state = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if (number(state.get('startedAt')) or 0) < cutoff:
            continue
        row = analyse(state)
        if row:
            rows.append({'job': file.parent.name, **row})
    if not rows:
        print('没有找到已完成且带计时记录的任务。')
        return
    columns = ['startup', 'think', 'image', 'between', 'tail', 'after', 'total']
    print(f'{"类型":<12}{"数量":>5}  ' + ''.join(f'{name:>16}' for name in columns))
    print(' ' * 19 + ''.join(f'{"中位   P90":>16}' for _ in columns))
    for kind in sorted({row['kind'] for row in rows}):
        group = [row for row in rows if row['kind'] == kind]
        print(f'{kind:<12}{len(group):>5}  ' + ''.join(f'{summary(row[name] for row in group):>16}' for name in columns))
    if args.csv:
        with args.csv.open('w', newline='', encoding='utf-8-sig') as handle:
            writer = csv.DictWriter(handle, fieldnames=['job', 'kind', 'effort', 'images', *columns])
            writer.writeheader()
            writer.writerows(rows)
        print(f'逐条记录已写入 {args.csv}')


if __name__ == '__main__':
    main()
