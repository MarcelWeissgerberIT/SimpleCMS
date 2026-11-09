#!/usr/bin/env python3
"""Operator-side frontend-only release. Never recreates containers or runs migrations.
Requires an existing base image, a delta archive with full manifest.json, and expected compose hash.
"""
from pathlib import Path
import argparse, fcntl, hashlib, json, subprocess, tarfile, shutil, re, os, tempfile
p=argparse.ArgumentParser(description=__doc__)
for arg in ['archive','sha256','image','base-image','compose','compose-sha256','container','release-dir','source']:
    p.add_argument('--'+arg,required=True)
a=p.parse_args()
assert re.fullmatch(r'[a-f0-9]{40}',a.source), 'Expected source commit'
assert all(re.fullmatch(r'[a-zA-Z0-9_./:-]+',x) for x in [a.base_image,a.image]), 'Invalid image reference'
def run(*args): return subprocess.check_output(args,text=True).strip()
def dx(*args): return run('docker','exec','--user','0',a.container,*args)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def replace_text(path,text):
    stat=path.stat()
    fd,name=tempfile.mkstemp(prefix=path.name+'.release-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as file:
            file.write(text);file.flush();os.fsync(file.fileno())
        os.chmod(name,stat.st_mode & 0o777);os.chown(name,stat.st_uid,stat.st_gid)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
compose=Path(a.compose); root=Path(a.release_dir); archive=Path(a.archive)
# Serialize releases; expected hashes additionally catch deployment through other tools.
with open(str(compose)+'.frontend-lock','a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert sha(compose)==a.compose_sha256, 'Compose changed'
    assert sha(archive)==a.sha256, 'Archive hash mismatch'
    assert subprocess.run(['docker','image','inspect',a.image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0, 'Image tag already exists'
    old=compose.read_text(); assert old.count(a.base_image)==1, 'Unexpected base image'
    assert not root.exists(), 'Release directory already exists'
    assert shutil.disk_usage(compose.parent).free>250*1024*1024, 'Insufficient staging space'
    identity=run('docker','inspect',a.container,'--format','{{.Id}} {{.State.StartedAt}}')
    backend=dx('sha256sum','/app/server/dist/index.js').split()[0]
    root.mkdir(mode=0o755)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert member.name=='manifest.json' or member.name.startswith('dist/'), 'Unexpected archive member'
            assert not member.issym() and not member.islnk(), 'Release links not allowed'
        tar.extractall(root,filter='data')
    for file in root.rglob('*'): file.chmod(0o755 if file.is_dir() else 0o644)
    manifest=json.loads((root/'manifest.json').read_text())
    for file in (root/'dist').rglob('*'):
        if file.is_file():assert manifest.get(file.relative_to(root).as_posix())==sha(file), 'Unverified delta file'
    (root/'Dockerfile').write_text(f'FROM {a.base_image}\nCOPY dist /app/dist\nLABEL one.source="{a.source}"\n')
    run('docker','build','-q','-t',a.image,str(root))
    verify='const f=require("fs"),c=require("crypto");for(const[p,h]of Object.entries(JSON.parse(f.readFileSync("/tmp/frontend-manifest.json"))))if(c.createHash("sha256").update(f.readFileSync("/app/"+p)).digest("hex")!==h)throw Error(p)'
    run('docker','run','--rm','--network','none','-v',str(root/'manifest.json')+':/tmp/frontend-manifest.json:ro',a.image,'node','-e',verify)
    assert run('docker','run','--rm','--network','none',a.image,'sha256sum','/app/server/dist/index.js').split()[0]==backend, 'Backend differs: use a planned backend release'
    stage='/app/.frontend-'+a.source[:12]
    dx('mkdir','-p',stage)
    run('docker','cp',str(root/'dist'),a.container+':'+stage+'/dist')
    run('docker','cp',str(root/'manifest.json'),a.container+':'+stage+'/manifest.json')
    publisher=Path(__file__).parent/'lib'/'frontend-publish.cjs'
    run('docker','cp',str(publisher),a.container+':'+stage+'/publish.cjs')
    assert compose.read_text()==old and run('docker','inspect',a.container,'--format','{{.Id}} {{.State.StartedAt}}')==identity, 'Deployment changed during preparation'
    (root/'compose.before.yml').write_text(old);(root/'compose.before.yml').chmod(0o600)
    # Pin the verified image for the next normal restart. Do NOT run compose up.
    replace_text(compose,old.replace(a.base_image,a.image))
    try:
        result=json.loads(dx('node',stage+'/publish.cjs','/app',stage,stage+'/manifest.json'))
    except Exception:
        replace_text(compose,old)
        raise
    assert run('docker','inspect',a.container,'--format','{{.Id}} {{.State.StartedAt}}')==identity, 'Unexpected container restart'
    assert dx('sha256sum','/app/server/dist/index.js').split()[0]==backend
    result.update(image=a.image,source=a.source,containerIdentity=identity,backendUnchanged=True,restarted=False,composeSha256=sha(compose))
    (root/'published.json').write_text(json.dumps(result,indent=2))
    dx('rm','-rf',stage)
    print(json.dumps(result))
