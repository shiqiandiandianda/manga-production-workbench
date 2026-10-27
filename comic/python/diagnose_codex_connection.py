"""Local transport probe. No prompts, turn/start, generation, login, or credential-file reads."""
import argparse
import json
from pathlib import Path
from codex_worker import AppServer, account_status
from native_diagnostics import safe_text

parser = argparse.ArgumentParser()
parser.add_argument('--codex-command', required=True)
parser.add_argument('--directory', required=True)
parser.add_argument('--server-cwd')
args = parser.parse_args()
directory = Path(args.directory).resolve(strict=True)
server = None
report = {'realAI': False, 'turnStartSent': False}
try:
    server = AppServer(json.loads(args.codex_command), args.server_cwd or str(directory))
    report['accountConnected'] = account_status(server, force=True)['connected']
    result = server.rpc('thread/start', {'cwd': str(directory), 'sandbox': 'workspace-write', 'approvalPolicy': 'on-request', 'approvalsReviewer': 'auto_review', 'ephemeral': True, 'modelProvider': 'openai', 'config': {'features.image_generation': True}}, timeout=45)
    report['threadReady'] = bool(result.get('thread', {}).get('id'))
    report['model'] = result.get('model')
except Exception as error:
    report.update(threadReady=False, error=safe_text(error, 2000), errorCode=getattr(error, 'code', None))
finally:
    if server:
        server.close()
        report['exitCode'] = server.process.returncode
        report['stderr'] = safe_text(server.stderr, 4000)
print(json.dumps(report, ensure_ascii=True), flush=True)
