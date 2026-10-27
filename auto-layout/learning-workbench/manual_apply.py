"""Send an explicit library selection to the configured local editor."""
import json
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def apply_selection(data, value, editor_origin, active_jobs, read):
    key = value.get('id')
    import re
    if not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,90}', key):
        raise ValueError('分镜ID无效')
    if key in active_jobs:
        raise ValueError('这份排版仍在生成，请完成后再接回；已有结果保留')
    origin = urlparse(editor_origin)
    if (origin.scheme != 'http' or origin.hostname != '127.0.0.1'
            or not origin.port or origin.username or origin.password
            or origin.path not in ('', '/') or origin.query or origin.fragment):
        raise ValueError('未配置可用的本机漫画工作台接回地址')
    script = read(data / 'scripts' / (key + '.json'))
    packet = read(data / 'drafts' / (key + '.json'))
    source = script.get('studioSource', {})
    if not source.get('projectId'):
        raise ValueError('这份排版没有漫画工程来源，请先从漫画工作台送入分镜')
    if script != value.get('script') or packet != value.get('packet'):
        raise ValueError('分镜或排版结果已有更新，请重新打开后再接回')
    request = Request(editor_origin.rstrip('/') + '/api/auto-layout/import',
                      data=json.dumps({'scriptId': key, 'expectedPacket': packet,
                                       'expectedScript': script}, ensure_ascii=False).encode('utf-8'),
                      headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(request, timeout=30) as response:
            project = json.load(response)
    except HTTPError as error:
        try:
            message = json.load(error).get('error')
        except (ValueError, AttributeError):
            message = None
        raise ValueError(message or '漫画工作台拒绝接回，原工程和排版结果保留') from error
    except (URLError, TimeoutError) as error:
        raise ValueError('漫画工作台暂时未响应；原结果保留，重试会核对已有接回记录') from error
    if not isinstance(project, dict) or not re.fullmatch(r'project_[0-9a-f-]{36}', str(project.get('id', ''))):
        raise ValueError('漫画工作台返回的工程编号无效')
    return {'projectId': project['id'], 'title': project.get('title', ''),
            'sourceProjectId': source['projectId'], 'originalPreserved': True,
            'openUrl': editor_origin.rstrip('/') + '/?project=' + project['id']}
