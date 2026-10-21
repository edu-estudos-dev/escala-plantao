// Prévia local do app, sem Apps Script: serve o Index.html com um google.script.run falso e dados de exemplo.
// Rodar da raiz do projeto: node testes/previa.js   →  http://localhost:5173
// Fica fora do Apps Script (.claspignore). Relê o Index.html a cada requisição: é só recarregar a página.
const http = require('http'), fs = require('fs'), path = require('path');
const PORTA = 5173;

const STUB = `<script>
(function(){
const estado={v:1,horarios:{dia:['06:00','18:00'],noite:['18:00','06:00']},alertas:{dia:[600,120],noite:[1440,180]},valorHora:40.5,
 ciclos:[{desde:'2026-10-20',seq:['dia','noite','folga','folga']}],feriadosSem:[],rev:3,
 eventos:[
  {id:'a1',tipo:'extra',data:'2026-10-22',turno:'custom',ini:'18:00',fim:'02:00',dur:8,destino:'pagamento',pago:false,valor:348.3,maj:2,fer:'',obs:''},
  {id:'a2',tipo:'permuta_assumi',data:'2026-10-27',turno:'dia',pessoa:'Sd. Lima',pg:'servico',valor:null,quitada:false,obs:''},
  {id:'a3',tipo:'permuta_cedi',data:'2026-11-01',pessoa:'Cb. Souza',pg:'dinheiro',valor:150.5,quitada:false,obs:''},
  {id:'a4',tipo:'dispensa',data:'2026-10-24',motivo:'Dispensa',obs:''},
  {id:'a5',tipo:'banco',data:'2026-10-20',horas:5.5,obs:'saldo inicial'}]};
const vazio=new URLSearchParams(location.search).has('vazio');
const API={
 api_carregar:()=>({estado:vazio?null:JSON.parse(JSON.stringify(estado)),sync:vazio?null:{ate:'2026-12-19',quando:'20/10 20:06',criados:0,removidos:0,atualizados:0,pendente:0}}),
 api_salvar:(e,rev)=>({ok:true,rev:(rev||0)+1}),
 api_sincronizar:()=>({ate:'2026-12-19',quando:'20/10 21:00',criados:0,removidos:0,atualizados:0,pendente:0}),
 api_apagarTudo:()=>({ok:true})};
function mk(ok,fail){return new Proxy({},{get(_,n){if(n==='withSuccessHandler')return h=>mk(h,fail);if(n==='withFailureHandler')return h=>mk(ok,h);return(...a)=>setTimeout(()=>ok(API[n](...a)),120);}});}
window.google={script:{run:mk(()=>{},()=>{})}};
// ?aba=mes abre direto numa aba; ?print esconde a barra de rolagem (para capturas)
const q=new URLSearchParams(location.search),aba=q.get('aba');
if(aba)window.addEventListener('load',()=>setTimeout(()=>{const b=document.querySelector('[data-act="aba"][data-arg="'+aba+'"]');if(b)b.click();},500));
if(q.has('print'))document.write('<style>::-webkit-scrollbar{display:none}html{scrollbar-width:none}</style>');
})();
</script>`;

http.createServer((req, res) => {
  // páginas auxiliares: /fontes (comparação de fontes) e /guia?n=1..8 (imagens de divulgação)
  const aux = { '/fontes': 'fontes.html', '/guia': 'guia.html' }[req.url.split('?')[0]];
  if (aux) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(__dirname, aux)));
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8').replace('<base target="_top">', '<base target="_top">' + STUB);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}).listen(PORTA, () => console.log('Prévia em http://localhost:' + PORTA + '  (?vazio para a configuração inicial)'));
