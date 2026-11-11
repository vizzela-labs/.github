#!/usr/bin/env bash
# Trunk-based em cima da dev. Dois modos:
#   release  (push na dev):  abre/atualiza o PR de release dev → main listando os PRs incluídos.
#   sync     (push na main): leva a main de volta para a dev por MERGE (nunca reescreve a dev).
#                            Com conflito, abre um PR main → dev para alguém resolver.
# Roda num checkout completo (fetch-depth: 0), com GH_TOKEN com contents:write e pull-requests:write.
set -euo pipefail

MODE="${1:?modo: release | sync}"
REPO="${REPO:?REPO obrigatório}"
TRUNK=dev
PROD=main

git config user.name "vizzela-trunk-bot"
git config user.email "trunk-bot@users.noreply.github.com"
git fetch --quiet origin "+refs/heads/$TRUNK:refs/remotes/origin/$TRUNK" "+refs/heads/$PROD:refs/remotes/origin/$PROD"

summary() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; echo "$1"; }

if [ "$MODE" = "sync" ]; then
  if git merge-base --is-ancestor "origin/$PROD" "origin/$TRUNK"; then
    summary "A $TRUNK já contém a $PROD; nada a sincronizar."
    exit 0
  fi
  git checkout --quiet -B "$TRUNK" "origin/$TRUNK"
  if git merge --no-ff --no-edit -m "chore(release): leva a $PROD de volta para a $TRUNK" "origin/$PROD" >/dev/null 2>&1; then
    git push --quiet origin "$TRUNK"
    summary "$PROD levada para a $TRUNK por merge (commit $(git rev-parse --short HEAD))."
  else
    git merge --abort || true
    existing="$(gh pr list -R "$REPO" --base "$TRUNK" --head "$PROD" --state open --json number --jq '.[0].number // empty')"
    if [ -z "$existing" ]; then
      gh pr create -R "$REPO" --base "$TRUNK" --head "$PROD" \
        --title "chore(release): sincroniza $PROD → $TRUNK (conflito)" \
        --body "A $PROD recebeu mudanças (hotfix ou release) que **conflitam** com a $TRUNK, e a sincronização automática não conseguiu fazer o merge.

Resolva o conflito neste PR (ou localmente: \`git checkout $TRUNK && git merge origin/$PROD\`) e faça o merge **sem squash**, para a $TRUNK ficar com o histórico da $PROD." >/dev/null
      summary "Conflito ao levar a $PROD para a $TRUNK: PR de sincronização aberto."
    else
      summary "Conflito ao levar a $PROD para a $TRUNK: PR #$existing já está aberto."
    fi
  fi
  exit 0
fi

if [ "$MODE" = "release" ]; then
  ahead="$(gh api "repos/$REPO/compare/$PROD...$TRUNK" --jq .ahead_by)"
  existing="$(gh pr list -R "$REPO" --base "$PROD" --head "$TRUNK" --state open --json number --jq '.[0].number // empty')"
  # PRs incluídos: squash "(#N)" ou "Merge pull request #N", ignorando as sincronizações da main.
  nums=()
  while IFS= read -r n; do [ -n "$n" ] && nums+=("$n"); done < <(gh api "repos/$REPO/compare/$PROD...$TRUNK" --paginate --jq '.commits[].commit.message | split("\n")[0]' \
    | grep -v "leva a $PROD de volta" \
    | sed -nE 's/.*\(#([0-9]+)\)[[:space:]]*$/\1/p; s/^Merge pull request #([0-9]+).*/\1/p' | sort -un)
  if [ "$ahead" = "0" ] || [ "${#nums[@]}" -eq 0 ]; then
    summary "Nada novo na $TRUNK para a próxima release."
    exit 0
  fi
  list=""
  for n in "${nums[@]}"; do
    line="$(gh pr view "$n" -R "$REPO" --json title,author,mergedAt --jq '"- #\(.number) \(.title) (@\(.author.login))"' 2>/dev/null || echo "- #$n")"
    list+="$line"$'\n'
  done
  body="## Resumo

Release da sprint: leva para a **$PROD** (produção) tudo o que foi integrado na **$TRUNK** desde a última release.

## PRs incluídos (${#nums[@]})

$list
## Como lançar

1. Confira no ambiente de dev que tudo acima passou no QA.
2. Revise e faça o merge deste PR (**sem squash**, para a $TRUNK e a $PROD manterem o mesmo histórico).
3. O deploy de produção roda sozinho, e as sub-issues destes PRs vão para **Done**.

<sub>PR mantido automaticamente pelo fluxo de tronco (vizzela-labs/.github). Atualizado a cada merge na $TRUNK.</sub>"
  if [ -z "$existing" ]; then
    gh pr create -R "$REPO" --base "$PROD" --head "$TRUNK" --title "chore(release): $TRUNK → $PROD" --body "$body" >/dev/null
    summary "PR de release aberto com ${#nums[@]} PR(s)."
  else
    gh pr edit "$existing" -R "$REPO" --body "$body" >/dev/null
    summary "PR de release #$existing atualizado com ${#nums[@]} PR(s)."
  fi
  exit 0
fi

echo "modo desconhecido: $MODE" >&2
exit 1
