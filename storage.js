'use strict';
/* No credentials are stored here or persisted by this adapter. */
(function(root){
 const FIELDS=['title','purpose','inputs','outputs','rules','activation','pending','notes','timeframes','review'];
 const encode=text=>{const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)};
 const decode=text=>new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0)));
 function validate(doc){
  if(!doc||doc.schema_version!==1||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.nodes)||!Array.isArray(doc.trash)||typeof doc.notes!=='string'||doc.notes.length>100000)throw Error('Documento incompatível.');
  const nodes=[...doc.nodes,...doc.trash],ids=new Set();
  if(nodes.length>500)throw Error('Limite de 500 itens.');
  for(const n of nodes){
   if(!n||typeof n.id!=='string'||ids.has(n.id)||!['agent','skill','note','data'].includes(n.kind)||!FIELDS.every(f=>typeof n[f]==='string'&&n[f].length<=100000)||!n.title.trim()||!Array.isArray(n.sources)||!n.sources.every(s=>typeof s==='string')||(n.parent!=null&&typeof n.parent!=='string'))throw Error('Item inválido no documento.');
   ids.add(n.id);
  }
  const lanes=new Set(doc.nodes.filter(n=>['agent','data'].includes(n.kind)).map(n=>n.id));
  if(doc.nodes.some(n=>(['agent','data'].includes(n.kind)&&n.parent!=null)||(n.parent!=null&&!lanes.has(n.parent))))throw Error('Grupo inválido no documento.');
  if(new TextEncoder().encode(JSON.stringify(doc)).length>4000000)throw Error('Documento deve ter até 4 MB.');
  return doc;
 }
 function fail(message,status){const e=new Error(message);e.status=status;return e}
 class LocalStorageAdapter{
  constructor(){this.cloud=false;this.label='projeto local';this.delay=700;this.key='smc-method-unsaved-v1'}
  async load(){const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('Não foi possível abrir o documento local.');const data=await r.json();this.token=data.token;return data}
  async save(document,revision){const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Token':this.token},body:JSON.stringify({expected_revision:revision,document})});const data=await r.json();if(!r.ok)throw fail(data.error,r.status);return data}
  async sources(){const r=await fetch('/api/sources');if(!r.ok)throw Error('Não foi possível carregar as fontes.');this.catalog=await r.json();return this.catalog}
  async source(name){return this.catalog[name]}
 }
 class GitHubStorage{
  #token='';
  constructor({owner='engcolombo',repo='SMC_Agentes',branch='main',fetcher=(...args)=>root.fetch(...args)}={}){
   if(!/^[\w.-]+$/.test(owner)||!/^[\w.-]+$/.test(repo))throw Error('Repositório inválido.');
   this.owner=owner;this.repo=repo;this.branch=branch;this.fetcher=fetcher;this.base=`https://api.github.com/repos/${owner}/${repo}`;
   this.cloud=true;this.label='GitHub';this.delay=5000;this.key=`smc-github-draft-v1:${owner}/${repo}:${branch}`;this.path='visual/method.json';this.sha=null;this.revision=null;this.catalog={};
  }
  connect(token){this.#token=token.trim();if(!this.#token)throw Error('Cole sua credencial do GitHub.');}
  disconnect(){this.#token='';this.sha=null;this.revision=null;this.catalog={}}
  async request(path,options={}){
   if(!this.#token)throw fail('Conecte sua conta do GitHub para continuar.',401);
   let r;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{r=await this.fetcher(this.base+path,{...options,signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+this.#token,...(options.body?{'Content-Type':'application/json'}:{})}})}
   catch(e){throw fail(e.name==='AbortError'?'O GitHub demorou para responder. Tente conectar novamente.':'Não foi possível conectar ao GitHub. Verifique sua conexão e tente novamente. Se persistir, abra o site diretamente no Chrome ou Edge.',0)}
   finally{clearTimeout(timeout)}
   if(!r.ok){
    const messages={401:'Credencial inválida ou expirada. Reconecte sua conta.',403:'GitHub recusou o acesso. Verifique Contents: Read and write, a validade da credencial e os limites da API.',404:'Arquivo ou repositório não acessível. Selecione SMC_Agentes na credencial do GitHub.',409:'Outro aparelho salvou alterações. Baixe sua cópia antes de recarregar o quadro.',422:'O GitHub não aceitou a gravação. Confira permissões e recarregue o quadro mantendo seu rascunho.'};
    throw fail(messages[r.status]||`GitHub indisponível (HTTP ${r.status}). Tente novamente.`,r.status);
   }
   return r.json();
  }
  filePath(name){return '/contents/'+name.split('/').map(encodeURIComponent).join('/')}
  async readFile(name){
   const value=await this.request(this.filePath(name)+'?ref='+encodeURIComponent(this.branch));
   if(value.encoding==='base64'&&typeof value.content==='string'&&value.content)return {text:decode(value.content),sha:value.sha};
   // Contents responses omit data for files over 1 MB. Fetch the authenticated blob.
   if(!/^[a-f0-9]{40,64}$/.test(value.sha))throw Error('Arquivo inválido no GitHub.');
   const blob=await this.request('/git/blobs/'+value.sha);
   if(blob.encoding!=='base64')throw Error('Formato de arquivo não suportado.');
   return {text:decode(blob.content),sha:value.sha};
  }
  async load(){const file=await this.readFile(this.path);const document=validate(JSON.parse(file.text.replace(/^\uFEFF/,'')));this.sha=file.sha;this.revision=document.revision;return {document,save_path:`${this.owner}/${this.repo} · ${this.path}`}}
  async save(document,revision){
   validate(document);
   if(revision!==this.revision||!this.sha)throw fail('A revisão mudou. Recarregue o quadro antes de salvar.',409);
   const updated=JSON.parse(JSON.stringify(document));updated.revision=revision+1;updated.saved_at=new Date().toISOString();
   const text=JSON.stringify(updated,null,2)+'\n';
   const result=await this.request(this.filePath(this.path),{method:'PUT',body:JSON.stringify({message:`Atualizar quadro do método — revisão ${updated.revision}`,content:encode(text),sha:this.sha,branch:this.branch})});
   this.sha=result.content.sha;this.revision=updated.revision;
   return {revision:updated.revision,saved_at:updated.saved_at,commit_url:result.commit.html_url};
  }
  async sources(){
   const tree=await this.request('/git/trees/'+encodeURIComponent(this.branch)+'?recursive=1');
   const fixed=['configs/agent_profile.json','configs/orchestrator_rules.json','configs/base.json','src/smc_agentes/orchestration/context.py','mt5/SMC_Agentes_Coletor_V900.mq5'];
   const names=tree.tree.filter(x=>x.type==='blob'&&(fixed.includes(x.path)||/^(skills\/[^/]+\/SKILL\.md|src\/smc_agentes\/skills\/[^/]+\.py|docs\/[^/]+\.md)$/.test(x.path))).map(x=>x.path).sort();
   this.catalog=Object.fromEntries(names.map(n=>[n,null]));return this.catalog;
  }
  async source(name){if(!Object.hasOwn(this.catalog,name))throw Error('Arquivo fora da lista de fontes.');if(this.catalog[name]===null)this.catalog[name]=(await this.readFile(name)).text;return this.catalog[name]}
 }
 root.SMCStorage={GitHubStorage,LocalStorageAdapter,validate,encode,decode};
})(globalThis);
