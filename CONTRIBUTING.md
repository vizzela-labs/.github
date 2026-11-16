# Convenções de PR — vizzela-labs

Vale para todos os repositórios da organização. Origem: [vzla-backlog#43](https://github.com/vizzela-labs/vzla-backlog/issues/43).

## Título do PR

```
tipo(escopo): descrição curta
```

Exemplos:

- `feat(pdv): cancelamento da NFC-e na SEFAZ`
- `fix(billing): CPF do cliente não era gravado`
- `refactor(api)!: troca o formato de resposta de /orders` (o `!` marca breaking change)

| Tipo | Uso | Label |
|---|---|---|
| `feat` | funcionalidade nova | `feature` |
| `fix` | correção de bug | `bug` |
| `refactor` | mudança interna sem alterar comportamento | `refactor` |
| `perf` | performance | `performance` |
| `docs` | documentação | `documentation` |
| `test` | testes | `test` |
| `chore` | build, dependências, configuração | `chore` |
| `ci` | pipelines / Actions | `ci` |

O **escopo é obrigatório** e livre: o módulo que mudou (`pdv`, `billing`, `auth`, `product-performance`…). O check **PR padrão / título** valida isso em todo PR.

## Branch

```
tipo/<nº-issue-mãe>-slug-curto      ex.: feat/42-mapa-por-estado
```

O número é a issue-mãe **no [`vzla-backlog`](https://github.com/vizzela-labs/vzla-backlog/issues)**. Se a branch não tiver número, preencha `Issue-mãe: vzla-backlog#42` no corpo do PR. O corpo tem prioridade sobre a branch.

## Fluxo de branches: trunk-based em cima da dev

A **dev** é o tronco (e a branch padrão dos repos). A **main** é o que está em produção.

| Branch | Sai de | PR para | Quando |
|---|---|---|---|
| `tipo/<nº>-slug` (feature, fix...) | `dev` | `dev` | Todo trabalho do dia a dia. Branches curtas: poucos dias, PRs pequenos |
| `dev` | — | `main` | Release. O PR `chore(release): dev → main` fica sempre montado; **qualquer dev** mergeia quando a coluna QA estiver aprovada, avisando o time |
| `hotfix/<nº>-slug` | `main` | `main` | Só correção urgente em produção. Depois do merge, a main volta para a dev sozinha |

- **A dev precisa estar sempre pronta para ir para produção.** A release leva tudo o que está nela: só sai com as features completas; se precisar soltar antes, a parte pela metade fica escondida por uma variável de ambiente.
- **Merge da release sem squash**, para a dev e a main manterem o mesmo histórico.
- Um PR para a main que não venha da dev nem de `hotfix/*` deixa o check **Título** vermelho.
- Nunca commite direto na dev nem na main: sempre por PR.

## Regras do fluxo

| Regra | Como funciona |
|---|---|
| **Caminho da issue** | Quem pega a issue escolhe e marca no `vzla-backlog`: sem label = padrão; `plan`, `quick-spec`, `spec` ou `bugfix-spec`. Só vai para o planning (label `planning`) o que afeta padrão ou longevidade: serviço novo, contrato usado por outro app, troca de lib ou convenção |
| **Colunas do board** | `Backlog → Triagem → Spec → Todo → In progress → In review → QA → Em produção → Done`. **Triagem** (passo 02): um dev pegou a issue e escolhe o caminho. **Spec** (passo 03): a spec + contrato está em PR, esperando back e front aprovarem. A label diz *qual* caminho; a coluna diz *em que fase* a issue está |
| **Review por outro dev, sorteado** | Quando o PR sai do rascunho, a automação pede review de um dev sorteado (menos o autor). Sem cargos; vale para PR único ou pilha de PRs. A lista está em [`scripts/devs.json`](scripts/devs.json) |
| **Como testar** | Todo PR traz o link do ambiente já buildado e os passos, direto. Seção vazia = check **Como testar** vermelho |
| **Preview por PR** | PR para a `dev` sobe sozinho em `<app>-pr-<nº>.equipevizzela.com.br`, com as variáveis do ambiente de dev |
| **QA sorteado** | No merge na `dev`, a automação sorteia um dev (menos o autor) para testar no ambiente de dev junto com quem pediu |
| **Spec** | Fica no repo do back, em `specs/<nº>-slug/` (`requisitos.md` ou `bugfix.md`, `design.md`, `contrato.yaml`, `tarefas.md`), a partir do [modelo](specs-modelo/). No PR, três checks: **Spec: formato** (requisitos em EARS, bugfix com HOJE/ESPERADO/INALTERADO, nenhuma pergunta em aberto), **Spec: contrato** (OpenAPI válido e sem quebrar quem já consome; com `!` no título, só avisa) e **Spec: aprovações** (2 aprovações, back e front) |
| **Mock do front** | Dentro do front, com MSW + `@mswjs/source` (handlers gerados do `contrato.yaml` por [`scripts/mock-do-contrato.sh`](scripts/mock-do-contrato.sh)), em `src/mocks/<nº>-slug/` ([padrão](specs-modelo/README.md#mock-do-front-padrão)). Sai no PR de integração; mock indo para a `main` deixa o check **Release: sem mock** vermelho |
| **Migration** | Roda sozinha no deploy (exceção: `vzla-lojas-api`, que roda à mão com o dono do banco). Migration que apaga ou reescreve dado (DROP, TRUNCATE, RENAME, troca de tipo, `SET NOT NULL`) deixa o check **Migration destrutiva** vermelho: faça backup manual do banco de produção antes da release e escreva "backup" no Como testar, o que transforma o vermelho em aviso. Se der, divida em duas etapas (expandir, depois contrair) |
| **Healthcheck** | Todo app no Coolify tem healthcheck (no Dockerfile ou no Coolify, em `127.0.0.1`): back em `/health` ou `/api/health`, front em `/`. Deploy com container novo que não responde volta sozinho para o antigo |
| **Sprint** | 15 dias. No domingo em que a sprint vira, a automação abre no `vzla-backlog` a issue **Benchmark · Sprint DD/MM/AAAA** com os números da sprint; cada dev responde a retro nela |
| **Pronto é manual** | Release e hotfix levam o item para **Em produção**. Um dev move para **Done** no board depois de conferir em produção. Nenhuma automação marca Done |

Nenhum desses checks bloqueia o merge (o plano Free não bloqueia em repo privado): eles avisam, e o combinado é não mergear com check vermelho.

## O que acontece automaticamente

| Quando | O que a automação faz |
|---|---|
| PR aberto / reaberto / editado | Cria (ou atualiza) a sub-issue `[repo] título do PR` no `vzla-backlog`, pendura na issue-mãe, coloca no projeto **Tecnologia Vizzela** como *In progress*, atribui ao autor e comenta no PR com os links. A issue-mãe vai para *In progress*, ou *QA* quando o preview do PR sobe. |
| PR de spec (só mexe em `specs/`) aberto / mergeado | A issue-mãe fica em *Spec* enquanto o PR está aberto (sem anunciar homologação) e vai para *Todo* no merge na `dev`: back e front começam. |
| Issue do `vzla-backlog` atribuída a alguém (em *Backlog*) | Vai para *Triagem*: quem pegou escolhe o caminho. |
| Label `quick-spec`, `spec` ou `bugfix-spec` na issue (em *Backlog* ou *Triagem*) | Vai para *Spec*. Issue que já passou da spec não volta. |
| PR sai do rascunho | Pede review de um dev sorteado e sobe o preview do PR |
| PR mergeado na **dev** | Sub-issue continua aberta, em *QA* (está no ambiente de dev), com um dev sorteado como QA |
| **Release** (dev → main) mergeada | As sub-issues de todos os PRs da release vão para *Em produção*. Um dev move cada uma para *Done* depois de conferir |
| **Hotfix** mergeado na main | Sub-issue → *Em produção*; a main é levada de volta para a dev por merge (com conflito, abre um PR de sincronização) |
| PR fechado sem merge | Fecha a sub-issue como *not planned*. A mãe não é tocada. |
| PR aberto / reaberto / saiu de draft | O **Claude** revisa o PR seguindo [`review/diretrizes.md`](review/diretrizes.md): comentários inline só para problemas concretos (🔴/🟡/🔵) e um resumo com veredito. É consultivo: não aprova, não bloqueia, não commita. |
| Comentário com `@claude ...` no PR | O Claude responde no PR: tira dúvida, explica trecho ou faz outra rodada de review. |
| Coolify avisa no PR que o preview subiu (back com `@nestjs/swagger`) | Check **Contrato × preview**: cada `specs/*/contrato.yaml` do repo contra o `docs-json` do preview. Endpoint ainda não feito só conta; campo prometido que falta, tipo ou status diferente deixam vermelho. |
| `@claude valide` no PR | O Claude confere o PR contra a spec (`specs/<nº>-*/`) e responde com uma tabela requisito → atendido / parcial / não atendido. |
| `@claude corrija <o quê>` no PR | O Claude aplica a correção e commita **na branch do PR** (nunca na dev ou na main, nunca mergeia). Quem pediu revisa o commit. |
| Issue nova no `vzla-backlog` | O Claude comenta só o que falta perguntar a quem pediu (sem pergunta, não comenta). Não sugere caminho nem planning: quem pega a issue decide e aplica a label. |
| Label `quick-spec`, `spec` ou `bugfix-spec` na issue | O Claude comenta um rascunho da spec (requisitos EARS ou HOJE/ESPERADO/INALTERADO) com as perguntas em aberto, para copiar para `specs/` no back. |
| Domingo (sprint) | Cria a sprint atual e a próxima, abre o benchmark da sprint que acabou e leva os itens abertos para a sprint nova. |

Sem issue-mãe, a sub-issue é criada solta com a label `sem-issue-mae`, e o comentário do PR avisa. Para não gerar sub-issue, aplique a label `no-issue` no PR. PRs de bots (`*[bot]`) são ignorados.

## Agentes (Claude, Codex…)

Cada repo tem no `CLAUDE.md` (ou `AGENTS.md`) a seção **Fluxo Vizzela**, entre `<!-- vzla:fluxo -->` e `<!-- /vzla:fluxo -->`, gerada por [`scripts/agentes.js`](scripts/agentes.js). Para mudar, edite lá e reaplique; o resto do arquivo é do repo.

## Adicionar a automação a um repo

```bash
# no clone deste repo (vizzela-labs/.github)
./scripts/setup-repo.sh --pem ~/caminho/vizzela-labs.private-key.pem --claude-token-clipboard <repo> [<repo>...]
```

Veja [`scripts/README.md`](scripts/README.md).
