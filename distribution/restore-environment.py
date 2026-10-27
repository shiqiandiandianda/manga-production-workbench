"""Restore a pinned environment ZIP; extended Windows paths keep deeply nested ONNX modules intact."""
import argparse, hashlib, json, os, pathlib, shutil, time, zipfile

def extended(value):
    value=os.path.abspath(value)
    return '\\\\?\\'+value if os.name=='nt' and not value.startswith('\\\\?\\') else value

def sha(file):
    h=hashlib.sha256()
    with open(file,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def restore(code,archive):
    root=pathlib.Path(extended(code)); count=0
    with zipfile.ZipFile(extended(archive)) as z:
        rows=json.loads(z.read('ENVIRONMENT.sha256.json'))
        for row in rows:
            name=row['path']; pieces=name.split('/')
            if not name.startswith(('runtime/','.runtime/image-tools/','comic/public/fonts/','comic/repair-engine/public/fonts/')) or '\\' in name or ':' in name or any(p in ('','.','..') for p in pieces):raise ValueError('Invalid environment path: '+name)
            target=root.joinpath(*pieces); current=root
            for piece in pieces:
                current=current/piece
                if current.is_symlink() or (hasattr(current,'is_junction') and current.is_junction()):raise ValueError('Linked environment path: '+name)
            if target.is_file() and target.stat().st_size==row['bytes'] and sha(target)==row['sha256']:continue
            entry=z.getinfo(name)
            if entry.file_size!=row['bytes']:raise ValueError('Environment length mismatch: '+name)
            target.parent.mkdir(parents=True,exist_ok=True); temporary=pathlib.Path(str(target)+'.installing'); h=hashlib.sha256(); size=0
            with z.open(entry) as src, open(temporary,'wb') as dst:
                for b in iter(lambda:src.read(1024*1024),b''):
                    size+=len(b)
                    if size>row['bytes']:raise ValueError('Oversized environment entry')
                    h.update(b);dst.write(b)
            if size!=row['bytes'] or h.hexdigest()!=row['sha256']:raise ValueError('Environment hash mismatch: '+name)
            if target.exists():
                backup=root/'.runtime'/'installer-backups'/time.strftime('%Y%m%d%H%M%S')/pathlib.Path(*pieces);backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,backup)
            os.replace(temporary,target);count+=1
    return {'ok':True,'entries':len(rows),'restored':count,'longPaths':True}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--archive',required=True);a=p.parse_args();print(json.dumps(restore(a.root,a.archive)))
