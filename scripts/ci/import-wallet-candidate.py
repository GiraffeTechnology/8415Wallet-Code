"""Import one immutable draft candidate. No publication, credentials setup or deploy."""
import hashlib, json, os, pathlib, signal, subprocess, sys, tarfile, urllib.request, urllib.error, urllib.parse

REPO = 'GiraffeTechnology/8415Wallet-Code'
RELEASE = 426029722
ASSET = 682998552
SIZE = 58063038
ARCHIVE_SHA = 'd090844d52c63cbea3d074d43fa626b9b451f8e90f9dc095e8cb04355a4a6f67'
TREE = '15164dd9f90426f8bf3af9b1ed6a1898510df253'
SOURCE_SHA = '7afaa2d720daeb990c6283f9948e627086dd55ab93c6b8297748649b79f2b25c'
NAME = f'8415wallet-dapp-delivery-{TREE}.tar.gz'
STAGE = 'initialization'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def require(value):
    if not value: raise ValueError('candidate identity or archive invariant failed')

def sha(path):
    h = hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def object_id(kind, data):
    return hashlib.sha1(kind.encode()+b' '+str(len(data)).encode()+b'\0'+data).digest()

def source_tree(entries):
    root={}
    for name,mode,data in entries:
        node=root;parts=name.split('/')
        for part in parts[:-1]:
            node=node.setdefault(part,{})
            require(isinstance(node,dict))
        require(parts[-1] not in node)
        node[parts[-1]]=(b'100755' if mode&0o111 else b'100644',object_id('blob',data))
    def tree(node):
        result=[]
        for name,value in node.items():
            directory=isinstance(value,dict)
            mode,digest=(b'40000',tree(value)) if directory else value
            result.append((name.encode()+(b'/' if directory else b''), mode+b' '+name.encode()+b'\0'+digest))
        return object_id('tree',b''.join(v for k,v in sorted(result)))
    return tree(root).hex()

def unpack(path,target,source=False):
    require(not target.exists()); target.mkdir(mode=0o700)
    entries=[]; seen=set();total=0
    with tarfile.open(path,'r:gz') as archive:
        for member in archive:
            raw=member.name
            name=raw[2:] if raw.startswith('./') else raw
            if name in ('','.'):require(member.isdir());continue
            parts=name.split('/')
            require(not name.startswith('/') and all(p not in ('','..','.') for p in parts))
            require(name not in seen);seen.add(name)
            require(member.isdir() or member.isfile())
            dest=target.joinpath(*parts)
            if member.isdir():dest.mkdir(parents=True,exist_ok=True);continue
            require(0<=member.size<=128*1024*1024)
            total+=member.size;require(total<=512*1024*1024 and len(seen)<=50000)
            data=archive.extractfile(member).read();require(len(data)==member.size)
            entries.append((name,member.mode,data))
        # Validate all paths and identities before writing any file.
        require(not source or (len(entries)==1014 and source_tree(entries)==TREE))
        for name,mode,data in entries:
            dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('xb') as f:f.write(data)
            dest.chmod(0o755 if mode&0o111 else 0o644)
    return entries

def fetch_asset(destination):
    token=os.environ.pop('GH_TOKEN')
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    api=f'https://api.github.com/repos/{REPO}'
    opener=urllib.request.build_opener(NoRedirect())
    with opener.open(urllib.request.Request(f'{api}/releases/{RELEASE}',headers=headers),timeout=60) as response:
        release=json.load(response)
    require(release['id']==RELEASE and release['draft'] is True and release['published_at'] is None)
    assets=[a for a in release['assets'] if a['id']==ASSET]
    require(len(assets)==1 and assets[0]['name']==NAME and assets[0]['size']==SIZE and assets[0]['state']=='uploaded')
    headers['Accept']='application/octet-stream'
    opener=urllib.request.build_opener(NoRedirect())
    try:
        response=opener.open(urllib.request.Request(f'{api}/releases/assets/{ASSET}',headers=headers),timeout=60)
    except urllib.error.HTTPError as error:
        require(error.code in (301,302,303,307,308))
        location=error.headers['Location'];url=urllib.parse.urlparse(location)
        require(url.scheme=='https' and url.hostname in ('release-assets.githubusercontent.com','objects.githubusercontent.com'))
        # Signed download URL gets no Authorization header, including cross-origin redirects.
        response=urllib.request.urlopen(urllib.request.Request(location),timeout=60)
    del token,headers
    with response,destination.open('xb') as output:
        count=0
        while True:
            chunk=response.read(1024*1024)
            if not chunk:break
            count+=len(chunk);require(count<=SIZE);output.write(chunk)
    require(count==SIZE and sha(destination)==ARCHIVE_SHA)

def main():
    global STAGE
    require(os.environ.get('GITHUB_REPOSITORY')==REPO)
    root=pathlib.Path(os.environ['RUNNER_TEMP'])/'wallet-candidate-15164'
    require(not root.exists());root.mkdir(mode=0o700)
    package=root/NAME;STAGE='draft_download';fetch_asset(package)
    STAGE='outer_import';outer=root/'outer';unpack(package,outer)
    manifest=json.loads((outer/'DELIVERY.json').read_text())
    require(manifest['source']['tree']==TREE)
    source=outer/'artifacts'/f'8415wallet-source-{TREE}.tar.gz'
    require(sha(source)==SOURCE_SHA)
    STAGE='source_tree_import';candidate=root/'source';unpack(source,candidate,source=True)
    # Packers need Git objects. This runner-local root commit is explicitly synthetic,
    # never pushed and never represented as the upstream source commit.
    STAGE='local_git_snapshot'
    def git(*args, input=None):
        return subprocess.check_output(['git',*args],cwd=candidate,input=input,stderr=subprocess.PIPE).strip()
    git('init','--quiet','--object-format=sha1','--initial-branch=candidate-ci','--template=')
    git('add','--force','--all')
    require(git('write-tree').decode()==TREE)
    commit_bytes=(f'tree {TREE}\nauthor Candidate CI <candidate-ci@example.invalid> 0 +0000\ncommitter Candidate CI <candidate-ci@example.invalid> 0 +0000\n\nSynthetic runner-local candidate snapshot; not upstream commit.\n').encode()
    synthetic_commit=git('hash-object','-t','commit','-w','--stdin',input=commit_bytes)
    git('update-ref','refs/heads/candidate-ci',synthetic_commit.decode())
    # Run unchanged strict validators with externally fixed pins, never trust an archive's own assertion alone.
    STAGE='strict_verification'
    with (root/'strict-verifier.private.log').open('wb') as log:
        child=subprocess.Popen(['node','--max-old-space-size=192',str(candidate/'scripts/package/verify-delivery.mjs'),'--archive',str(package),'--sha256',ARCHIVE_SHA,'--tree',TREE,'--extract',str(root/'runtime'),'--progress','true'],stdout=log,stderr=log,start_new_session=True)
        try: status=child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGTERM)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);child.wait()
            raise
    require(status==0)
    with open(os.environ['GITHUB_ENV'],'a') as env:env.write(f'WALLET_CANDIDATE_SOURCE={candidate}\n')
    print(json.dumps({'candidate_tree':TREE,'archive_sha256':ARCHIVE_SHA,'source_files':1014,'strict_integrity':'passed','source_commit_ci':'not_established'}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        # Never emit a signed URL, private source, environment or raw stack trace in public Actions logs.
        print(json.dumps({'status':'failed','stage':STAGE,'error_type':type(error).__name__,'http_status':error.code if isinstance(error,urllib.error.HTTPError) else None}),file=sys.stderr)
        sys.exit(1)
