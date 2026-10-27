import os,sys,runpy,socket,subprocess,re
original_connect=socket.socket.connect
def connect(sock,address):
 if isinstance(address,tuple) and address[0] not in ('127.0.0.1','localhost','::1','0.0.0.0'):
  raise RuntimeError('QUALITY_GUARD: external Python socket blocked')
 return original_connect(sock,address)
socket.socket.connect=connect
original_popen=subprocess.Popen
class GuardedPopen(original_popen):
 def __init__(self,args,*a,**kw):
  cmd=args[0] if isinstance(args,(list,tuple)) else str(args).split()[0]
  if re.search(r'(?:^|[\\/])(docker|ssh|scp|sudo|codex|dreamina|jimeng|powershell|pwsh|cmd)(?:\.exe|\.cmd)?$',str(cmd),re.I):
   raise RuntimeError('QUALITY_GUARD: privileged or real generator CLI blocked')
  super().__init__(args,*a,**kw)
subprocess.Popen=GuardedPopen
file=os.path.abspath(sys.argv[1]);sys.argv=[file];sys.path.insert(0,os.path.dirname(file));runpy.run_path(file,run_name='__main__')
