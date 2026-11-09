#!/usr/bin/env bash
# Instala o "PR padrão" em repositórios da vizzela-labs:
#   1. labels de tipo no repo
#   2. secrets VZLA_APP_ID / VZLA_APP_PRIVATE_KEY (com --pem) e CLAUDE_CODE_OAUTH_TOKEN (com --claude-token-*)
#   3. .github/workflows/pr-padrao.yml, via PR numa branch ci/<issue>-pr-padrao
#
# Uso:
#   ./scripts/setup-repo.sh [opções] <repo> [<repo>...]
#   ./scripts/setup-repo.sh [opções] --all
#
# Opções:
#   --pem <arquivo>     chave privada (.pem) do GitHub App vizzela-labs → grava os secrets
#   --app-id <id>       App ID (padrão 5152257)
#   --claude-token-file <arquivo>   arquivo com o token de `claude setup-token` → secret CLAUDE_CODE_OAUTH_TOKEN
#   --claude-token-clipboard        lê o token da área de transferência (pbpaste)
#   --only-secrets      só grava os secrets (exige --pem e/ou --claude-token-*)
#   --skip-workflow     não abre o PR do workflow
#   --parent <nº>       issue-mãe no vzla-backlog para o PR de instalação (padrão 43)
#   --all               todos os repos não arquivados da org (exceto .github e vzla-backlog)
#
# Requer: gh autenticado com escopos repo + workflow, e acesso de admin/escrita aos repos.
set -euo pipefail

ORG="vizzela-labs"
APP_ID="5152257"
PEM=""
CLAUDE_TOKEN=""
ONLY_SECRETS=0
SKIP_WORKFLOW=0
PARENT="43"
ALL=0
REPOS=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_SRC="$SCRIPT_DIR/../workflow-templates/pr-padrao.yml"
WORKFLOW_DST=".github/workflows/pr-padrao.yml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pem) PEM="$2"; shift 2 ;;
    --app-id) APP_ID="$2"; shift 2 ;;
    --claude-token-file) CLAUDE_TOKEN="$(tr -d '[:space:]' <"$2")"; shift 2 ;;
    --claude-token-clipboard) CLAUDE_TOKEN="$(pbpaste | tr -d '[:space:]')"; shift ;;
    --only-secrets) ONLY_SECRETS=1; shift ;;
    --skip-workflow) SKIP_WORKFLOW=1; shift ;;
    --parent) PARENT="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    -*) echo "Opção desconhecida: $1" >&2; exit 1 ;;
    *) REPOS+=("${1#"$ORG/"}"); shift ;;
  esac
done

if [[ $ALL -eq 1 ]]; then
  while IFS= read -r r; do REPOS+=("$r"); done < <(
    gh repo list "$ORG" --limit 200 --no-archived --json name --jq '.[].name' | grep -vxE '\.github|vzla-backlog'
  )
fi
[[ ${#REPOS[@]} -gt 0 ]] || { echo "Informe ao menos um repo ou --all" >&2; exit 1; }
if [[ $ONLY_SECRETS -eq 1 && -z "$PEM" && -z "$CLAUDE_TOKEN" ]]; then echo "--only-secrets exige --pem e/ou --claude-token-*" >&2; exit 1; fi
if [[ -n "$CLAUDE_TOKEN" && "$CLAUDE_TOKEN" != sk-ant-* ]]; then echo "O token do Claude não parece válido (esperado sk-ant-...)" >&2; exit 1; fi
if [[ -n "$PEM" && ! -f "$PEM" ]]; then echo "Arquivo .pem não encontrado: $PEM" >&2; exit 1; fi

# nome|cor|descrição
LABELS=(
  "feature|1d76db|Funcionalidade nova"
  "bug|d73a4a|Correção de bug"
  "refactor|c5def5|Mudança interna sem alterar comportamento"
  "performance|fbca04|Performance"
  "documentation|0075ca|Documentação"
  "test|bfd4f2|Testes"
  "chore|ededed|Build, dependências, configuração"
  "ci|5319e7|Pipelines / Actions"
  "breaking|b60205|Breaking change"
  "no-issue|cccccc|Não gerar sub-issue para este PR"
  "homologar|0e8a16|Sobe este PR na branch dev (ambiente de homologação)"
)

setup_labels() {
  local repo="$1" entry name color desc
  for entry in "${LABELS[@]}"; do
    IFS='|' read -r name color desc <<<"$entry"
    gh label create "$name" -R "$ORG/$repo" --color "$color" --description "$desc" --force >/dev/null
  done
  echo "  ✓ labels"
}

setup_secrets() {
  local repo="$1"
  if [[ -n "$PEM" ]]; then
    gh secret set VZLA_APP_ID -R "$ORG/$repo" --body "$APP_ID" >/dev/null
    gh secret set VZLA_APP_PRIVATE_KEY -R "$ORG/$repo" <"$PEM" >/dev/null
    echo "  ✓ secrets VZLA_APP_ID / VZLA_APP_PRIVATE_KEY"
  fi
  if [[ -n "$CLAUDE_TOKEN" ]]; then
    printf '%s' "$CLAUDE_TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$ORG/$repo" >/dev/null
    echo "  ✓ secret CLAUDE_CODE_OAUTH_TOKEN"
  fi
}

setup_workflow() {
  local repo="$1" default branch base_sha content remote_sha existing_pr
  default="$(gh api "repos/$ORG/$repo" --jq .default_branch)"
  content="$(base64 <"$WORKFLOW_SRC" | tr -d '\n')"

  # Já instalado e idêntico na branch padrão?
  if remote="$(gh api "repos/$ORG/$repo/contents/$WORKFLOW_DST?ref=$default" --jq .content 2>/dev/null)"; then
    if [[ "$(tr -d '\n' <<<"$remote")" == "$content" ]]; then echo "  ✓ workflow já instalado em $default"; return; fi
  fi

  branch="ci/${PARENT}-pr-padrao"
  existing_pr="$(gh pr list -R "$ORG/$repo" --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null || true)"

  base_sha="$(gh api "repos/$ORG/$repo/git/ref/heads/$default" --jq .object.sha)"
  gh api -X POST "repos/$ORG/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$base_sha" >/dev/null 2>&1 || true

  remote_sha="$(gh api "repos/$ORG/$repo/contents/$WORKFLOW_DST?ref=$branch" --jq .sha 2>/dev/null || true)"
  args=(-X PUT "repos/$ORG/$repo/contents/$WORKFLOW_DST" -f branch="$branch" -f content="$content"
        -f message="ci(github): adiciona workflow PR padrão")
  [[ -n "$remote_sha" ]] && args+=(-f sha="$remote_sha")
  gh api "${args[@]}" >/dev/null 2>&1 || echo "  · workflow já atualizado na branch $branch"

  if [[ -n "$existing_pr" ]]; then
    echo "  ✓ PR já aberto: $existing_pr"
    return
  fi
  gh pr create -R "$ORG/$repo" --base "$default" --head "$branch" \
    --title "ci(github): adiciona workflow PR padrão" \
    --body "$(cat <<EOF
## Resumo

Instala o workflow **PR padrão** da org: valida o título \`tipo(escopo): descrição\` e mantém automaticamente uma sub-issue deste PR no \`vzla-backlog\` / projeto Tecnologia Vizzela. A lógica mora em [vizzela-labs/.github](https://github.com/vizzela-labs/.github); aqui fica só o arquivo que a chama.

## Por quê

Padronizar PRs em todos os repos e acabar com a criação/vínculo manual de sub-issues.

## Como testar

Este próprio PR já dispara o workflow: o check **Título** deve passar e o comentário de rastreamento deve apontar a sub-issue criada (requer os secrets \`VZLA_APP_ID\` / \`VZLA_APP_PRIVATE_KEY\` no repo).

## Issue-mãe

Issue-mãe: vzla-backlog#${PARENT}

## Checklist

- [x] Eu li, rodei e me responsabilizo por este código.
- [x] Título segue \`tipo(escopo): descrição\`.
- [x] Sem \`.env\`, credenciais ou dados de cliente no diff.
EOF
)"
}

for repo in "${REPOS[@]}"; do
  echo "▶ $ORG/$repo"
  if [[ $ONLY_SECRETS -eq 1 ]]; then setup_secrets "$repo"; continue; fi
  setup_labels "$repo"
  if [[ -n "$PEM" || -n "$CLAUDE_TOKEN" ]]; then setup_secrets "$repo"; fi
  [[ $SKIP_WORKFLOW -eq 1 ]] || setup_workflow "$repo"
done
