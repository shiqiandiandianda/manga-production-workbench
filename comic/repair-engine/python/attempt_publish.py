"""Publish a finished attempt's files into its job folder, now or after a human decision.

A pipeline prepares every result file inside attempts/<attempt id>/ first and records
them in publish.json. When the Codex review passes, the pipeline publishes at once.
When the review flags a problem, nothing is published; the job ends as failed with
phase "visual_review_rejected" and publishable=true, so a person can look at the
images and accept them (``python page_store.py accept-attempt --job <dir>``) instead
of paying for a new generation.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import time
import uuid

MANIFEST = 'publish.json'
REJECTED_PHASE = 'visual_review_rejected'
ALLOWED_TARGETS = {'repaired.png', 'patch.png', 'bubble-sheet.png', 'bubble-layers.json', 'editable-text.json',
                   *(f'bubble-{index}.png' for index in range(1, 13))}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: dict):
    temporary = path.with_name(f'{path.name}.{uuid.uuid4().hex}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    _replace(temporary, path)


def _replace(temporary: Path, target: Path):
    for attempt in range(9):
        try:
            temporary.replace(target)
            return
        except PermissionError:
            if attempt == 8:
                raise
            time.sleep(min(.2, .02 * (attempt + 1)))


def write_manifest(attempt_dir: Path, job_id: str, attempt_id: str, files: list[tuple[str, str]],
                   guarded: dict[str, str], source_hash: str, completion: dict):
    """files: (name inside attempt_dir, name inside the job folder), published in this order.
    guarded: job-folder input files whose SHA-256 must be unchanged at publication."""
    for source, target in files:
        if Path(source).name != source or target not in ALLOWED_TARGETS:
            raise ValueError('待发布文件名无效')
        if not (attempt_dir / source).is_file():
            raise ValueError(f'待发布文件缺失：{source}')
    _atomic_json(attempt_dir / MANIFEST, {
        'schemaVersion': 1, 'jobId': job_id, 'attemptId': attempt_id,
        'files': [[source, target] for source, target in files],
        'fileHashes': {source: file_hash(attempt_dir / source) for source, _ in files},
        'guarded': guarded, 'sourceHash': source_hash, 'completion': completion})


def publish(job_dir: Path, attempt_dir: Path):
    """Copy the recorded files into the job folder. repaired.png is written last."""
    manifest = json.loads((attempt_dir / MANIFEST).read_text(encoding='utf-8'))
    ordered = sorted(manifest['files'], key=lambda pair: pair[1] == 'repaired.png')
    # Validate the whole attempt before replacing any existing job result.
    for source, target in ordered:
        if target not in ALLOWED_TARGETS or Path(source).name != source:
            raise ValueError('待发布文件名无效')
        origin = attempt_dir / source
        if origin.is_symlink() or file_hash(origin) != manifest['fileHashes'][source]:
            raise ValueError('待发布文件已被改动，未接回')
    for source, target in ordered:
        origin = attempt_dir / source
        temporary = job_dir / f'{target}.{uuid.uuid4().hex}.tmp'
        shutil.copyfile(origin, temporary)
        _replace(temporary, job_dir / target)
    return manifest


def accept(job_dir: Path) -> dict:
    """Publish a review-rejected attempt after a person chose to keep it."""
    from job_inputs import base_image
    job_dir = Path(job_dir).resolve()
    state = json.loads((job_dir / 'automation.json').read_text(encoding='utf-8'))
    attempt_id = state.get('attemptId')
    if state.get('phase') != REJECTED_PHASE or state.get('publishable') is not True:
        raise ValueError('这个任务没有可直接采用的结果')
    if not isinstance(attempt_id, str) or len(attempt_id) != 32 or any(c not in '0123456789abcdef' for c in attempt_id):
        raise ValueError('任务尝试编号无效')
    attempt_dir = job_dir / 'attempts' / attempt_id
    if attempt_dir.is_symlink() or not (attempt_dir / MANIFEST).is_file():
        raise ValueError('这次结果的发布记录缺失，请重新生成')
    try:
        cancel = json.loads((job_dir / 'cancel-requested.json').read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        cancel = {}
    if cancel.get('attemptId') == attempt_id:
        raise ValueError('这次任务已取消，不能采用')
    manifest = json.loads((attempt_dir / MANIFEST).read_text(encoding='utf-8'))
    request = json.loads((job_dir / 'request.json').read_text(encoding='utf-8'))
    if manifest.get('jobId') != request.get('id') or manifest.get('attemptId') != attempt_id:
        raise ValueError('发布记录与任务不匹配')
    if file_hash(base_image(job_dir, request)) != manifest.get('sourceHash') or request.get('sourceHash') != manifest.get('sourceHash'):
        raise ValueError('原图已变化，不能采用这次结果，请重新生成')
    for name, digest in (manifest.get('guarded') or {}).items():
        file = job_dir / name
        if Path(name).name != name or not file.is_file() or file.is_symlink() or file_hash(file) != digest:
            raise ValueError('选区原图、蒙版或确认原文已变化，不能采用这次结果，请重新生成')
    if request.get('workflowVersion') == 2 and request.get('autoText') is True:
        # The confirmed dialogue must still belong to this exact crop and selection frame.
        from confirmed_text import load_confirmed_text
        load_confirmed_text(job_dir, request)
    publish(job_dir, attempt_dir)
    now = time.time()
    history = list(state.get('phaseHistory') or [])
    if history and 'finishedAt' not in history[-1]:
        history[-1] = {**history[-1], 'finishedAt': now}
    history.append({'phase': 'completed', 'startedAt': now, 'acceptedByPerson': True})
    issues = '；'.join(state.get('reviewIssues') or []) or '未说明'
    accepted = {**state, **(manifest.get('completion') or {}), 'status': 'completed', 'phase': 'completed',
                'publishable': False, 'acceptedDespiteReview': True, 'requiresVisualReview': True,
                'reviewNotice': f'已按人工判断采用这次结果。Codex 复核曾提示：{issues}。请再检查一遍。',
                'message': '已按人工判断采用，正在接回图层', 'updatedAt': now, 'phaseHistory': history}
    _atomic_json(job_dir / 'automation.json', accepted)
    return accepted
