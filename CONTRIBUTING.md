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
| `dev` | — | `main` | Release no **fim de cada sprint**. O PR `chore(release): dev → main` é aberto e atualizado sozinho |
| `hotfix/<nº>-slug` | `main` | `main` | Só correção urgente em produção. Depois do merge, a main volta para a dev sozinha |

- **A dev precisa estar sempre pronta para ir para produção.** A release leva tudo o que está nela: o que estiver pela metade entra desligado por uma flag ou não entra.
- **Merge da release sem squash**, para a dev e a main manterem o mesmo histórico.
- Um PR para a main que não venha da dev nem de `hotfix/*` deixa o check **Título** vermelho.
- Nunca commite direto na dev nem na main: sempre por PR.

## O que acontece automaticamente

| Quando | O que a automação faz |
|---|---|
| PR aberto / reaberto / editado | Cria (ou atualiza) a sub-issue `[repo] título do PR` no `vzla-backlog`, pendura na issue-mãe, coloca no projeto **Tecnologia Vizzela** como *In progress*, atribui ao autor e comenta no PR com os links. |
| PR mergeado na **dev** | Sub-issue continua aberta, em *QA* (está no ambiente de dev) |
| **Release** (dev → main) mergeada | As sub-issues de todos os PRs da release vão para *Done*. A issue-mãe fecha quando todas as filhas fecham e não há tarefas `- [ ]` pendentes nela |
| **Hotfix** mergeado na main | Sub-issue → *Done*; a main é levada de volta para a dev por merge (com conflito, abre um PR de sincronização) |
| PR fechado sem merge | Fecha a sub-issue como *not planned* → *Done*. A mãe não é tocada. |
| PR aberto / reaberto / saiu de draft | O **Claude** revisa o PR seguindo [`review/diretrizes.md`](review/diretrizes.md): comentários inline só para problemas concretos (🔴/🟡/🔵) e um resumo com veredito. É consultivo: não aprova, não bloqueia, não commita. |
| Comentário com `@claude ...` no PR | O Claude responde no PR: tira dúvida, explica trecho ou faz outra rodada de review. |

Sem issue-mãe, a sub-issue é criada solta com a label `sem-issue-mae`, e o comentário do PR avisa. Para não gerar sub-issue, aplique a label `no-issue` no PR. PRs de bots (`*[bot]`) são ignorados.

## Adicionar a automação a um repo

```bash
# no clone deste repo (vizzela-labs/.github)
./scripts/setup-repo.sh --pem ~/caminho/vizzela-labs.private-key.pem --claude-token-clipboard <repo> [<repo>...]
```

Veja [`scripts/README.md`](scripts/README.md).
