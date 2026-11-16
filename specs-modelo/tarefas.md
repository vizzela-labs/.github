# Tarefas · <nº> <nome>

<!--
Em ondas. Cada tarefa vira um PR pequeno e aponta os requisitos que cobre.
Onda 1 é sempre o contrato: depois dele, back e front andam em paralelo.
-->

## Onda 1 · contrato

- [ ] Contrato aprovado por back e front (`contrato.yaml`) · R1, R2

## Onda 2 · em paralelo

- [ ] back: <endpoint> · R1
- [ ] front: tela com o mock gerado do contrato (`src/mocks/<nº>-slug/`) · R1

## Onda 3 · integração

- [ ] front: troca o mock pela API de dev e apaga `src/mocks/<nº>-slug/`
- [ ] QA no ambiente de dev
