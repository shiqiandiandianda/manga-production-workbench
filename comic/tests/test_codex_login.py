import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import codex_worker

class Server:
    def __init__(self, events=None, response=None):
        self.calls = []
        self.response = response or {'loginId': 'mine', 'authUrl': 'https://auth.openai.com/fixture'}
        self.notifications = events or []
    def rpc(self, method, params, timeout=30):
        self.calls.append((method, params))
        return self.response if method == 'account/login/start' else {}
    def events(self, timeout=240, stage='account/login'):
        assert stage == 'account/login'
        yield from self.notifications

def receipt(login_id='mine', success=True):
    return {'method': 'account/login/completed', 'params': {'loginId': login_id, 'success': success}}

class LoginTest(unittest.TestCase):
    def test_real_event_reader_reports_login_timeout_not_image_generation(self):
        server = codex_worker.AppServer.__new__(codex_worker.AppServer)
        server.notifications = codex_worker.deque()
        server.receive = lambda _: (_ for _ in ()).throw(codex_worker.queue.Empty())
        with self.assertRaises(codex_worker.BridgeError) as error:
            list(server.events(timeout=0.01, stage='account/login'))
        self.assertEqual(error.exception.code, 'login_timeout')
        self.assertFalse(error.exception.may_have_started)
        self.assertNotIn('生图', str(error.exception))

    def test_matching_receipt_and_browser_failure_still_exposes_link(self):
        server = Server([receipt('old'), receipt()])
        with patch.object(codex_worker, 'emit') as emit:
            codex_worker.login(server, opener=lambda _: (_ for _ in ()).throw(OSError('no browser')))
        self.assertEqual(emit.call_args_list[0].args[0]['authUrl'], server.response['authUrl'])
        self.assertEqual(emit.call_args_list[-1].args[0], {'type': 'result', 'connected': True})
        self.assertEqual(len(server.calls), 1)

    def test_expiry_or_wrong_receipt_never_reports_success(self):
        server = Server([receipt('other')])
        with patch.object(codex_worker, 'emit') as emit:
            with self.assertRaises(TimeoutError): codex_worker.login(server, opener=lambda _: None)
        self.assertFalse(any(x.args[0].get('connected') for x in emit.call_args_list))
        self.assertEqual(server.calls[-1], ('account/login/cancel', {'loginId': 'mine'}))

    def test_failure_is_not_success_and_does_not_leak_raw_error(self):
        server = Server([{'method': 'account/login/completed', 'params': {'loginId': 'mine', 'success': False, 'error': 'secret'}}])
        with patch.object(codex_worker, 'emit'):
            with self.assertRaisesRegex(RuntimeError, '官方登录未完成') as error: codex_worker.login(server, opener=lambda _: None)
        self.assertNotIn('secret', str(error.exception))

    def test_device_code_uses_official_protocol(self):
        server = Server([receipt()], {'loginId': 'mine', 'verificationUrl': 'https://auth.openai.com/codex/device', 'userCode': 'ABCD-1234'})
        with patch.object(codex_worker, 'emit') as emit:
            codex_worker.login(server, 'device', opener=lambda _: None)
        self.assertEqual(server.calls[0][1], {'type': 'chatgptDeviceCode'})
        self.assertEqual(emit.call_args_list[0].args[0]['userCode'], 'ABCD-1234')

    def test_unsafe_or_missing_login_urls_are_rejected(self):
        for url in ['http://auth.openai.com/', 'https://chatgpt.com.evil.test/', 'https://user:pass@chatgpt.com/', 'https://chatgpt.com:999/', None]:
            with self.subTest(url=url), self.assertRaises(ValueError): codex_worker.official_login_url(url)

if __name__ == '__main__': unittest.main()
