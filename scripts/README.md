# scripts

| Arquivo | O que é |
|---|---|
| `lib.js` | Regras compartilhadas: parse do título, da issue-mãe e do resumo; labels. |
| `pr-title.js` | Usado por `reusable-pr-title.yml`: valida o título e aplica a label de tipo. |
| `pr-sync.js` | Usado por `reusable-pr-sync.yml`: cria, atualiza e fecha a sub-issue no `vzla-backlog` e mexe no Status do projeto. |
| `setup-repo.sh` | Instala o PR padrão num repo: labels, secrets e PR com o workflow. |
| `test.js` | Testes do `lib.js` (`node scripts/test.js`). |

## Instalar em um repo

```bash
git clone https://github.com/vizzela-labs/.github vzla-dotgithub && cd vzla-dotgithub

# labels + secrets + PR com o workflow
./scripts/setup-repo.sh --pem ~/Downloads/vizzela-labs.private-key.pem vzla-panel-hub vzla-data-hub

# todos os repos da org
./scripts/setup-repo.sh --pem ~/Downloads/vizzela-labs.private-key.pem --all

# token do Claude (gerado num terminal normal com `claude setup-token`, copiado para o clipboard)
./scripts/setup-repo.sh --claude-token-clipboard --only-secrets vzla-panel-hub vzla-data-hub

# só gravar/rotacionar os secrets
./scripts/setup-repo.sh --pem ~/Downloads/vizzela-labs.private-key.pem --only-secrets --all
```

A chave `.pem` é a do GitHub App **vizzela-labs** (Settings da org → Developer settings → GitHub Apps → vizzela-labs → Private keys). Ela só é lida localmente e enviada criptografada ao GitHub pelo `gh secret set`. **Nunca commite a chave.**

O token do Claude (`CLAUDE_CODE_OAUTH_TOKEN`) vem de uma assinatura Claude (Pro/Max) e consome a cota dela. Gere com `claude setup-token` em um terminal normal, porque o comando é interativo.

No plano Free, secrets da organização não chegam a repositórios privados. Por isso os secrets são gravados repo a repo.

## IDs fixos (em `pr-sync.js`)

| Item | Valor |
|---|---|
| Projeto Tecnologia Vizzela | `PVT_kwDOFBBL-s4BlX7s` |
| Campo Status | `PVTSSF_lADOFBBL-s4BlX7szhkFDoI` |
| In progress / Done | `47fc9ee4` / `98236657` |
