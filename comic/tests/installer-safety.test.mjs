import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script=['../../installer.ps1','../installer.ps1','../../delivery/installer.ps1'].map(relative=>path.resolve(import.meta.dirname,relative)).find(file=>fs.existsSync(file));
test('Windows installer source uses BOM, a fresh D-drive target and copy-only operations',{skip:!script},()=>{
  const bytes=fs.readFileSync(script),source=bytes.toString('utf8');
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);
  assert.match(source,/if \(Test-Path -LiteralPath \$Destination\) \{ throw/);
  assert.match(source,/GetPathRoot\(\$Destination\) -ine 'D:\\'/);
  assert.match(source,/robocopy\.exe \$Source \$Target \/E \/COPY:DAT/);
  assert.doesNotMatch(source,/robocopy[^\n]*(?:\/MIR|\/MOVE|\/PURGE)/i);
  assert.doesNotMatch(source,/Remove-Item|Stop-Process|taskkill|Invoke-WebRequest|npm install/i);
  assert.match(source,/\/XD \.git \.codex \.cache \.runtime/);
  assert.match(source,/\/XF auth\.json config\.toml config\.local\.bat \.env/);
  assert.match(source,/storage-config\.before-integration\.json/);
  assert.match(source,/automation\.before-integration\.json/);
  assert.match(source,/\[System\.IO\.Directory\]::Move\(\$Staging, \$Destination\)/);
});
