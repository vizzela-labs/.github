# Tarefas · <nº> <nome>

<!--
Em ondas. Cada tarefa vira um PR pequeno e aponta os requisitos que cobre.
Onda 1 é sempre o contrato: depois dele, back e front andam em paralelo.
-->

## Branches

<!--
O plano de execução. Quando a spec é mergeada na dev, cada linha com branch vira uma branch
saindo da dev do repo, e a issue recebe o prompt para o Claude de quem é o dono.
- Repo: um repo por linha (vzla-panel-hub, vzla-lojas-pdv, vzla-cashback…).
- Branch: tipo/<nº>-slug, com o nº da issue daquele trabalho (pode ser uma filha da issue da spec).
- Issue: a issue do vzla-backlog que o PR fecha (#nº). Dono: login do GitHub.
- Linha sem branch ("—") é só informativa (ex.: a integração, feita na mesma branch do front).
-->

| Onda | Repo | Branch | Issue | Dono | Requisitos |
|---|---|---|---|---|---|
| 2 | vzla-exemplo-api | feat/42-cashback-extrato | #42 | @login-do-back | R1, R2 |
| 2 | vzla-exemplo-front | feat/43-tela-extrato | #43 | @login-do-front | R3 |
| 3 | vzla-exemplo-front | — | #43 | @login-do-front | integração |

## Onda 1 · contrato

- [ ] Contrato aprovado por back e front (`contrato.yaml`) · R1, R2

## Onda 2 · em paralelo

- [ ] back: <endpoint> · R1
- [ ] front: tela com o mock gerado do contrato (`src/mocks/<nº>-slug/`) · R1

## Onda 3 · integração

- [ ] front: troca o mock pela API de dev e apaga `src/mocks/<nº>-slug/`
- [ ] QA no ambiente de dev
