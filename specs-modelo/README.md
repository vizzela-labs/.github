# Modelo de spec

Copie esta pasta para `specs/<nº>-slug/` no repo do **back** e apague o que não usar:

| Caminho da issue | Arquivos |
|---|---|
| `quick-spec` | `requisitos.md` (e `contrato.yaml`, se mexer na API) |
| `spec` | `requisitos.md`, `design.md`, `contrato.yaml`, `tarefas.md` |
| `bugfix-spec` | `bugfix.md` (e `design.md`, se a correção não for óbvia) |

```bash
mkdir -p specs/42-cashback-extrato
gh api repos/vizzela-labs/.github/contents/specs-modelo/requisitos.md --jq .content | base64 -d > specs/42-cashback-extrato/requisitos.md
```

Ou peça ao Claude Code local: *"monte a spec da vzla-backlog#42 seguindo vizzela-labs/.github/specs-modelo"*.

## Checks no PR da spec

| Check | O que confere |
|---|---|
| **Spec: formato** | Requisitos no formato EARS; bugfix com HOJE, ESPERADO e INALTERADO; nenhum `[PERGUNTA]`, `TODO` ou `?` no ESPERADO |
| **Spec: contrato** | `contrato.yaml` válido (Redocly, regras mínimas) |
| **Spec: aprovações** | 2 aprovações (back e front) |

Todos avisam, nenhum bloqueia.

## Mock do front: padrão

O mock não é escrito do zero: sai do contrato.

| Peça | Lib |
|---|---|
| Interceptar as chamadas | [MSW](https://mswjs.io) (`msw`) |
| Handlers a partir do OpenAPI | [`@mswjs/source`](https://github.com/mswjs/source) (`fromOpenApi`), usa os `examples` do contrato |
| Tipos TypeScript | [`openapi-typescript`](https://openapi-ts.dev) |

```ts
// src/mocks/42-cashback-extrato/handlers.ts
import { fromOpenApi } from '@mswjs/source/open-api'
import contrato from './contrato.json' // cópia do specs/42-.../contrato.yaml do back

export const handlers = await fromOpenApi(contrato)
```

- Tudo do mock fica em `src/mocks/<nº>-slug/`. O PR de integração apaga a pasta.
- Mock indo para a `main` deixa o check **Release: sem mock** vermelho.
- Só ligue o MSW em dev: `if (import.meta.env.VITE_MOCK === 'true') await worker.start()`.
