/** Operator-owned release capability. Metadata never adds an approved origin. */
export function validateImageOrigins(value=[]){
 if(!Array.isArray(value)||value.length>16||new Set(value).size!==value.length)throw Error('IMAGE_ORIGINS_REFUSED');
 for(const origin of value){
  let u;try{u=new URL(origin);}catch{throw Error('IMAGE_ORIGINS_REFUSED');}
  if(typeof origin!=='string'||origin!==u.origin||u.protocol!=='https:'||u.port||u.username||u.password||
   !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|invalid|test|lan|home|arpa)$/.test(u.hostname))throw Error('IMAGE_ORIGINS_REFUSED');
 }
 return Object.freeze([...value]);
}
export function imageContentSecurityPolicy(base,origins=[]){
 const approved=validateImageOrigins(origins);
 if(typeof base!=='string'||(base.match(/(?:^|;)\s*img-src\s+[^;]+/g)??[]).length!==1)throw Error('IMAGE_CSP_REFUSED');
 return base.replace(/((?:^|;)\s*)img-src\s+[^;]+/,(_,prefix)=>prefix+"img-src 'self' blob:"+(approved.length?' '+approved.join(' '):''));
}
export function applyImagePolicy(html,origins=[]){
 const pattern=/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g;
 if(typeof html!=='string'||[...html.matchAll(pattern)].length!==1)throw Error('IMAGE_CSP_REFUSED');
 return html.replace(pattern,(_,base)=>'<meta http-equiv="Content-Security-Policy" content="'+imageContentSecurityPolicy(base,origins)+'">');
}
