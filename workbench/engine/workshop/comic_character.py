"""One comic character candidate, executed by the existing character engine."""


def run(worker, job, directory, update):
    prompt = (
        '制作一项漫画角色资产候选，交付一张可审核的角色参考图。\n'
        '严格遵照下列角色、服装、状态和画风要求；已有参考保持人物身份。\n'
        '不混入其他角色，不添加对白气泡、水印或未要求的说明文字。\n'
        + job['instructions']
    )
    refs = worker.references(*job.get('references', []))
    update(phase='character_generation', message='角色工房正在生成漫画角色资产候选')
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        source = worker._turn(client, directory, prompt, refs, update=update, image=True)
    image = worker._save_generated(source, directory, 'comic-character')
    return {'files': [image], 'message': '角色候选已生成，等待漫画端确认'}
