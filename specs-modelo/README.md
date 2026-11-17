# Modelo de spec

Copie esta pasta para `specs/<nº>-slug/` no repo do **back** e apague o que não usar:

| Caminho da issue | Arquivos |
|---|---|
| `quick-spec` | `requisitos.md`, `tarefas.md` (e `contrato.yaml`, se mexer na API) |
| `spec` | `requisitos.md`, `design.md`, `contrato.yaml`, `tarefas.md` |
| `bugfix-spec` | `bugfix.md`, `tarefas.md` (e `design.md`, se a correção não for óbvia) |

```bash
mkdir -p specs/42-cashback-extrato
gh api repos/vizzela-labs/.github/contents/specs-modelo/requisitos.md --jq .content | base64 -d > specs/42-cashback-extrato/requisitos.md
```

Normalmente você não copia nada: a label `quick-spec`, `spec` ou `bugfix-spec` na issue (com `repo:<back>`) faz o Claude escrever a spec e abrir o PR de spec em rascunho, com as perguntas no primeiro comentário. À mão, ou peça ao Claude Code local: *"monte a spec da vzla-backlog#42 seguindo vizzela-labs/.github/specs-modelo"*.

## Checks no PR da spec

| Check | O que confere |
|---|---|
| **Spec: formato** | Requisitos no formato EARS; bugfix com HOJE, ESPERADO e INALTERADO; `tarefas.md` com a tabela **Branches**; nenhum `[PERGUNTA]`, `TODO` ou `?` no ESPERADO |
| **Spec: contrato** | `contrato.yaml` válido (Redocly, regras mínimas) e sem quebra em relação à `dev` (oasdiff; com `!` no título, só avisa) |
| **Spec: aprovações** | 2 aprovações (back e front) |

Todos avisam, nenhum bloqueia.

## Do merge ao código

A tabela **Branches** do `tarefas.md` é o plano de execução. No merge da spec na `dev`:

1. Cada linha com branch vira uma branch saindo da `dev` daquele repo (a que já existe fica como está).
2. A issue de cada linha (e a issue da spec) recebe um comentário com a branch e o prompt pronto para o Claude do dono.
3. O dono faz `git fetch && git switch <branch>`, cola o prompt no Claude Code e acompanha: o Claude lê a spec (no back, via `gh api` quando o repo é outro), implementa só a linha dele e abre o PR para a `dev` em rascunho.

## Mock do front: padrão

O mock não é escrito do zero: sai do contrato. Na raiz do front:

```bash
bash <(gh api repos/vizzela-labs/.github/contents/scripts/mock-do-contrato.sh --jq .content | base64 -d) \
  vzla-cashback 42-cashback-extrato            # contrato na dev do back
#  … 42-cashback-extrato --ref feat/42-spec    # contrato ainda no PR da spec
# CONTRATO_ARQUIVO=../vzla-cashback/specs/42-cashback-extrato/contrato.yaml bash <(…) vzla-cashback 42-cashback-extrato
```

| Gera | Para quê | No PR de integração |
|---|---|---|
| `src/mocks/<nº>-slug/contrato.json` e `handlers.ts` | Handlers do [MSW](https://mswjs.io) montados por [`@mswjs/source`](https://github.com/mswjs/source) a partir dos `examples` do contrato | Apaga a pasta |
| `src/api/<nº>-slug.ts` | Tipos TypeScript ([`openapi-typescript`](https://openapi-ts.dev)) | Fica |

Na primeira vez num front, o script instala `msw@2` e `@mswjs/source` e cria `public/mockServiceWorker.js`, e mostra o trecho que vai no `src/main.tsx`:

```ts
if (import.meta.env.VITE_MOCK === 'true') {
  const { setupWorker } = await import('msw/browser')
  const mods = import.meta.glob<{ handlers: never[] }>('./mocks/*/handlers.ts')
  const handlers = (await Promise.all(Object.values(mods).map((m) => m()))).flatMap((m) => m.handlers)
  await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass' })
}
```

- Rode com `VITE_MOCK=true VITE_MOCK_API_URL=<host que o front chama> npm run dev`.
- Sem `VITE_MOCK=true` o Vite corta o bloco no build: o mock não entra no bundle de produção.
- Caso específico (erro, lista vazia)? Coloque um `http.get(...)` antes dos gerados em `handlers.ts`, ou um `examples` a mais no contrato.
- Mock indo para a `main` deixa o check **Release: sem mock** vermelho.

## Contrato × implementação

Nos backs que publicam o OpenAPI (`@nestjs/swagger`), quando o Coolify avisa que o preview do PR subiu, o check **Contrato × preview** compara cada `specs/*/contrato.yaml` do repo com o `docs-json` do preview (oasdiff). Endpoint ainda não implementado só aparece na contagem; campo prometido que falta, tipo diferente ou status que sumiu deixam o check vermelho.

- Os `paths` do contrato precisam bater com os do código, incluindo o prefixo global (ex.: `/api/...`).
- Back sem `@nestjs/swagger` (vzla-lojas-api, data-hub, sales-dash) fica fora até publicar o OpenAPI. O mapa está em `scripts/lib.js` (`OPENAPI_PATHS`).
