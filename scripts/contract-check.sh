#!/usr/bin/env bash
# Contrato × preview: cada specs/*/contrato.yaml do repo contra o OpenAPI que o preview publica.
# Uso: contract-check.sh <url-do-openapi-do-preview>. Roda na raiz do checkout do PR, com o oasdiff no PATH.
# Só compara endpoints que existem nos dois lados (remoção de endpoint vira nível none): endpoint do contrato
# ainda não implementado não é erro, aparece na contagem. Escreve o resumo em $RESUMO (markdown).
set -uo pipefail
IMPL_URL="$1"
RESUMO="${RESUMO:-resumo.md}"
CONTRATOS=()
while IFS= read -r f; do CONTRATOS+=("$f"); done < <(git ls-files | grep -E '(^|/)specs/[^/_][^/]*/contrato\.ya?ml$' | sort)
if [ ${#CONTRATOS[@]} -eq 0 ]; then echo "Nenhum contrato em specs/." > "$RESUMO"; echo "status=neutral" >> "$GITHUB_OUTPUT"; exit 0; fi

if ! curl -fsS --max-time 30 "$IMPL_URL" -o impl.json || ! grep -q '"openapi"' impl.json; then
  echo "Não consegui ler o OpenAPI do preview em $IMPL_URL." > "$RESUMO"; echo "status=neutral" >> "$GITHUB_OUTPUT"; exit 0
fi

status=success
VAZIO="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vazio.yaml"
printf 'openapi: 3.0.0\ninfo: {title: vazio, version: "0"}\npaths: {}\n' > "$VAZIO"
# Endpoint do contrato que o preview ainda não tem não é quebra: aparece só na contagem.
NIVEIS="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/niveis.txt"
printf 'api-path-removed-without-deprecation none\napi-removed-without-deprecation none\napi-path-removed-before-sunset none\napi-removed-before-sunset none\n' > "$NIVEIS"
{
  echo "OpenAPI do preview: $IMPL_URL"
  echo
  echo "| Contrato | Endpoints implementados | Quebras |"
  echo "|---|---|---|"
} > "$RESUMO"
detalhes=""
for c in "${CONTRATOS[@]}"; do
  total=$(oasdiff summary "$VAZIO" "$c" --format json 2>/dev/null | jq -r '.details.endpoints.added // 0')
  faltam=$(oasdiff summary "$c" impl.json --format json 2>/dev/null | jq -r '.details.endpoints.deleted // 0')
  n=$(oasdiff breaking "$c" impl.json --severity-levels "$NIVEIS" --format json 2>/dev/null | jq '[.[]? | select(.level == 3)] | length' 2>/dev/null || echo 0)
  out=$(oasdiff breaking "$c" impl.json --severity-levels "$NIVEIS" --fail-on ERR --format text --color never 2>&1); rc=$?
  if [ $rc -ne 0 ]; then status=failure; fi
  echo "| \`$c\` | $((total - faltam)) de $total | $([ $rc -ne 0 ] && echo "🔴 $n" || echo "✅ 0") |" >> "$RESUMO"
  [ $rc -ne 0 ] && detalhes+=$'\n'"### \`$c\`"$'\n\n```\n'"$(printf '%s\n' "$out" | head -60)"$'\n```\n'
done
if [ -n "$detalhes" ]; then
  printf '\n## O que o preview não cumpre\n%s\nOu o código está errado, ou o contrato mudou: nesse caso, atualize o contrato.yaml num PR de spec (1 aprovação).\n' "$detalhes" >> "$RESUMO"
fi
echo "status=$status" >> "$GITHUB_OUTPUT"
