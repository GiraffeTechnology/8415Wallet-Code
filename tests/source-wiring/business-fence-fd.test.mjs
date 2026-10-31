import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Definition only in this candidate. Requires approved POSIX test environment
// with Python 3; actual inherited socketpair (no TCP/HTTP) and synthetic peer.
const moduleUrl=new URL('../../server/task-business-fence-fd.mjs',import.meta.url).href;
function scenario(mode){
 const program=`
import socket,subprocess,threading,json,sys,time
parent,child=socket.socketpair()
mode=sys.argv[1]
def serve():
 try:
  stream=parent.makefile('rwb',buffering=0)
  h=json.loads(stream.readline())
  assert h=={'seq':0,'action':'hello'}
  if mode=='timeout':
   time.sleep(.3);return
  if mode=='duplicate':
   stream.write(b'{"seq":0,"seq":0,"ok":true,"channel":{}}\\n');return
  if mode=='utf8':
   stream.write(b'{"bad":"\\xff"}\\n');return
  source={'commit':'a'*40,'tree':('c' if mode=='mismatch' else 'b')*40}
  stream.write((json.dumps({'seq':0,'ok':True,'channel':{'schema':'8415-ex-fence-channel/1','source':source,'scope':'scope'}})+'\\n').encode())
  if mode=='mismatch':return
  q=json.loads(stream.readline());assert q['seq']==1 and q['action']=='claim'
  stream.write((json.dumps({'seq':99,'ok':True,'receipt':{'scope':'scope'}})+'\\n').encode())
 except (BrokenPipeError,ValueError):pass
 finally:parent.close()
t=threading.Thread(target=serve);t.start()
p=subprocess.run(['node','--input-type=module','-e',sys.argv[2],str(child.fileno())],pass_fds=(child.fileno(),),capture_output=True,text=True)
child.close();t.join();sys.stdout.write(p.stdout);sys.stderr.write(p.stderr);sys.exit(p.returncode)
`;
 const js=`import assert from 'node:assert/strict';import {createInheritedBusinessFence} from ${JSON.stringify(moduleUrl)};
 const create=()=>createInheritedBusinessFence({fd:Number(process.argv[1]),expectedSource:{commit:'a'.repeat(40),tree:'b'.repeat(40)},scope:'scope',timeoutMs:50});
 ${mode==='sequence'?`const fence=await create();await assert.rejects(fence.claim({}));await assert.rejects(fence.claim({}));`:`await assert.rejects(create());`}`;
 const r=spawnSync('python3',['-c',program,mode,js],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,r.stderr||String(r.error));
}
test('inherited fence refuses different source handshake',()=>scenario('mismatch'));
test('inherited fence poisons timeout without reconnect',()=>scenario('timeout'));
test('inherited fence poisons wrong sequence and later requests',()=>scenario('sequence'));

test('inherited fence refuses duplicate JSON keys',()=>scenario('duplicate'));
test('inherited fence refuses malformed UTF8',()=>scenario('utf8'));
