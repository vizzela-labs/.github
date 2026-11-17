# Spec gerada da triagem — vizzela-labs

Uma issue do `vzla-backlog` recebeu `quick-spec`, `spec` ou `bugfix-spec`. Você escreve a spec no repo do back, a partir da issue, das respostas da triagem e do código, e lista o que ainda falta decidir. O workflow abre o PR de spec (rascunho) com o que você escrever; back e front respondem as perguntas no PR, e um deles aprova.

Você **não** commita, não faz push, não abre PR, não aplica label e não comenta na issue: o workflow faz isso.

## Entradas

- A issue, os comentários (a triagem e as respostas) e a issue-mãe ou as sub-issues: `gh issue view <nº> -R vizzela-labs/vzla-backlog --comments`.
- O código do back, na branch `dev`, em `back/`. Leia `CLAUDE.md`/`AGENTS.md`, o `main.ts` (prefixo global), os módulos e DTOs que a feature toca, a autenticação e as specs que já existem em `back/specs/`.
- O código de outro repo da org (o front que vai consumir, por exemplo), só leitura: `gh api "repos/vizzela-labs/<repo>/contents/<caminho>?ref=dev"` (o conteúdo vem em base64 em `.content`) ou `gh search code "<termo>" --owner vizzela-labs`.
- Os modelos em `.vzla/specs-modelo/`. Siga a estrutura deles.

## O que escrever, em `back/<PASTA>/`

| Label | Arquivos |
|---|---|
| `quick-spec` | `requisitos.md`, `tarefas.md` (curto) e `contrato.yaml` se a feature mexe na API |
| `spec` | `requisitos.md`, `design.md`, `contrato.yaml`, `tarefas.md` |
| `bugfix-spec` | `bugfix.md`, `tarefas.md` (curto) e `design.md` se a correção não for óbvia |

- **requisitos.md:** requisitos EARS (`QUANDO …, O SISTEMA DEVE …`), numerados R1, R2… e agrupados por quem consome (painel, PDV, back). Mensuráveis: nada de "rápido", "adequado", "etc.".
- **bugfix.md:** HOJE (passos e o que acontece), ESPERADO e INALTERADO. Cada item do INALTERADO vira teste de regressão.
- **design.md:** como fica no código **deste** back: módulos, tabelas e migrations, autenticação, filas, o que já existe e é reaproveitado (cite os arquivos), riscos.
- **contrato.yaml:** OpenAPI 3.1. Os `paths` exatamente como o código vai expor, com o prefixo global (ex.: `/api/...`). Cada operação com `operationId`, `security` quando houver auth, os status de erro (400, 401, 403, 404, 409…) e **`examples` em toda resposta**: o mock do front é gerado deles. Não mude nem repita rotas que já existem, a não ser que a issue peça.
  - **YAML em bloco, nunca `{ … }` com texto:** em `{ type: integer, description: Saldo, em centavos }` a vírgula vira outra propriedade e o contrato quebra. Escreva cada propriedade em linhas próprias e ponha entre aspas toda `description` com `,`, `:` ou `#`.
  - **Antes de terminar, valide:** `npx --yes @redocly/cli@1 lint back/<PASTA>/contrato.yaml --extends=minimal` (o mesmo do check **Spec: contrato**). Corrija até passar.
- **tarefas.md:** a seção `## Branches` (obrigatória, o check **Spec: formato** confere) e as ondas: contrato → back ‖ front com mock → integração. Cada tarefa aponta os requisitos (R1…).

### A tabela `## Branches`

É o plano de execução. No merge da spec, cada linha com branch vira uma branch saindo da `dev` daquele repo, e a issue da linha recebe o prompt para o Claude do dono.

```
| Onda | Repo | Branch | Issue | Dono | Requisitos |
|---|---|---|---|---|---|
| 2 | vzla-cashback | feat/176-cashback-admin-api | #176 | @higorless | R1–R6 |
| 2 | vzla-panel-hub | feat/174-painel-cashback | #174 | @Moredy | R7–R10 |
| 3 | vzla-panel-hub | — | #174 | @Moredy | integração |
```

- Um repo por linha, uma branch por repo e issue. Branch `tipo/<nº>-slug`, com o nº da issue daquele trabalho: se a issue tem sub-issues por repo (painel, PDV, back), use o nº de cada uma; senão, o nº da issue da spec.
- **Dono:** quem está atribuído àquela issue (`gh issue view <nº> --json assignees`). Sem ninguém, deixe `[PERGUNTA: quem faz?]` na célula.
- A integração acontece na mesma branch do front: linha sem branch (`—`).

## O que você não sabe vira pergunta

Não invente regra de negócio, nome de permissão, limite, texto de tela nem quem aprova. O que não está na issue, nas respostas da triagem nem no código fica **no lugar exato do arquivo** como `[PERGUNTA: … (quem responde: growth / financeiro / loja / back / front)]`. O check **Spec: formato** fica vermelho enquanto houver `[PERGUNTA]`: é assim que a spec não é aprovada pela metade.

Decisão técnica que o código responde (nome de tabela, módulo, padrão de auth) não é pergunta: decida pelo padrão do repo e diga no `design.md` de onde tirou.

## Saídas além dos arquivos da spec

**`/tmp/spec/resumo.md`:** 2 a 4 frases para o Resumo do PR: o que a spec cobre e para quem.

**`/tmp/spec/perguntas.md`:** o primeiro comentário do PR, exatamente neste formato:

```
<!-- vzla:spec-perguntas -->
## 🤖 Spec gerada da triagem

### ✅ Já está fechado
- **R1–R3 (painel):** <o que ficou decidido> · fonte: <triagem / issue / `src/arquivo.ts`>

### ❓ Falta decidir
1. **requisitos.md · R4:** <pergunta objetiva> · quem responde: <growth / back / front…>
2. **contrato.yaml · `GET /api/...`:** <pergunta>

### Como seguir
1. Responda as perguntas aqui no PR (uma resposta por número).
2. Comente `@claude corrija aplique as respostas` para eu atualizar os arquivos e tirar os `[PERGUNTA]`.
3. Sem nenhum `[PERGUNTA]`, o check **Spec: formato** fica verde. Tire o PR do rascunho e peça 1 aprovação (back ou front).
4. No merge, cada linha da tabela **Branches** do `tarefas.md` vira uma branch, e a issue recebe o prompt para o seu Claude.
```

- Uma linha por `[PERGUNTA]` deixada nos arquivos, na mesma ordem, apontando arquivo e requisito ou rota.
- Sem pergunta em aberto, escreva em ❓ "Nada: a spec está pronta para revisão".
- Não repita a spec no comentário. Sem dado de cliente, token ou credencial.

## Quando pedirem `@claude corrija` no PR de spec

Aplique as respostas dos comentários nos arquivos de `specs/`, tire os `[PERGUNTA]` respondidos, mantenha os outros e, no fim, diga em uma lista o que mudou e quais perguntas ainda faltam. Só mexa em `specs/`.
