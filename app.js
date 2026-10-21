'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clone=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cloudMode=!['localhost','127.0.0.1'].includes(location.hostname)||new URLSearchParams(location.search).has('github');
const storage=cloudMode?new SMCStorage.GitHubStorage():new SMCStorage.LocalStorageAdapter();
let doc,selected=null,tab='board',sources={},timer,saving=false,dirty=false,editVersion=0,conflict=false,undoStack=[],drag=null;
const KEY=storage.key;
let manualSavePending=false;
const kindNames={agent:'Agente',skill:'Skill',note:'Observação',data:'Fonte de dados'};
const fields=['title','purpose','inputs','outputs','rules','activation','pending','notes','timeframes','review'];
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4200)}
function error(text){$('#error').textContent=text;$('#error').hidden=!text}
function snapshotUndo(){if(doc){undoStack.push(clone(doc));if(undoStack.length>35)undoStack.shift();$('#undo').disabled=false}}
function changed(){dirty=true;editVersion++;$('#saveState').textContent='Alterações por salvar…';try{localStorage.setItem(KEY,JSON.stringify(doc))}catch{}clearTimeout(timer);timer=setTimeout(save,storage.delay)}
async function save(manual=false){
 if(!doc){if(manual)toast('O documento ainda está carregando. Aguarde um instante.');return;}
 if(conflict){if(manual)toast('Não salvo: há conflito com outra janela. Veja a mensagem no topo.');return;}
 if(!dirty){if(manual)toast('✓ Tudo já está salvo no '+storage.label+'. Revisão '+doc.revision+'.');return;}
 if(manual)manualSavePending=true;
 if(saving){if(manual)toast('Salvamento em andamento. Aguarde a confirmação.');return;}
 clearTimeout(timer);saving=true;const version=editVersion;$('#saveState').textContent='Salvando no '+storage.label+'…';
 try{const result=await storage.save(clone(doc),doc.revision);
 doc.revision=result.revision;doc.saved_at=result.saved_at;
 if(version===editVersion){dirty=false;try{localStorage.removeItem(KEY)}catch{}$('#saveState').textContent='✓ Salvo no '+storage.label;error('');if(manualSavePending){toast('✓ Salvo com sucesso no '+storage.label+'. Revisão '+doc.revision+'.');manualSavePending=false;}}else{try{localStorage.setItem(KEY,JSON.stringify(doc))}catch{}}
 $('#revision').textContent='Revisão '+doc.revision+' · '+new Date(doc.saved_at).toLocaleString('pt-BR');
 }catch(e){conflict=e.status===409||e.status===422;$('#saveState').textContent='Não salvo · exporte uma cópia';error(e.message);if(manualSavePending){toast('Não foi possível salvar. Veja o aviso no topo; suas alterações continuam no navegador.');manualSavePending=false;}}finally{saving=false;if(dirty&&!conflict&&version!==editVersion)timer=setTimeout(save,storage.delay)}
}
function card(n){return `<article class="card ${n.id===selected?'selected':''}" draggable="true" tabindex="0" data-node="${esc(n.id)}" aria-label="Editar ${esc(n.title)}"><div class="card-head"><span class="icon ${n.kind==='note'?'note':'skill'}">${n.kind==='note'?'✎':'▤'}</span><h4>${esc(n.title)}</h4></div><p>${esc(n.purpose||'Clique para definir a função deste item.')}</p><div class="badges"><span class="badge ${n.origin==='Implementada'?'':'proposal'}">${esc(n.origin||'Proposta')}</span>${n.timeframes?`<span class="badge">${esc(n.timeframes)}</span>`:''}${n.notes?'<span class="badge note-badge">Com observações</span>':''}</div>${n.review!=='Rascunho'?`<div class="review-dot">● ${esc(n.review)}</div>`:''}</article>`}
function renderBoard(){
 const query=$('#search').value.toLowerCase();
 const lanes=doc.nodes.filter(n=>['agent','data'].includes(n.kind));
 const loose=doc.nodes.filter(n=>!n.parent&&!['agent','data'].includes(n.kind));
 const all=[...lanes,{id:'__loose',title:'Sem responsável',purpose:'Arraste para um agente quando decidir.',origin:'Área de ideias'}];
 $('#board').innerHTML=all.map((lane,index)=>{const nodes=doc.nodes.filter(n=>n.parent===lane.id||(lane.id==='__loose'&&loose.includes(n))).filter(n=>[n.title,n.purpose,n.rules,n.notes,n.timeframes].join(' ').toLowerCase().includes(query));return `<section class="lane" data-lane="${esc(lane.id)}"><div class="flow-index">${lane.id==='__loose'?'IDEIAS LIVRES':String(index+1).padStart(2,'0')+' / '+(lane.kind==='data'?'DADOS':'AGENTE')}</div><div class="lane-header" ${lane.id==='__loose'?'':`draggable="true" tabindex="0" data-node="${esc(lane.id)}"`}><div class="lane-head-main"><h3>${esc(lane.title)}</h3><p>${esc(lane.origin)}</p></div><span class="lane-count">${nodes.length}</span></div>${lane.purpose?`<p class="lane-description">${esc(lane.purpose)}</p>`:''}${nodes.map(card).join('')}${!nodes.length?'<div class="empty-lane">Solte uma skill ou observação aqui.</div>':''}<button class="add-inline" data-add="${esc(lane.id)}">＋ Adicionar skill</button></section>`}).join('');
 $('#counts').textContent=`${doc.nodes.filter(n=>n.kind==='skill').length} skills no quadro · ${doc.nodes.filter(n=>n.kind==='agent').length} agentes / perfis · distribuição editável`;
 $('#trashCount').textContent=doc.trash.length;$('#undo').disabled=!undoStack.length;
}
function select(id){selected=id;renderBoard();renderEditor();if(matchMedia('(max-width:1100px)').matches)$('#closeEditor').focus()}
function renderEditor(){const n=doc.nodes.find(x=>x.id===selected);$('#emptyInspector').hidden=!!n;$('#editor').hidden=!n;if(!n)return;
 $('#kindLabel').textContent=kindNames[n.kind];$('#originLabel').textContent='Origem no quadro: '+(n.origin||'Proposta')+' · editar aqui gera uma proposta para revisão.';
 for(const f of fields)$('#field-'+f).value=n[f]||'';
 $('#groupLabel').hidden=['agent','data'].includes(n.kind);
 $('#field-parent').innerHTML='<option value="">Sem responsável</option>'+doc.nodes.filter(x=>['agent','data'].includes(x.kind)).map(x=>`<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('');$('#field-parent').value=n.parent||'';
 $('#refs').innerHTML=n.sources.length?'<div class="eyebrow">REFERÊNCIAS DO PROJETO</div>'+n.sources.map(x=>`<button data-source="${esc(x)}">↗ ${esc(x)}</button>`).join(''):'';
}
function switchTab(name){tab=name;$$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('main>.view').forEach(v=>v.hidden=v.id!==name);$('#toolbar').hidden=name!=='board';if(name==='overview')renderOverview();if(name==='trash')renderTrash()}
function renderOverview(){
 const implemented=doc.nodes.filter(n=>n.kind==='skill'&&n.origin==='Implementada');
 $('#overview').innerHTML=`<h2>Um método, duas camadas</h2><p>As fontes mostram o código atual. O quadro é seu espaço para organizar mudanças.</p><div class="summary-grid"><div class="summary"><strong>Implementado no projeto</strong><ul><li>Coletor MT5 1.05 e replay cronológico.</li><li>Seis skills determinísticas e monitor de eventos em Python.</li><li>Perfil SMC e contexto do orquestrador.</li><li>Liquidez tick a tick e D1 anterior.</li></ul></div><div class="summary"><strong>Ainda em definição</strong><ul><li>Três agentes separados e integração Gemini.</li><li>Gatilhos completos e confluências.</li><li>Limites e controle de risco.</li><li>Simulador financeiro e execução de ordens.</li></ul></div></div><h2>Skills do quadro originadas no código</h2><div class="summary-grid">${implemented.map(n=>`<div class="summary"><strong>${esc(n.title)}</strong><p>${esc(n.purpose)}</p><button data-edit="${esc(n.id)}">Ver regras e editar →</button></div>`).join('')}</div><h2>Diretrizes gerais do seu método</h2><p>Escreva aqui orientações que valem para todos os agentes.</p><textarea id="generalNotes" class="wide-note" placeholder="O que todos os agentes devem observar?">${esc(doc.notes)}</textarea><h2>Quando terminar</h2><div class="summary"><p>Use “Preparar revisão” e peça ao assistente: <strong>Leia SMC_Agentes/visual/method.json e transcreva minhas alterações para o código.</strong></p><p>O arquivo inclui textos, agrupamentos, itens novos, excluídos e a revisão salva. O histórico fica no GitHub ao salvar online e em visual/history ao salvar localmente. Para transcrever alterações online, peça também para sincronizar o repositório antes de ler o quadro.</p></div>`;
 $('#generalNotes').onfocus=snapshotUndo;$('#generalNotes').oninput=e=>{doc.notes=e.target.value;changed()};
}
function renderTrash(){$('#trash').innerHTML='<h2>Ideias guardadas na lixeira</h2><p>Excluir do quadro não apaga nenhum arquivo de estratégia. Você pode restaurar os itens.</p>'+(doc.trash.length?doc.trash.map(n=>`<div class="trash-item"><div><strong>${esc(n.title)}</strong><p>${esc(kindNames[n.kind])} · ${esc(n.origin)}</p></div><button data-restore="${esc(n.id)}">Restaurar</button></div>`).join(''):'<div class="summary">A lixeira está vazia.</div>')}
function blank(kind,parent){const n={id:crypto.randomUUID(),kind,parent:['agent','data'].includes(kind)?null:parent,origin:'Proposta',sources:[],review:'Rascunho'};for(const f of fields)if(!(f in n))n[f]='';n.title=kind==='agent'?'Novo agente':kind==='skill'?'Nova skill':'Nova observação';return n}
function add(kind,parent=null){snapshotUndo();const n=blank(kind,parent);doc.nodes.push(n);changed();switchTab('board');select(n.id);$('#field-title').focus();$('#field-title').select();setTimeout(()=>$('#board').querySelector(`[data-node="${n.id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'}),0)}
function move(id,laneId,beforeId){const n=doc.nodes.find(x=>x.id===id);if(!n||id===beforeId)return;snapshotUndo();const container=['agent','data'].includes(n.kind);if(container){if(laneId==='__loose')return;const target=doc.nodes.find(x=>x.id===laneId);if(!target||target===n)return;doc.nodes=doc.nodes.filter(x=>x.id!==id);doc.nodes.splice(doc.nodes.indexOf(target),0,n)}else{n.parent=laneId==='__loose'?null:laneId;doc.nodes=doc.nodes.filter(x=>x.id!==id);const before=doc.nodes.findIndex(x=>x.id===beforeId&&x.parent===n.parent);if(before>=0)doc.nodes.splice(before,0,n);else doc.nodes.push(n)}changed();select(id)}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}
function markdown(){let s='# Método SMC — proposta visual\n\nRevisão: '+doc.revision+'\n\n'+doc.notes+'\n';for(const n of doc.nodes){const parent=doc.nodes.find(x=>x.id===n.parent);s+=`\n## ${n.title}\n\nTipo: ${kindNames[n.kind]} | Grupo: ${parent?.title||'Raiz'} | Origem: ${n.origin} | Revisão: ${n.review}\n`;for(const f of fields.filter(x=>!['title','review'].includes(x)))if(n[f])s+=`\n### ${f}\n\n${n[f]}\n`;s+='\nFontes: '+n.sources.join(', ')+'\n'}s+='\n## Itens removidos do quadro\n'+doc.trash.map(n=>'- '+n.title+': '+n.notes).join('\n');return s}
async function sourceView(name){switchTab('sources');$('#sourceSelect').value=name;$('#sourceText').textContent='Carregando fonte…';try{const text=await storage.source(name);if($('#sourceSelect').value===name)$('#sourceText').textContent=text||'Arquivo vazio.'}catch(e){$('#sourceText').textContent=e.message}}
async function loadDocument(){
 $('.app').inert=true;$('#save').disabled=true;let data;try{data=await storage.load()}catch(e){$('.app').inert=!doc;$('#save').disabled=!doc;throw e}doc=data.document;dirty=false;conflict=false;selected=null;undoStack=[];sources={};
 $('#savePath').textContent='Arquivo: '+data.save_path;$('#saveState').textContent='✓ Salvo no '+storage.label;$('#revision').textContent='Revisão '+doc.revision;error('');
 $('.app').inert=false;$('#save').disabled=false;$('#reviewAll').disabled=false;
 $('#recovery').hidden=!localStorage.getItem(KEY);renderBoard();renderEditor();if(tab==='overview')renderOverview();if(tab==='trash')renderTrash();
 if(cloudMode){$('#connection').hidden=false;$('#connection').textContent='Reconectar';$('#reloadRemote').hidden=false;$('#githubHistory').hidden=false;$('#disconnect').hidden=false;$('.local-note').innerHTML='<span class="dot"></span>Salvamento no GitHub<p>Após 5 segundos sem digitar, o quadro é salvo no repositório privado. “Salvar agora” confirma a gravação. A credencial fica somente na memória desta aba.</p>'}
 try{sources=await storage.sources();$('#sourceSelect').innerHTML=Object.keys(sources).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');$('#sourceText').textContent='Selecione um arquivo para carregar seu conteúdo.';if(tab==='sources'&&$('#sourceSelect').value)await sourceView($('#sourceSelect').value)}catch(e){$('#sourceText').textContent=e.message}
}
function showConnection(){if(saving){toast('Aguarde o salvamento antes de reconectar.');return}$('#connectError').textContent='';$('#githubToken').value='';$('#connectDialog').showModal();$('#githubToken').focus()}
async function init(){
 $('.app').inert=true;$('#save').disabled=true;$('#reviewAll').disabled=true;
 if(cloudMode){$('#connection').hidden=false;$('#saveState').textContent='Conecte para abrir seu quadro privado';showConnection();return}
 try{await loadDocument()}catch(e){error(e.message+' · Abra pelo servidor local usando INICIAR_EDITOR.cmd.')}
}
$('#connectForm').onsubmit=async e=>{
 e.preventDefault();const button=$('#connectSubmit');button.disabled=true;$('#connectError').textContent='Conectando ao GitHub…';
 try{storage.connect($('#githubToken').value);$('#githubToken').value='';if(doc){$('#connectDialog').close();toast('Credencial atualizada. Tente salvar ou recarregue o quadro.')}else{await loadDocument();$('#connectDialog').close();toast('Quadro carregado do GitHub. Revisão '+doc.revision+'.')}}catch(e){$('#connectError').textContent=e.message}finally{button.disabled=false}
};
$('#connection').onclick=showConnection;
$('#closeConnect').onclick=()=>$('#connectDialog').close();
$('#reloadRemote').onclick=async()=>{if(saving){toast('Aguarde o salvamento.');return}if(dirty&&!confirm('Há alterações neste aparelho. O rascunho ficará guardado para recuperação; baixe uma cópia se precisar comparar. Carregar a versão do GitHub?'))return;clearTimeout(timer);try{await loadDocument();toast('Versão mais recente carregada do GitHub.')}catch(e){error(e.message)}};
$('#disconnect').onclick=()=>{if(saving){toast('Aguarde o salvamento.');return}if(dirty&&!confirm('Há alterações por salvar. Desconectar e manter o rascunho neste navegador?'))return;clearTimeout(timer);storage.disconnect();doc=null;dirty=false;sources={};selected=null;$('#board').innerHTML='';$('#overview').innerHTML='';$('#trash').innerHTML='';$('#sourceText').textContent='';$('#sourceSelect').innerHTML='';$('#editor').hidden=true;$('#emptyInspector').hidden=false;$$('[data-field]').forEach(x=>x.value='');$('#disconnect').hidden=true;$('#reloadRemote').hidden=true;$('#githubHistory').hidden=true;$('#savePath').textContent='Desconectado';$('#revision').textContent='';init()};
$$('[data-template]').forEach(b=>{b.onclick=()=>add(b.dataset.template,doc?.nodes.find(n=>n.id===selected&&['agent','data'].includes(n.kind))?.id||null);b.ondragstart=e=>{drag={template:b.dataset.template};e.dataTransfer.setData('text/plain',JSON.stringify(drag));e.dataTransfer.effectAllowed='copy'}});
$('#board').addEventListener('dragstart',e=>{const n=e.target.closest('[data-node]');if(!n)return;drag={id:n.dataset.node};e.dataTransfer.setData('text/plain',JSON.stringify(drag));e.dataTransfer.effectAllowed='move'});
$('#board').addEventListener('dragover',e=>{const lane=e.target.closest('[data-lane]');if(lane){e.preventDefault();lane.classList.add('drop-hover')}});
$('#board').addEventListener('dragleave',e=>{const lane=e.target.closest('[data-lane]');if(lane&&!lane.contains(e.relatedTarget))lane.classList.remove('drop-hover')});
$('#board').addEventListener('drop',e=>{e.preventDefault();$$('.drop-hover').forEach(x=>x.classList.remove('drop-hover'));const lane=e.target.closest('[data-lane]');if(!lane)return;let value;try{value=JSON.parse(e.dataTransfer.getData('text/plain'))}catch{return}const parent=lane.dataset.lane==='__loose'?null:lane.dataset.lane;if(value.template&&['agent','skill','note'].includes(value.template))add(value.template,parent);else if(value.id)move(value.id,lane.dataset.lane,e.target.closest('.card')?.dataset.node);drag=null});
$('#board').onclick=e=>{const addButton=e.target.closest('[data-add]');if(addButton)return add('skill',addButton.dataset.add==='__loose'?null:addButton.dataset.add);const node=e.target.closest('[data-node]');if(node)select(node.dataset.node)};
$('#board').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-node]')){e.preventDefault();select(e.target.dataset.node)}};
$$('[data-field]').forEach(input=>{input.onfocus=snapshotUndo;input.oninput=()=>{const n=doc.nodes.find(x=>x.id===selected);if(!n)return;n[input.dataset.field]=input.value;changed();renderBoard()}});
$('#field-parent').onchange=e=>{snapshotUndo();doc.nodes.find(x=>x.id===selected).parent=e.target.value||null;changed();renderBoard()};
$('#closeEditor').onclick=()=>{selected=null;renderEditor();renderBoard()};
$('#delete').onclick=()=>{const n=doc.nodes.find(x=>x.id===selected);if(!n)return;if(!confirm(`Mover “${n.title}” para a lixeira? Os itens dentro do grupo ficarão sem responsável.`))return;snapshotUndo();doc.nodes.forEach(x=>{if(x.parent===n.id)x.parent=null});doc.nodes=doc.nodes.filter(x=>x.id!==n.id);doc.trash.push(n);selected=null;changed();renderBoard();renderEditor()};
$('#duplicate').onclick=()=>{const n=doc.nodes.find(x=>x.id===selected);if(!n)return;snapshotUndo();const copy=clone(n);copy.id=crypto.randomUUID();copy.title+=' (cópia)';copy.origin='Proposta';copy.review='Rascunho';doc.nodes.push(copy);changed();select(copy.id)};
$('#undo').onclick=()=>{if(!undoStack.length)return;const revision=doc.revision,savedAt=doc.saved_at;doc=undoStack.pop();doc.revision=revision;doc.saved_at=savedAt;changed();renderBoard();renderEditor();if(tab==='trash')renderTrash();if(tab==='overview')renderOverview()};
$$('nav [data-tab]').forEach(b=>b.onclick=()=>{switchTab(b.dataset.tab);if(b.dataset.tab==='sources'&&$('#sourceSelect').value)sourceView($('#sourceSelect').value)});$('#search').oninput=renderBoard;$('#save').onclick=()=>save(true);
$('#export').onclick=()=>download(JSON.stringify(doc,null,2),'metodo-smc.json','application/json');$('#markdown').onclick=()=>download(markdown(),'metodo-smc-revisao.md','text/markdown');
$('#reviewAll').onclick=async()=>{snapshotUndo();doc.nodes.forEach(n=>n.review='Pronto para transcrever');changed();renderBoard();renderEditor();await save(true);if(!dirty)toast('Revisão salva. Peça ao assistente para sincronizar o GitHub e ler visual/method.json.')};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>4000000)throw Error('Arquivo maior que 4 MB');const imported=JSON.parse(await file.text());if(imported.schema_version!==1||!Array.isArray(imported.nodes)||!Array.isArray(imported.trash)||typeof imported.notes!=='string'||![...imported.nodes,...imported.trash].every(n=>n&&typeof n.id==='string'&&['agent','data','skill','note'].includes(n.kind)&&fields.every(f=>typeof n[f]==='string')&&Array.isArray(n.sources)))throw Error('Cópia inválida');if(!confirm('Substituir o quadro por esta cópia? Você poderá desfazer.'))return;snapshotUndo();imported.revision=doc.revision;doc=imported;selected=null;changed();renderBoard();renderEditor();await save()}catch(e){error(e.message)}finally{$('#file').value=''}};
$('#overview').onclick=e=>{const b=e.target.closest('[data-edit]');if(b){switchTab('board');select(b.dataset.edit)}};
$('#trash').onclick=e=>{const b=e.target.closest('[data-restore]');if(!b)return;snapshotUndo();const n=doc.trash.find(x=>x.id===b.dataset.restore);if(n.parent&&!doc.nodes.some(x=>x.id===n.parent))n.parent=null;doc.trash=doc.trash.filter(x=>x.id!==n.id);doc.nodes.push(n);changed();renderTrash();renderBoard()};
$('#refs').onclick=e=>{const b=e.target.closest('[data-source]');if(b)sourceView(b.dataset.source)};$('#sourceSelect').onchange=e=>sourceView(e.target.value);
$('#recover').onclick=()=>{try{const recovered=SMCStorage.validate(JSON.parse(localStorage.getItem(KEY)));if(recovered.revision!==doc.revision&&!confirm('Este rascunho é de outra revisão. Recuperar substituirá o quadro atual e pode remover alterações de outro aparelho. Deseja continuar?'))return;snapshotUndo();recovered.revision=doc.revision;doc=recovered;$('#recovery').hidden=true;selected=null;changed();renderBoard();renderEditor()}catch(e){error('Não foi possível recuperar: '+e.message)}};
$('#dismissRecovery').onclick=()=>{if(confirm('Descartar apenas o rascunho não salvo deste navegador?')){localStorage.removeItem(KEY);$('#recovery').hidden=true}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
init();
