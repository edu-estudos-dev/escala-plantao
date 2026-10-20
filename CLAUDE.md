# Escala de Plantão

Web app em Google Apps Script (gerenciado com `clasp`) para quem trabalha em regime de plantão (escala dia/noite).
Cada pessoa abre o app com a própria conta Google (`executeAs: USER_ACCESSING`, `access: ANYONE`), e os dados são só dela.

## O que o app faz

- **Ciclo da escala**: o usuário define uma sequência (ex.: dia, noite, folga, folga) e a data de início (`ciclos[]`, cada um com `desde` e `seq`). Os serviços de cada dia são calculados a partir disso, sem ficarem gravados.
- **Lançamentos** (`S.eventos[]`, campo `tipo`):
  - `extra`: DRSO (serviço extra, de 6 a 12h). O valor é calculado minuto a minuto, com +30% em sábado, domingo, feriado e na madrugada (00:00–05:00), sem somar adicionais. Pode ir para pagamento ou para o banco de horas.
  - `permuta_assumi` / `permuta_cedi`: troca de serviço com um colega, paga com outro serviço ou em dinheiro.
  - `dispensa` (inclui "Folga do banco"), `licenca` (férias/licença, de `data` até `fim`), `banco` (ajuste manual de horas).
- **Choques**: bloqueia horários que se sobrepõem, DRSO a menos de 8h de descanso de outro serviço e DRSO/permuta dentro de férias/licença. A checagem roda no cliente e de novo no servidor.
- **Relatórios**: resumo do mês, fechamento financeiro, saldo de permutas por colega, banco de horas e exportação em CSV.
- **Google Agenda**: mantém uma agenda "Plantão" do usuário com os próximos 60 dias. Um gatilho diário (`sincronizarDiario`, às 3h) segue atualizando essa janela.

## Organização do código

- `appsscript.json`: manifesto (fuso America/Fortaleza, V8, escopos de calendar e script.scriptapp, configuração do web app).
- `Código.js`: servidor.
  - Bloco **`//#UTIL-START` … `//#ENGINE-END`**: utilitários e motor de regras (`baseDoDia`, `turnosDoDia`, `calcDRSO`, `choques`, `resumo`, `relatorioMes`, `banco`, `ledger`…). Trabalha sobre o estado global `S`.
  - Armazenamento: `PropertiesService.getUserProperties()`. A config fica em `cfg`, e os eventos em blocos `ev0`, `ev1`… de até 6000 caracteres cada. Usa `rev` para controle otimista de concorrência.
  - API chamada pelo cliente: `api_carregar`, `api_salvar(estado, revBase)`, `api_sincronizar` e `api_apagarTudo` (apaga as propriedades, a agenda "Plantão" e o gatilho). As funções internas terminam em `_`.
  - Backup: Ajustes > Seus dados exporta e importa um JSON `{app:'escala-plantao', dados}`, validado por `lerCopia` no cliente.
  - Agenda: `srvSincronizar_` compara o que existe com o que deveria existir pelas tags `k` (chave) e `sig` (assinatura). Faz no máximo 20 operações por rodada, com pausa de 500 ms entre elas.
- `Index.html`: o front inteiro (CSS, HTML e JS num só arquivo, sem framework). Usa uma **cópia idêntica** do bloco UTIL/ENGINE, além das views (`viewHoje`, `viewMes`, `viewLancar`, `viewSaldos`, `viewAjustes`), dos formulários e de `gs()`, um wrapper com Promise sobre `google.script.run`.

**Importante:** o bloco entre `//#UTIL-START` e `//#ENGINE-END` precisa ficar igual nos dois arquivos. Toda mudança no motor deve ser feita nos dois.

- `testes/testes.js`: confere se o motor está igual nos dois arquivos e testa feriados, cálculo de DRSO, armazenamento em blocos e os títulos de evento. Rode `node testes/testes.js` antes de qualquer `clasp push`. O `.claspignore` mantém a pasta fora do Apps Script.
- Feriados: `feriadosDoAno(ano)` gera as datas fixas mais a Sexta-feira Santa. `ferAnos` guarda os anos que já foram adicionados aos dados do usuário, para não trazer de volta um feriado que ele removeu.
- Armazenamento: `cfg.nev` diz quantos blocos `evN` valem. Ao ler, blocos acima disso são ignorados. Há um limite de espaço em `LIMITE_BYTES`, abaixo dos ~500 KB que o Google permite.
- `TITULO_APP` precisa acompanhar os títulos gerados em `srvEspec_`, porque é por ele que a sincronização reconhece eventos do app que ficaram sem marca.

## Regras do projeto

- **Nunca rodar `clasp push` sem o usuário pedir explicitamente.**
- **Antes de começar mudanças grandes, rodar `clasp pull`** para trazer a versão atual do Apps Script (o código pode ter sido editado no editor online).

## Como publicar

1. `clasp push` (só quando o usuário pedir).
2. No editor do Apps Script: **Implantar > Gerenciar implantações**, editar a implantação existente e escolher **Nova versão**. Assim a URL do app continua a mesma.

   Equivalente pelo terminal (mesmo efeito, mesma URL):
   ```bash
   clasp list-deployments                     # a de produção é a que não é @HEAD
   clasp create-version "descrição"           # devolve o número N
   clasp update-deployment <deploymentId> -V N -d "descrição"
   ```
