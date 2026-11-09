#!/usr/bin/env bash
# Remonta a branch de integração (dev) = branch padrão + PRs abertos com a label de homologação.
# Roda dentro de um checkout completo (fetch-depth: 0) do repo, com GH_TOKEN com
# contents:write e pull-requests:write. A dev é REESCRITA: ninguém commita direto nela.
#
# Variáveis: DEV_BRANCH (dev), LABEL (homologar), DEV_URL (endereço do ambiente, opcional), REPO (owner/name)
set -euo pipefail

DEV_BRANCH="${DEV_BRANCH:-dev}"
LABEL="${LABEL:-homologar}"
DEV_URL="${DEV_URL:-}"
REPO="${REPO:?REPO obrigatório}"
TAG='<!-- vzla-dev -->'

git config user.name "vizzela-dev-bot"
git config user.email "dev-bot@users.noreply.github.com"

BASE="$(gh api "repos/$REPO" --jq .default_branch)"
git fetch --quiet origin "+refs/heads/*:refs/remotes/origin/*"

# PRs abertos do próprio repo, contra a branch padrão, com a label.
PRS=()
while IFS= read -r line; do [ -n "$line" ] && PRS+=("$line"); done < <(gh pr list -R "$REPO" --state open --label "$LABEL" --base "$BASE" --limit 50 \
  --json number,headRefName,isCrossRepository --jq '.[]|select(.isCrossRepository|not)|"\(.number) \(.headRefName)"')

git checkout --quiet -B "$DEV_BRANCH" "origin/$BASE"
INCLUDED=(); CONFLICTS=()
for ((i = 0; i < ${#PRS[@]}; i++)); do
  entry="${PRS[$i]}"; num="${entry%% *}"; head="${entry#* }"
  if git merge --quiet --no-ff --no-edit -m "homologar: #$num ($head)" "origin/$head" >/dev/null 2>&1; then
    INCLUDED+=("$num")
  else
    git merge --abort || true
    CONFLICTS+=("$num")
  fi
done

NEW_TREE="$(git rev-parse HEAD^{tree})"
OLD_TREE="$(git rev-parse "origin/$DEV_BRANCH^{tree}" 2>/dev/null || echo none)"
if [ "$NEW_TREE" = "$OLD_TREE" ]; then
  echo "dev já está igual a $BASE + [${INCLUDED[*]:-}]; nada a publicar."
else
  git push --quiet --force origin "$DEV_BRANCH"
  echo "dev publicada: $BASE + [${INCLUDED[*]:-}]"
fi
SHA="$(git rev-parse --short HEAD)"
INC_LIST=""; for n in ${INCLUDED[@]+"${INCLUDED[@]}"}; do INC_LIST="$INC_LIST #$n"; done; INC_LIST="${INC_LIST# }"

# Comentário fixo em cada PR com a label (e nos que acabaram de sair dela).
upsert_comment() { # $1 = nº do PR, $2 = corpo
  local id
  id="$(gh api "repos/$REPO/issues/$1/comments" --paginate --jq ".[]|select(.body|contains(\"$TAG\"))|.id" | head -1)"
  if [ -n "$id" ]; then gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$2" >/dev/null
  else gh api -X POST "repos/$REPO/issues/$1/comments" -f body="$2" >/dev/null; fi
}
where="${DEV_URL:+ em **$DEV_URL**}"
for num in ${INCLUDED[@]+"${INCLUDED[@]}"}; do
  upsert_comment "$num" "$TAG
### Homologação
Este PR está na branch \`$DEV_BRANCH\` (commit \`$SHA\`) e sobe no ambiente de homologação$where (PRs na dev: ${INC_LIST:-nenhum}).
Cada push aqui remonta a \`$DEV_BRANCH\`. Para tirar do ambiente, remova a label \`$LABEL\`."
done
for num in ${CONFLICTS[@]+"${CONFLICTS[@]}"}; do
  upsert_comment "$num" "$TAG
### Homologação: ficou de fora
Este PR **conflita** com a \`$BASE\` ou com outro PR em homologação (${INC_LIST:-nenhum}) e **não entrou** na \`$DEV_BRANCH\`.
Atualize a branch com a \`$BASE\` e resolva o conflito; o próximo push tenta de novo."
done

# PR que saiu (fechado ou sem a label) e ainda tem o comentário: avisa que saiu.
if [ -n "${EVENT_PR:-}" ] && [[ ! " ${INCLUDED[*]:-} ${CONFLICTS[*]:-} " =~ " $EVENT_PR " ]]; then
  if gh api "repos/$REPO/issues/$EVENT_PR/comments" --paginate --jq ".[]|select(.body|contains(\"$TAG\"))|.id" | grep -q .; then
    upsert_comment "$EVENT_PR" "$TAG
### Homologação
Este PR **saiu** da branch \`$DEV_BRANCH\` (fechado ou sem a label \`$LABEL\`). A \`$DEV_BRANCH\` foi remontada sem ele."
  fi
fi

{
  echo "### Branch $DEV_BRANCH"
  echo "- Base: \`$BASE\` · commit \`$SHA\`"
  echo "- Incluídos: ${INCLUDED[*]:-nenhum}"
  echo "- Em conflito: ${CONFLICTS[*]:-nenhum}"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
