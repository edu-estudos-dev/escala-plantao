// Checagens rápidas do motor e do armazenamento. Rodar da raiz do projeto: node testes/testes.js
// Fica fora do Apps Script (.claspignore).
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const raiz = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(raiz, 'Código.js'), 'utf8');
const cli = fs.readFileSync(path.join(raiz, 'Index.html'), 'utf8');
const bloco = t => {
  const i = t.indexOf('//#UTIL-START'), f = t.indexOf('//#ENGINE-END');
  assert.ok(i >= 0 && f > i, 'marcadores //#UTIL-START e //#ENGINE-END não encontrados');
  return t.slice(i, f);
};

// 0. o JS do Index.html compila (erro de sintaxe deixa o app preso em "carregando")
for (const m of cli.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);

// 1. o motor é igual no servidor e no cliente
assert.strictEqual(bloco(srv), bloco(cli), 'bloco UTIL/ENGINE diferente entre Código.js e Index.html');

const pad2 = n => String(n).padStart(2, '0'), iso = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);

// serviço avançado Calendar (API v3) falso: agendas e eventos em memória
function agendaFalsa(apagadas) {
  const cals = {}, evs = {};
  let n = 0;
  const naoAchou = () => { throw new Error('Not Found'); };
  return {
    cals, evs,
    Calendars: {
      get: id => cals[id] || naoAchou(),
      insert: r => (cals['cal' + (++n)] = Object.assign({ id: 'cal' + n }, r)),
      remove: id => { if (!cals[id]) naoAchou(); delete cals[id]; apagadas.push(id); },
    },
    Events: {
      list: id => ({ items: Object.values(evs).filter(e => e.cal === id) }),
      insert: (r, id) => (evs['e' + (++n)] = Object.assign(JSON.parse(JSON.stringify(r)), { id: 'e' + n, cal: id })),
      update: (r, id, eid) => { evs[eid] = Object.assign(JSON.parse(JSON.stringify(r)), { id: eid, cal: id }); },
      remove: (id, eid) => { delete evs[eid]; },
    },
  };
}

// carrega Código.js com PropertiesService e Utilities falsos, numa data fixa
function carregar(ano) {
  const agendaApagada = [], agenda = agendaFalsa(agendaApagada), props = {}, sprops = {}, quem = { email: 'eu@x.com' }, gatilhos = [{ getHandlerFunction: () => 'sincronizarDiario' }];
  const RealDate = Date;
  class D extends RealDate { constructor(...a) { a.length ? super(...a) : super(ano, 5, 1); } }
  D.UTC = RealDate.UTC; D.now = () => new D().getTime();
  const ctx = {
    Date: D, JSON, Math, Number, String, Object, Array, Set, Map, Error,
    PropertiesService: { getUserProperties: () => ({
      getProperties: () => Object.assign({}, props),
      getProperty: k => (k in props ? props[k] : null),
      setProperties: (o) => Object.assign(props, o),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; },
      deleteAllProperties: () => { Object.keys(props).forEach(k => delete props[k]); },
    }), getScriptProperties: () => ({
      getProperty: k => (k in sprops ? sprops[k] : null),
      setProperty: (k, v) => { sprops[k] = v; },
    }) },
    Session: { getActiveUser: () => ({ getEmail: () => quem.email }), getScriptTimeZone: () => 'America/Fortaleza' },
    Utilities: { newBlob: s => ({ getBytes: () => Buffer.from(s, 'utf8') }), formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? iso(d.getFullYear(), d.getMonth() + 1, d.getDate()) : '01/06 10:00'),
      parseDate: s => new D(s.replace(' ', 'T') + ':00'), sleep() {} },
    LockService: { getUserLock: () => ({ waitLock() {}, releaseLock() {} }), getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Calendar: agenda,
    ScriptApp: { getProjectTriggers: () => gatilhos.slice(), deleteTrigger: g => gatilhos.splice(gatilhos.indexOf(g), 1),
      newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => gatilhos.push({ getHandlerFunction: () => 'sincronizarDiario' }) }) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(srv + ';this.E={pascoa,feriadosDoAno,PADRAO,normalizar,srvLerEstado_,srvGravarEstado_,api_salvar,api_apagarTudo,sincronizarDiario,srvAcesso_,api_carregar,srvSincronizar_,calcDRSO,mkTurno,setS:x=>{S=x}};', ctx);
  return { E: ctx.E, props, sprops, quem, gatilhos, agendaApagada, agenda };
}

// 2. feriados: Páscoa e regra igual à lista fixa antiga de 2026–2027
const { E } = carregar(2026);
assert.strictEqual(E.pascoa(2026), '2026-04-05'); assert.strictEqual(E.pascoa(2027), '2027-03-28');
assert.strictEqual(E.pascoa(2028), '2028-04-16'); assert.strictEqual(E.pascoa(2038), '2038-04-25');
const ANTIGA = ['2026-01-01','2026-03-25','2026-04-03','2026-04-13','2026-04-21','2026-05-01','2026-08-15','2026-09-07','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25','2027-01-01','2027-03-25','2027-03-26','2027-04-13','2027-04-21','2027-05-01','2027-08-15','2027-09-07','2027-10-12','2027-11-02','2027-11-15','2027-11-20','2027-12-25'];
assert.deepStrictEqual(E.PADRAO().feriados, ANTIGA);

// usuário antigo (sem ferAnos) que removeu 20/11/2026 abre em 2028: ganha 2028–2029, não recupera o removido
{
  const { E } = carregar(2028);
  const o = E.normalizar({ ciclos: [], eventos: [], feriados: ANTIGA.filter(d => d !== '2026-11-20') });
  assert.ok(!o.feriados.includes('2026-11-20'));
  assert.ok(o.feriados.includes('2028-04-14') && o.feriados.includes('2029-03-30'));
  assert.deepStrictEqual(Array.from(o.ferAnos), [2026, 2027, 2028, 2029]);
  const o2 = E.normalizar(Object.assign({}, o, { feriados: o.feriados.filter(d => d !== '2028-04-14') }));
  assert.ok(!o2.feriados.includes('2028-04-14'), 'feriado removido voltou');
}

// 3. DRSO: sábado inteiro é majorado; quarta 08–14 não
{
  E.setS(Object.assign(E.PADRAO(), { valorHora: 10 }));
  const sab = E.calcDRSO(E.mkTurno('2026-06-06', 'custom', 'extra', { ini: '08:00', fim: '14:00' }));
  assert.strictEqual(sab.maj, 6); assert.strictEqual(sab.valor, 78);
  const qua = E.calcDRSO(E.mkTurno('2026-06-03', 'custom', 'extra', { ini: '08:00', fim: '14:00' }));
  assert.strictEqual(qua.maj, 0); assert.strictEqual(qua.valor, 60);
}

// 4. armazenamento: grava/lê em blocos, ignora bloco velho que sobrou, e barra estouro de espaço
{
  const { E, props } = carregar(2026);
  const ev = i => ({ id: 'e' + i, tipo: 'banco', data: '2026-06-01', horas: 1, obs: 'x'.repeat(150) });
  const estado = Object.assign(E.PADRAO(), { ciclos: [{ desde: '2026-01-01', seq: ['dia', 'folga'] }], eventos: Array.from({ length: 200 }, (_, i) => ev(i)) });
  assert.ok(E.api_salvar(estado, 0).ok);
  const nev = JSON.parse(props.cfg).nev;
  assert.ok(nev > 1, 'deveria ter usado vários blocos');
  props['ev' + nev] = JSON.stringify([ev('fantasma')]); // simula limpeza que falhou
  const lido = E.srvLerEstado_();
  assert.strictEqual(lido.eventos.length, 200);
  assert.ok(!('nev' in lido));
  const grande = Object.assign({}, estado, { eventos: Array.from({ length: 2400 }, (_, i) => ev(i)) });
  const r = E.api_salvar(grande, 1);
  assert.ok(r.limite && /Espaço de armazenamento cheio/.test(r.msg), 'deveria devolver limite');
  assert.strictEqual(r.estado.eventos.length, 200, 'deveria devolver o estado salvo');
  assert.strictEqual(E.srvLerEstado_().rev, 1, 'nada deveria ter sido gravado');
}

// 5. sincronização da agenda: cria a agenda e os eventos marcados, ajusta o que mudou e não mexe em evento posto à mão
{
  const { E, props, agenda } = carregar(2026);
  E.api_salvar(Object.assign(E.PADRAO(), { ciclos: [{ desde: '2026-06-01', seq: ['dia', 'noite', 'folga', 'folga'] }] }), 0);
  // roda até não sobrar pendência (cada rodada faz no máximo LOTE_OPS operações) e soma os contadores
  const sinc = () => { const t = { criados: 0, removidos: 0, atualizados: 0 }; let x; do { x = E.srvSincronizar_(); for (const k in t) t[k] += x[k]; } while (x.pendente); return t; };
  let r = sinc();
  const calId = props.cal;
  assert.ok(agenda.cals[calId], 'agenda Plantão criada');
  const doApp = () => Object.values(agenda.evs).filter(e => e.extendedProperties && e.extendedProperties.private.k);
  assert.ok(r.criados > 0 && doApp().length === r.criados);
  const dia = doApp().find(e => e.summary === 'Plantão — DIA');
  assert.deepStrictEqual(dia.reminders.overrides, [{ method: 'popup', minutes: 600 }]);
  assert.strictEqual(dia.start.dateTime.slice(10), 'T06:00:00');
  agenda.Events.insert({ summary: 'meu compromisso', start: { dateTime: '2026-06-02T10:00:00' } }, calId);
  r = sinc();
  assert.strictEqual(r.criados + r.removidos + r.atualizados, 0, 'segunda rodada sem mudanças');
  assert.ok(Object.values(agenda.evs).some(e => e.summary === 'meu compromisso'), 'evento posto à mão continua');
  // muda o alerta do turno de dia: os eventos de dia são atualizados, nada é recriado
  const est = E.srvLerEstado_(); est.alertas.dia = [480];
  E.api_salvar(est, est.rev);
  r = sinc();
  assert.ok(r.atualizados > 0 && r.criados === 0 && r.removidos === 0);
  assert.ok(doApp().filter(e => e.summary === 'Plantão — DIA').every(e => e.reminders.overrides[0].minutes === 480));
  // evento da versão antiga (marca em "shared") duplicando um atual: o app reconhece e remove a duplicata
  const velho = doApp().find(e => e.summary === 'Plantão — DIA');
  agenda.Events.insert({ summary: velho.summary, start: velho.start, extendedProperties: { shared: { k: velho.extendedProperties.private.k, sig: 'antiga' } } }, calId);
  r = sinc();
  assert.strictEqual(r.removidos + r.atualizados, 1);
  assert.strictEqual(Object.values(agenda.evs).filter(e => e.summary === 'Plantão — DIA' && e.start.dateTime === velho.start.dateTime).length, 1, 'sobra um só');
  // agenda apagada pela pessoa: o app cria outra
  delete agenda.cals[calId];
  E.srvSincronizar_();
  assert.ok(props.cal !== calId && agenda.cals[props.cal]);
}

// 6. gatilho diário se remove quando não há escala configurada
{
  const { E, gatilhos } = carregar(2026);
  E.sincronizarDiario();
  assert.strictEqual(gatilhos.length, 0);
}

// 7. apagar tudo: limpa propriedades, apaga a agenda e o gatilho
{
  const { E, props, gatilhos, agendaApagada, agenda } = carregar(2026);
  assert.ok(E.api_salvar(Object.assign(E.PADRAO(), { ciclos: [{ desde: '2026-01-01', seq: ['dia'] }] }), 0).ok);
  props.cal = 'cal1'; agenda.cals.cal1 = { id: 'cal1' };
  assert.ok(E.api_apagarTudo().ok);
  assert.deepStrictEqual(Object.keys(props), []);
  assert.deepStrictEqual(agendaApagada, ['cal1']);
  assert.strictEqual(gatilhos.length, 0);
  assert.strictEqual(E.srvLerEstado_(), null);
}

// 8. importação: lerCopia (cliente) aceita a cópia exportada e recusa arquivo inválido
{
  const ini = cli.indexOf('const TIPOS_EV'), fim = cli.indexOf('function exportar(');
  assert.ok(ini >= 0 && fim > ini, 'lerCopia não encontrada no Index.html');
  const lerCopia = new Function(cli.slice(ini, fim) + ';return lerCopia;')();
  const dados = { ciclos: [{ desde: '2026-01-01', seq: ['dia', 'folga'] }], eventos: [{ id: 'a', tipo: 'banco', data: '2026-06-01', horas: 2 }] };
  assert.ok(lerCopia(JSON.stringify({ app: 'escala-plantao', dados })));
  assert.ok(lerCopia(JSON.stringify(dados)));
  assert.strictEqual(lerCopia('não é json'), null);
  assert.strictEqual(lerCopia(JSON.stringify({ ciclos: [], eventos: [] })), null);
  assert.strictEqual(lerCopia(JSON.stringify(Object.assign({}, dados, { eventos: [{ id: 'b', tipo: 'x', data: '2026-06-01' }] }))), null);
  assert.strictEqual(lerCopia(JSON.stringify(Object.assign({}, dados, { eventos: [{ id: 'b', tipo: 'banco', data: '01/06/2026' }] }))), null);
}

// 9. DRSO paga sem valor da hora é bloqueada no formulário (o valor depende da graduação)
assert.ok(cli.includes("if(valor===null&&(v.destino||'pagamento')!=='banco')return erroForm("), 'bloqueio de DRSO sem valor da hora sumiu do Index.html');
assert.ok(!cli.includes('ex.: 45,00'), 'Ajustes não deve sugerir um valor da hora');

// 10. gravação que falha (sem conexão / trava ocupada pela sincronização) é repetida sozinha, e fechar o app avisa
assert.ok(cli.includes("tRetry=setTimeout(gravar,"), "nova tentativa automática de gravar sumiu");
assert.ok(cli.includes("addEventListener('beforeunload'"), "aviso ao fechar com alteração pendente sumiu");

// 11. normalizar aceita lixo
assert.ok(E.normalizar(null).feriados.length > 0);
assert.ok(E.normalizar('x').ciclos.length === 0);


// 11. teste fechado: só os primeiros VAGAS e-mails entram; quem já entrou continua; "livres" não ocupa vaga
{
  const { E, sprops, quem } = carregar(2026);
  for (let i = 1; i <= 10; i++) { quem.email = 'p' + i + '@x.com'; assert.ok(E.srvAcesso_()); }
  quem.email = 'p11@x.com'; assert.ok(!E.srvAcesso_());
  quem.email = 'P3@x.com'; assert.ok(E.srvAcesso_());
  sprops.livres = 'dono@x.com'; quem.email = 'dono@x.com'; assert.ok(E.srvAcesso_());
  assert.strictEqual(sprops.acessos.split(', ').length, 10);
  sprops.acessos = sprops.acessos.replace('p5@x.com, ', ''); quem.email = 'p11@x.com'; assert.ok(E.srvAcesso_());
  quem.email = ''; assert.ok(!E.srvAcesso_());
}

// 12. registro de uso: conta aberturas e lançamentos, sem guardar conteúdo
{
  const { E, sprops, quem } = carregar(2026);
  quem.email = 'p1@x.com';
  E.api_carregar(); E.api_carregar();
  assert.strictEqual(sprops['uso:p1@x.com'], 'último 01/06 10:00 · 2 aberturas · 0 lançamentos · sem escala');
  E.api_salvar(Object.assign(E.PADRAO(), { ciclos: [{ desde: '2026-01-01', seq: ['dia'] }], eventos: [{ id: 'a', tipo: 'banco', data: '2026-06-01', horas: 2 }] }), 0);
  assert.strictEqual(sprops['uso:p1@x.com'], 'último 01/06 10:00 · 2 aberturas · 1 lançamento · escala ok');
}

console.log('ok');
