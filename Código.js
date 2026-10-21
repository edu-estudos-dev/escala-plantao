/**
 * Escala de Plantão — servidor (Google Apps Script)
 * Cada pessoa usa o app com a própria conta Google ("executar como o usuário que acessa").
 * Os dados ficam em PropertiesService (propriedades do usuário) e os serviços viram
 * eventos na agenda "Plantão" do próprio usuário.
 */
const HORIZONTE_DIAS = 60;       // quantos dias à frente a agenda é mantida
const NOME_AGENDA = 'Plantão';
const TAM_BLOCO = 6000;          // limite de caracteres por propriedade (o Google aceita ~9 KB)
const MAX_EVENTOS = 2500;
const LIMITE_BYTES = 450000;     // margem abaixo do limite de ~500 KB das propriedades do usuário
const LOTE_OPS = 20;             // máximo de criações/alterações/exclusões por rodada (o Google limita o ritmo)
const PAUSA_OP_MS = 500;         // pausa entre operações na agenda, para não estourar o limite de ritmo

//#UTIL-START
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DSEM=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const DABR=['dom','seg','ter','qua','qui','sex','sáb'];
const pad=n=>String(n).padStart(2,'0');
const iso=(y,m,d)=>y+'-'+pad(m)+'-'+pad(d);
const parse=s=>{const p=s.split('-').map(Number);return{y:p[0],m:p[1],d:p[2]};};
const dnum=s=>{const p=parse(s);return Math.floor(Date.UTC(p.y,p.m-1,p.d)/864e5);};
const fromNum=n=>{const t=new Date(n*864e5);return iso(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());};
const addDias=(s,n)=>fromNum(dnum(s)+n);
const dow=s=>new Date(dnum(s)*864e5).getUTCDay();
const hojeISO=()=>{const n=new Date();return iso(n.getFullYear(),n.getMonth()+1,n.getDate());};
const dtLocal=(s,hhmm)=>{const p=parse(s);const h=hhmm.split(':').map(Number);return new Date(p.y,p.m-1,p.d,h[0],h[1]);};
const fmtBR=s=>{const p=parse(s);return pad(p.d)+'/'+pad(p.m);};
const brl=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const clone=o=>JSON.parse(JSON.stringify(o));
function fmtH(h){const a=Math.abs(h);const hh=Math.floor(a+1e-9);const mm=Math.round((a-hh)*60);return(h<0?'-':'')+hh+'h'+(mm?pad(mm):'');}
function diffTxt(ms){const min=Math.max(0,Math.round(ms/60000));const d=Math.floor(min/1440),h=Math.floor((min%1440)/60),m=min%60;if(d>0)return d+'d '+h+'h';if(h>0)return h+'h '+pad(m)+'min';return m+'min';}

/** Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function pascoa(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return iso(y,Math.floor(n/31),(n%31)+1);}
// nacionais, Data Magna do Ceará (25/03), aniversário de Fortaleza (13/04) e N. Sra. da Assunção (15/08); a Sexta-feira Santa é calculada
const FERIADOS_FIXOS=['01-01','03-25','04-13','04-21','05-01','08-15','09-07','10-12','11-02','11-15','11-20','12-25'];
const feriadosDoAno=y=>FERIADOS_FIXOS.map(md=>y+'-'+md).concat([addDias(pascoa(y),-2)]).sort();
/** Acrescenta os feriados padrão do ano atual e do próximo, uma vez por ano (ferAnos), sem trazer de volta os que o usuário removeu. */
function semearFeriados(o){
  const y=Number(hojeISO().slice(0,4));
  for(const a of [y,y+1]){if(o.ferAnos.indexOf(a)<0){o.feriados=Array.from(new Set(o.feriados.concat(feriadosDoAno(a)))).sort();o.ferAnos.push(a);}}
  return o;
}
/** Normaliza feriados de dados salvos (d) já mesclados em o. */
function normFeriados(o,d){
  if(!Array.isArray(o.feriados)){o.feriados=[];o.ferAnos=[];}
  else if(!Array.isArray((d||{}).ferAnos))o.ferAnos=[2026,2027]; // dados anteriores ao ferAnos já vinham com os feriados de 2026 e 2027
  return semearFeriados(o);
}
const PADRAO=()=>semearFeriados({v:1,horarios:{dia:['06:00','18:00'],noite:['18:00','06:00']},ciclos:[],alertas:{dia:[600,120],noite:[1440,180]},valorHora:null,feriados:[],ferAnos:[],feriadosSem:[],eventos:[],rev:0});
let S=PADRAO();
/** Completa e corrige o estado salvo (d), igual no servidor e no cliente. */
function normalizar(d){
  const b=PADRAO();if(!d||typeof d!=='object')return b;
  const o=Object.assign(b,d);
  if(!Array.isArray(o.eventos))o.eventos=[];
  if(!Array.isArray(o.ciclos))o.ciclos=[];
  if(!o.horarios||!o.horarios.dia||!o.horarios.noite)o.horarios=PADRAO().horarios;
  if(!o.alertas||!o.alertas.dia||!o.alertas.noite)o.alertas=PADRAO().alertas;
  normFeriados(o,d);
  if(!Array.isArray(o.feriadosSem))o.feriadosSem=[];
  if(o.valorHora===undefined)o.valorHora=null;
  return o;
}

function baseDoDia(s){
  const cs=S.ciclos.slice().sort((a,b)=>a.desde<b.desde?-1:1);
  if(!cs.length)return null;
  let c=cs[0];
  for(const x of cs){if(x.desde<=s)c=x;}
  const n=c.seq.length;
  const p=(((dnum(s)-dnum(c.desde))%n)+n)%n;
  return{tipo:c.seq[p],pos:p,n};
}
function mkTurno(data,tipo,origem,ev){
  let ini,fim;
  if(tipo==='custom'){ini=ev.ini;fim=ev.fim;}else{ini=S.horarios[tipo][0];fim=S.horarios[tipo][1];}
  const cruza=fim<=ini;
  const dataFim=cruza?addDias(data,1):data;
  const a=dtLocal(data,ini),b=dtLocal(dataFim,fim);
  return{data,tipo,origem,ini,fim,dataFim,a,b,horas:(b-a)/36e5,ev:ev||null,cancelado:null};
}
/** Horário de término de uma DRSO que começa em ini e dura dur horas (6 a 12). */
function fimDe(ini,dur){
  const p=ini.split(':').map(Number),tot=(p[0]*60+p[1]+Math.round(dur*60))%1440;
  return pad(Math.floor(tot/60))+':'+pad(tot%60);
}
/**
 * Valor de uma DRSO, minuto a minuto pelo relógio: cada hora tem o valor normal, e recebe +30%
 * se cair em sábado, domingo, feriado ou na madrugada (00:00 às 05:00). Os adicionais não se somam.
 */
function calcDRSO(t){
  const fer=new Set(S.feriados||[]),sem=new Set(S.feriadosSem||[]),ov=t.ev&&t.ev.fer;
  // feriado conta como majorado se a DRSO forçar 'sim', ou se não forçar 'nao' e o feriado não estiver marcado como sem adicional
  const ehFer=d=>fer.has(d)&&(ov==='sim'||(ov!=='nao'&&!sem.has(d)));
  let pegaFer=false;
  const p=t.ini.split(':').map(Number),start=p[0]*60+p[1];
  const total=Math.round(t.horas*60);let maj=0;
  for(let k=0;k<total;k++){
    const tm=start+k,c=tm%1440,d=addDias(t.data,Math.floor(tm/1440)),w=dow(d);
    if(fer.has(d))pegaFer=true;
    if(c<300||w===0||w===6||ehFer(d))maj++;
  }
  const vh=Number(S.valorHora)||0;
  return{pegaFer,horas:total/60,maj:maj/60,norm:(total-maj)/60,valor:Math.round(vh*((total-maj)/60+(maj/60)*1.3)*100)/100};
}
function removidoNoDia(s){
  for(const e of S.eventos){
    if((e.tipo==='dispensa'||e.tipo==='permuta_cedi')&&e.data===s)return e;
    if(e.tipo==='licenca'&&e.data<=s&&s<=e.fim)return e;
  }
  return null;
}
function turnosDoDia(s){
  const out=[];
  const b=baseDoDia(s);
  if(b&&(b.tipo==='dia'||b.tipo==='noite')){
    const t=mkTurno(s,b.tipo,'escala',null);
    t.cancelado=removidoNoDia(s);
    out.push(t);
  }
  for(const e of S.eventos){
    if(e.data!==s)continue;
    if(e.tipo==='extra')out.push(mkTurno(s,e.turno,'extra',e));
    else if(e.tipo==='permuta_assumi')out.push(mkTurno(s,e.turno,'permuta',e));
  }
  return out;
}
const ativosDoDia=s=>turnosDoDia(s).filter(t=>!t.cancelado);
function linhaTurnos(de,ate){
  const out=[];
  for(let n=dnum(de);n<=dnum(ate);n++){for(const t of ativosDoDia(fromNum(n)))out.push(t);}
  return out.sort((x,y)=>x.a-y.a);
}
function conflito(novo){
  for(let k=-1;k<=1;k++){
    for(const t of ativosDoDia(addDias(novo.data,k))){if(novo.a<t.b&&t.a<novo.b)return t;}
  }
  return null;
}
/** Todos os choques de horário entre serviços ativos (escala, DRSO, permuta) e DRSO/permuta dentro de férias/licença. */
const DESCANSO_H=8,DESC_MS=DESCANSO_H*36e5;
function choques(){
  const out=new Map();
  for(const e of S.eventos){
    if(e.tipo!=='extra'&&e.tipo!=='permuta_assumi')continue;
    const t=mkTurno(e.data,e.turno,e.tipo==='extra'?'extra':'permuta',e);
    const lic=S.eventos.find(l=>l.tipo==='licenca'&&l.data<=e.data&&e.data<=l.fim);
    if(lic)out.set('l|'+lic.id+'|'+e.id,{a:t,lic:lic});
    for(let k=-1;k<=1;k++){
      for(const x of ativosDoDia(addDias(e.data,k))){
        if(x.ev===e)continue;
        const ia=x.ev?x.ev.id:'esc:'+x.data+x.tipo;
        if(t.a<x.b&&x.a<t.b){
          out.set([e.id,ia].sort().join('|'),{a:t,b:x});
        }else if(e.tipo==='extra'&&t.a-DESC_MS<x.b&&x.a<t.b-0+DESC_MS){
          out.set([e.id,ia].sort().join('|'),{a:t,b:x,desc:true});
        }
      }
    }
  }
  return out;
}
const chavesChoque=()=>new Set(choques().keys());
function novosChoques(antes){const o=[];for(const p of choques()){if(!antes.has(p[0]))o.push(p[1]);}return o;}
function msgChoque(c){
  const f=s=>{const p=parse(s);return pad(p.d)+'/'+pad(p.m);};
  const nm=t=>t.origem==='escala'?'serviço da escala':t.origem==='extra'?'DRSO':'permuta';
  if(c.lic)return 'A '+nm(c.a)+' de '+f(c.a.data)+' cai em '+String(c.lic.motivo||'férias/licença').toLowerCase()+' ('+f(c.lic.data)+' a '+f(c.lic.fim)+').';
  if(c.desc)return 'A DRSO de '+f(c.a.data)+' ('+c.a.ini+'–'+c.a.fim+') fica a menos de '+DESCANSO_H+'h de descanso do '+(c.b.origem==='escala'?'serviço da escala':c.b.origem==='extra'?'outra DRSO':'permuta')+' de '+f(c.b.data)+' ('+c.b.ini+'–'+c.b.fim+'). O mínimo é '+DESCANSO_H+'h.';
  return 'A '+nm(c.a)+' de '+f(c.a.data)+' ('+c.a.ini+'–'+c.a.fim+') bate com '+(c.b.origem==='escala'?'o serviço da escala':c.b.origem==='extra'?'uma DRSO':'uma permuta')+' de '+f(c.b.data)+' ('+c.b.ini+'–'+c.b.fim+').';
}
/** Faz uma mudança e a desfaz sozinha se ela criar um choque de horário novo. Devolve a mensagem do choque, ou null. */
function tentarMudar(mut,desfaz){
  const antes=chavesChoque();
  mut();
  const nc=novosChoques(antes);
  if(nc.length){desfaz();return msgChoque(nc[0]);}
  return null;
}
function klass(t){if(t.origem==='escala')return t.tipo;if(t.origem==='extra')return 'extra';return 'perm';}
function fimDeSemanaLivre(sab){return ativosDoDia(sab).length===0&&ativosDoDia(addDias(sab,1)).length===0;}
function proximoFds(h){
  let s=h;
  for(let i=0;i<120;i++){const d=addDias(s,i);if(dow(d)===6&&d>=h&&fimDeSemanaLivre(d))return d;}
  return null;
}
function resumo(ano,mes){
  const nd=new Date(ano,mes,0).getDate();
  const rows=[],canc=[],dias=new Set();
  for(let d=1;d<=nd;d++){
    const s=iso(ano,mes,d);
    for(const t of turnosDoDia(s)){if(t.cancelado)canc.push(t);else{rows.push(t);dias.add(s);}}
  }
  let fds=0;
  for(let d=1;d<=nd;d++){const s=iso(ano,mes,d);if(dow(s)===6&&fimDeSemanaLivre(s))fds++;}
  const ex=rows.filter(t=>t.origem==='extra');
  const pref=ano+'-'+pad(mes);
  const valorExtras=S.eventos.filter(e=>e.tipo==='extra'&&e.data.slice(0,7)===pref&&e.valor).reduce((a,e)=>a+e.valor,0);
  return{rows,canc,total:rows.length,horas:rows.reduce((a,t)=>a+t.horas,0),
    dia:rows.filter(t=>t.tipo==='dia').length,noite:rows.filter(t=>t.tipo==='noite').length,
    extras:ex.length,extrasHoras:ex.reduce((a,t)=>a+t.horas,0),
    assumidos:rows.filter(t=>t.origem==='permuta').length,
    cedidos:canc.filter(t=>t.cancelado.tipo==='permuta_cedi').length,
    dispensas:canc.filter(t=>t.cancelado.tipo==='dispensa').length,
    licenca:canc.filter(t=>t.cancelado.tipo==='licenca').length,
    folgas:nd-dias.size,fds,valorExtras};
}
/** Relatório do mês: DRSO, permutas e fechamento financeiro (por data do serviço). */
function relatorioMes(ano,mes){
  const pref=ano+'-'+pad(mes);
  const no=e=>e.data.slice(0,7)===pref;
  const soma=l=>l.reduce((a,x)=>a+x,0);
  const drso=S.eventos.filter(e=>e.tipo==='extra'&&no(e)).sort((a,b)=>a.data<b.data?-1:a.data>b.data?1:0).map(e=>{
    const t=mkTurno(e.data,e.turno,'extra',e);
    return{e:e,ini:t.ini,fim:t.fim,horas:t.horas,maj:e.maj||0,valor:e.valor||0,pago:!!e.pago,banco:e.destino==='banco'};
  });
  const dp=drso.filter(x=>!x.banco);
  const drsoTotal=soma(dp.map(x=>x.valor)),drsoRecebido=soma(dp.filter(x=>x.pago).map(x=>x.valor));
  const pm=S.eventos.filter(e=>(e.tipo==='permuta_assumi'||e.tipo==='permuta_cedi')&&no(e));
  const din=pm.filter(e=>e.pg==='dinheiro');
  const rec=din.filter(e=>e.tipo==='permuta_assumi'),pag=din.filter(e=>e.tipo==='permuta_cedi');
  const permRecTotal=soma(rec.map(e=>e.valor||0)),permRecebido=soma(rec.filter(e=>e.quitada).map(e=>e.valor||0));
  const permPagTotal=soma(pag.map(e=>e.valor||0)),permPago=soma(pag.filter(e=>e.quitada).map(e=>e.valor||0));
  const sv=pm.filter(e=>e.pg!=='dinheiro');
  return{drso:drso,drsoHoras:soma(dp.map(x=>x.horas)),drsoMaj:soma(dp.map(x=>x.maj)),drsoBancoHoras:soma(drso.filter(x=>x.banco).map(x=>x.horas)),
    drsoTotal:drsoTotal,drsoRecebido:drsoRecebido,drsoPendente:drsoTotal-drsoRecebido,
    permRecTotal:permRecTotal,permRecebido:permRecebido,permPagTotal:permPagTotal,permPago:permPago,
    permServicoAssumi:sv.filter(e=>e.tipo==='permuta_assumi').length,permServicoCedi:sv.filter(e=>e.tipo==='permuta_cedi').length,
    permDinAssumi:rec.length,permDinCedi:pag.length,
    resultado:drsoTotal+permRecTotal-permPagTotal,
    aReceber:(drsoTotal-drsoRecebido)+(permRecTotal-permRecebido),aPagar:permPagTotal-permPago};
}
function banco(){
  let h=0;
  for(const e of S.eventos){
    if(e.tipo==='extra'&&e.destino==='banco'){h+=mkTurno(e.data,e.turno,'extra',e).horas;}
    else if(e.tipo==='banco'){h+=e.horas;}
    else if(e.tipo==='dispensa'&&e.motivo==='Folga do banco'){
      const t=turnosDoDia(e.data).find(x=>x.cancelado===e||(x.cancelado&&x.cancelado.id===e.id));
      h-=t?t.horas:12;
    }
  }
  return h;
}
/** Permutas pagas em dinheiro ainda não acertadas: o que eu recebo (assumi) e o que eu pago (cedi). */
function permutasDinheiro(){
  const receber=[],pagar=[];
  for(const e of S.eventos){
    if(e.pg!=='dinheiro'||e.quitada)continue;
    if(e.tipo==='permuta_assumi')receber.push(e);else if(e.tipo==='permuta_cedi')pagar.push(e);
  }
  const soma=l=>l.reduce((a,e)=>a+(e.valor||0),0);
  return{receber,pagar,totalReceber:soma(receber),totalPagar:soma(pagar)};
}
function ledger(){
  const m={};
  for(const e of S.eventos){
    if(e.tipo!=='permuta_assumi'&&e.tipo!=='permuta_cedi')continue;
    const k=e.pessoa.trim().toLowerCase();
    if(!m[k])m[k]={nome:e.pessoa.trim(),assumi:[],cedi:[]};
    if(e.pg==='dinheiro')continue; // permuta paga em dinheiro não entra na conta de serviços devidos
    if(!e.quitada)(e.tipo==='permuta_assumi'?m[k].assumi:m[k].cedi).push(e);
  }
  return Object.values(m).filter(p=>p.assumi.length||p.cedi.length);
}
//#ENGINE-END

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Escala de Plantão')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------------- armazenamento ---------------- */

function srvProps_() { return PropertiesService.getUserProperties(); }

function srvLerEstado_() {
  const p = srvProps_().getProperties();
  if (!p.cfg) return null;
  const cfg = JSON.parse(p.cfg);
  const eventos = [];
  Object.keys(p)
    .filter(function (k) { return /^ev\d+$/.test(k); })
    // cfg.nev diz quantos blocos valem: um bloco velho que não chegou a ser apagado é ignorado
    .filter(function (k) { return cfg.nev === undefined || Number(k.slice(2)) < cfg.nev; })
    .sort(function (a, b) { return Number(a.slice(2)) - Number(b.slice(2)); })
    .forEach(function (k) { JSON.parse(p[k]).forEach(function (e) { eventos.push(e); }); });
  delete cfg.nev;
  cfg.eventos = eventos;
  return cfg;
}

/** Grava o estado. Devolve a mensagem para o usuário se passar de algum limite (nada é gravado), ou null. */
function srvGravarEstado_(novo, rev) {
  if (novo.eventos.length > MAX_EVENTOS) return 'Lançamentos demais. Exclua os mais antigos.';
  const blocos = [];
  let atual = [], tam = 2;
  novo.eventos.forEach(function (e) {
    const s = JSON.stringify(e);
    if (tam + s.length + 1 > TAM_BLOCO && atual.length) { blocos.push(atual); atual = []; tam = 2; }
    atual.push(e); tam += s.length + 1;
  });
  if (atual.length) blocos.push(atual);
  const cfg = { v: 1, horarios: novo.horarios, ciclos: novo.ciclos, alertas: novo.alertas, valorHora: novo.valorHora, feriados: novo.feriados, ferAnos: novo.ferAnos, feriadosSem: novo.feriadosSem || [], rev: rev, nev: blocos.length };
  const cfgTxt = JSON.stringify(cfg);
  if (cfgTxt.length > TAM_BLOCO) return 'Configuração grande demais.';
  const props = srvProps_();
  const antigos = Object.keys(props.getProperties());
  const grava = { cfg: cfgTxt };
  blocos.forEach(function (b, i) { grava['ev' + i] = JSON.stringify(b); });
  // o Google limita as propriedades do usuário a ~500 KB no total; avisa antes de estourar
  const bytes = Utilities.newBlob(Object.keys(grava).map(function (k) { return k + grava[k]; }).join('')).getBytes().length;
  if (bytes > LIMITE_BYTES) return 'Espaço de armazenamento cheio. Exclua lançamentos antigos.';
  // cfg e blocos vão numa só gravação; cfg.nev faz a leitura ignorar blocos velhos se a limpeza abaixo falhar
  props.setProperties(grava, false);
  antigos.forEach(function (k) {
    if (/^ev\d+$/.test(k) && !(k in grava)) props.deleteProperty(k);
  });
  return null;
}

function api_carregar() {
  const estado = srvLerEstado_();
  const s = srvProps_().getProperty('sync');
  return { estado: estado, sync: s ? JSON.parse(s) : null };
}

/** Garante no servidor que o novo estado não cria choque de horário que o anterior não tinha. */
function srvChoqueNovo_(anterior, novo) {
  const bak = S;
  try {
    S = anterior ? normalizar(anterior) : PADRAO();
    const antes = chavesChoque();
    S = novo;
    const nc = novosChoques(antes);
    return nc.length ? msgChoque(nc[0]) : null;
  } finally {
    S = bak;
  }
}

function api_salvar(estado, revBase) {
  const lock = LockService.getUserLock();
  lock.waitLock(60000); // a sincronização da agenda pode segurar a trava por ~40s (lote de LOTE_OPS operações)
  try {
    const atual = srvLerEstado_();
    const revAtual = atual ? (atual.rev || 0) : 0;
    if ((revBase || 0) !== revAtual) return { conflito: true, estado: atual };
    const novo = normalizar(estado);
    const bloqueio = srvChoqueNovo_(atual, novo);
    if (bloqueio) return { choque: true, msg: bloqueio, estado: atual };
    const rev = revAtual + 1;
    const limite = srvGravarEstado_(novo, rev);
    if (limite) return { limite: true, msg: limite, estado: atual };
    return { ok: true, rev: rev };
  } finally {
    lock.releaseLock();
  }
}

/** Apaga tudo do usuário: configuração, lançamentos, a agenda "Plantão" e o gatilho diário. O app volta à configuração inicial. */
function api_apagarTudo() {
  const lock = LockService.getUserLock();
  lock.waitLock(60000); // pode estar esperando uma sincronização longa da agenda
  try {
    const props = srvProps_();
    const id = props.getProperty('cal');
    const cal = id ? CalendarApp.getCalendarById(id) : null;
    if (cal) cal.deleteCalendar();
    srvRemoverGatilho_();
    props.deleteAllProperties();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- agenda do Google ---------------- */

function srvAgenda_() {
  const props = srvProps_();
  const id = props.getProperty('cal');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    const tz = CalendarApp.getDefaultCalendar().getTimeZone();
    cal = CalendarApp.createCalendar(NOME_AGENDA, {
      timeZone: tz,
      color: CalendarApp.Color.BLUE,
      description: 'Criada pelo app Escala de Plantão. Não edite os eventos à mão: o app reescreve esta agenda.',
      selected: true
    });
    props.setProperty('cal', cal.getId());
  }
  return cal;
}

function srvEspec_(t, tz) {
  const nomeT = t.tipo === 'dia' ? 'DIA' : (t.tipo === 'noite' ? 'NOITE' : '');
  let titulo, cor, desc;
  if (t.origem === 'escala') {
    titulo = 'Plantão — ' + nomeT;
    cor = t.tipo === 'dia' ? CalendarApp.EventColor.YELLOW : CalendarApp.EventColor.PALE_GREEN;
    desc = 'Serviço da escala, das ' + t.ini + ' às ' + t.fim + '.';
  } else if (t.origem === 'extra') {
    titulo = 'DRSO — ' + String(t.horas).replace('.', ',') + 'h';
    cor = CalendarApp.EventColor.PALE_RED;
    desc = 'DRSO, das ' + t.ini + ' às ' + t.fim + '.' + (t.ev && t.ev.obs ? ' ' + t.ev.obs : '');
  } else {
    titulo = 'Plantão (permuta com ' + (t.ev && t.ev.pessoa ? t.ev.pessoa : 'colega') + ')';
    cor = CalendarApp.EventColor.BLUE;
    desc = 'Serviço assumido em permuta, das ' + t.ini + ' às ' + t.fim + '.' + (t.ev && t.ev.obs ? ' ' + t.ev.obs : '');
  }
  const alertas = t.tipo === 'custom' ? [120] : ((S.alertas && S.alertas[t.tipo]) || []).filter(function (m) { return m > 0; });
  const inicio = Utilities.parseDate(t.data + ' ' + t.ini, tz, 'yyyy-MM-dd HH:mm');
  const fim = Utilities.parseDate(t.dataFim + ' ' + t.fim, tz, 'yyyy-MM-dd HH:mm');
  const key = t.data + '|' + t.ini + '|' + t.fim + '|' + t.origem;
  const sig = JSON.stringify([titulo, inicio.getTime(), fim.getTime(), desc, alertas, String(cor)]);
  return { key: key, titulo: titulo, desc: desc, cor: cor, alertas: alertas, inicio: inicio, fim: fim, sig: sig };
}

/** Títulos gerados por srvEspec_ (precisa acompanhar se eles mudarem). */
const TITULO_APP = /^(Plantão — (DIA|NOITE)|DRSO — [\d,]+h|Plantão \(permuta com .*\))$/;

function srvAplicar_(ev, sp, novo) {
  // a marca "k" vem primeiro: se algo falhar depois, o evento já é reconhecido e será ajustado na próxima rodada
  ev.setTag('k', sp.key);
  if (!novo) {
    ev.setTitle(sp.titulo);
    ev.setTime(sp.inicio, sp.fim);
    ev.setDescription(sp.desc);
  }
  ev.setColor(sp.cor);
  ev.removeAllReminders();
  sp.alertas.forEach(function (m) { ev.addPopupReminder(m); });
  ev.setTag('sig', sp.sig);
}

function srvLimite_(e) {
  return /muitas agendas|muitos eventos|too many calendars|too many events|rate limit/i.test(String((e && e.message) || e));
}

function srvConfigurado_(estado) { return !!(estado && estado.ciclos && estado.ciclos.length); }

function srvRemoverGatilho_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sincronizarDiario') ScriptApp.deleteTrigger(t); });
}

function srvGarantirGatilho_() {
  const ja = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sincronizarDiario'; });
  if (!ja) ScriptApp.newTrigger('sincronizarDiario').timeBased().everyDays(1).atHour(3).create();
}

/**
 * Deixa a agenda "Plantão" igual ao que o app calcula para os próximos HORIZONTE_DIAS dias.
 * Cria o que falta, remove o que sobrou e atualiza o que mudou. Só mexe em eventos criados por ele.
 */
function srvSincronizar_() {
  const estado = srvLerEstado_();
  if (!srvConfigurado_(estado)) throw new Error('Escala ainda não configurada.');
  S = normalizar(estado);
  const cal = srvAgenda_();
  const tz = cal.getTimeZone();
  const hojeStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const ateStr = addDias(hojeStr, HORIZONTE_DIAS);
  const desej = {};
  for (let n = dnum(hojeStr); n <= dnum(ateStr); n++) {
    turnosDoDia(fromNum(n)).forEach(function (t) {
      if (t.cancelado) return;
      const sp = srvEspec_(t, tz);
      if (!desej[sp.key]) desej[sp.key] = sp;
    });
  }
  const ini = Utilities.parseDate(hojeStr + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
  const fimJanela = Utilities.parseDate(addDias(ateStr, 1) + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
  let criados = 0, removidos = 0, atualizados = 0, ops = 0, pendente = 0, limite = false;
  const vistos = {};
  // executa uma operação na agenda respeitando o lote e o limite de ritmo do Google
  function tentar(fn) {
    if (limite || ops >= LOTE_OPS) { pendente++; return false; }
    try {
      fn();
      ops++;
      Utilities.sleep(PAUSA_OP_MS);
      return true;
    } catch (e) {
      if (!srvLimite_(e)) throw e;
      limite = true; pendente++;
      return false;
    }
  }
  cal.getEvents(ini, fimJanela).forEach(function (ev) {
    if (ev.getStartTime().getTime() < ini.getTime()) return;
    const k = ev.getTag('k');
    if (!k) {
      // sobra de uma rodada interrompida: evento do app sem marca. Só mexe se o título é exatamente um dos que o app cria.
      if (TITULO_APP.test(ev.getTitle())) { if (tentar(function () { ev.deleteEvent(); })) removidos++; }
      return;
    }
    const sp = desej[k];
    if (!sp || vistos[k]) {
      if (tentar(function () { ev.deleteEvent(); })) removidos++;
      return;
    }
    vistos[k] = true;
    if (ev.getTag('sig') !== sp.sig) {
      if (tentar(function () { srvAplicar_(ev, sp, false); })) atualizados++;
    }
  });
  Object.keys(desej).forEach(function (k) {
    if (vistos[k]) return;
    const sp = desej[k];
    if (tentar(function () {
      const ev = cal.createEvent(sp.titulo, sp.inicio, sp.fim, { description: sp.desc });
      srvAplicar_(ev, sp, true);
    })) criados++;
  });
  srvGarantirGatilho_();
  const info = { ate: ateStr, quando: Utilities.formatDate(new Date(), tz, 'dd/MM HH:mm'), criados: criados, removidos: removidos, atualizados: atualizados, pendente: pendente, limite: limite };
  srvProps_().setProperty('sync', JSON.stringify(info));
  return info;
}

function api_sincronizar() {
  const lock = LockService.getUserLock();
  lock.waitLock(30000);
  try {
    return srvSincronizar_();
  } finally {
    lock.releaseLock();
  }
}

/** Roda todo dia de madrugada (gatilho criado no primeiro uso) para manter a janela de 60 dias. */
function sincronizarDiario() {
  const t0 = Date.now();
  try {
    // sem escala configurada (dados apagados) não há o que manter: remove o próprio gatilho em vez de falhar todo dia
    if (!srvConfigurado_(srvLerEstado_())) { srvRemoverGatilho_(); return; }
    let r;
    do {
      const lock = LockService.getUserLock();
      lock.waitLock(30000);
      try { r = srvSincronizar_(); } finally { try { lock.releaseLock(); } catch (x) {} }
      if (r.pendente > 0) Utilities.sleep(r.limite ? 60000 : 2000);
    } while (r.pendente > 0 && Date.now() - t0 < 240000);
  } catch (e) {
    srvProps_().setProperty('sync', JSON.stringify({ erro: String((e && e.message) || e), quando: new Date().toISOString() }));
  }
}
