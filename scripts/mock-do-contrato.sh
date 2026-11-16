#!/usr/bin/env bash
# Gera, num front (React + Vite), os tipos e o mock MSW de uma spec que mora no back.
# Rode na raiz do front:
#   bash <(gh api repos/vizzela-labs/.github/contents/scripts/mock-do-contrato.sh --jq .content | base64 -d) \
#     vzla-cashback 42-cashback-extrato [--ref feat/42-spec]
#
# Cria (ou atualiza):
#   src/mocks/<spec>/contrato.json   cópia do contrato    → apagado no PR de integração
#   src/mocks/<spec>/handlers.ts     handlers do MSW      → apagado no PR de integração
#   src/api/<spec>.ts                tipos TypeScript     → fica (o código usa)
# Contrato ainda local (PR da spec não subiu)? CONTRATO_ARQUIVO=../back/specs/42-x/contrato.yaml
# Na primeira vez, instala msw@2 e @mswjs/source e cria public/mockServiceWorker.js.
set -euo pipefail

BACK="${1:?uso: mock-do-contrato.sh <repo-do-back> <nº-slug> [--ref <branch>]}"
SPEC="${2:?informe a pasta da spec, ex.: 42-cashback-extrato}"
REF=dev
if [[ "${3:-}" == "--ref" ]]; then REF="${4:?--ref sem branch}"; fi
ORG=vizzela-labs
MSW_SOURCE=0.5.0
OPENAPI_TS=7.13.0

[[ -f package.json ]] || { echo "Rode na raiz do front (sem package.json aqui)." >&2; exit 1; }
[[ "$SPEC" =~ ^[0-9]+-[a-z0-9-]+$ ]] || { echo "A spec deve ser <nº>-slug, ex.: 42-cashback-extrato" >&2; exit 1; }

caminho=""
if [[ -n "${CONTRATO_ARQUIVO:-}" ]]; then caminho="$(basename "$CONTRATO_ARQUIVO") (arquivo local)"; fi  # contrato ainda não publicado
for c in "specs/$SPEC/contrato.yaml" "specs/$SPEC/contrato.yml"; do
  [[ -n "${CONTRATO_ARQUIVO:-}" ]] && break
  if gh api "repos/$ORG/$BACK/contents/$c?ref=$REF" --jq .sha >/dev/null 2>&1; then caminho=$c; break; fi
done
[[ -n "$caminho" ]] || [[ -n "${CONTRATO_ARQUIVO:-}" ]] || { echo "Não achei specs/$SPEC/contrato.yaml em $ORG/$BACK@$REF." >&2; exit 1; }

dir="src/mocks/$SPEC"
mkdir -p "$dir" src/api
tmp=$(mktemp -d)
if [[ -n "${CONTRATO_ARQUIVO:-}" ]]; then cp "$CONTRATO_ARQUIVO" "$tmp/contrato.yaml"
else gh api "repos/$ORG/$BACK/contents/$caminho?ref=$REF" --jq .content | base64 -d > "$tmp/contrato.yaml"; fi
npx --yes js-yaml "$tmp/contrato.yaml" > "$dir/contrato.json"
npx --yes "openapi-typescript@$OPENAPI_TS" "$tmp/contrato.yaml" -o "src/api/$SPEC.ts" >/dev/null
sed -i.bak "1i\\
// Gerado de $ORG/$BACK:$caminho ($REF) por vizzela-labs/.github/scripts/mock-do-contrato.sh. Não edite: gere de novo.
" "src/api/$SPEC.ts" && rm -f "src/api/$SPEC.ts.bak"
rm -rf "$tmp"

cat > "$dir/handlers.ts" <<EOF
// Mock da spec $SPEC, gerado de $ORG/$BACK:$caminho ($REF).
// As respostas vêm dos \`examples\` do contrato. Para um caso específico, coloque um handler
// próprio ANTES dos gerados: export const handlers = [http.get(...), ...gerados]
// Esta pasta é apagada no PR de integração (o check "Release: sem mock" acusa se chegar na main).
import { fromOpenApi } from '@mswjs/source/open-api'
import contrato from './contrato.json'

// Responde no host que o front já chama. Sem VITE_MOCK_API_URL, usa o servers do contrato.
const base = import.meta.env.VITE_MOCK_API_URL as string | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doc = (base ? { ...contrato, servers: [{ url: base }] } : contrato) as any

export const handlers = await fromOpenApi(doc)
EOF

if ! node -e "const p=require('./package.json');process.exit((p.devDependencies||{})['@mswjs/source']||(p.dependencies||{})['@mswjs/source']?0:1)"; then
  echo "Primeira vez neste front: instalando msw@2 e @mswjs/source@${MSW_SOURCE}…"
  npm install -D "msw@^2.10.0" "@mswjs/source@$MSW_SOURCE"
  npx msw init public --save
fi

echo
echo "Pronto:"
echo "  $dir/contrato.json"
echo "  $dir/handlers.ts"
echo "  src/api/$SPEC.ts"
if ! grep -rqs "mocks/\*/handlers" src/main.tsx src/main.ts src/index.tsx 2>/dev/null; then
  cat <<'EOF'

Falta ligar o MSW (uma vez por front). No topo do src/main.tsx, antes do render:

  if (import.meta.env.VITE_MOCK === 'true') {
    const { setupWorker } = await import('msw/browser')
    const mods = import.meta.glob<{ handlers: never[] }>('./mocks/*/handlers.ts')
    const handlers = (await Promise.all(Object.values(mods).map((m) => m()))).flatMap((m) => m.handlers)
    await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass' })
  }

Esse trecho fica para sempre (fora de src/mocks/) e não faz nada sem VITE_MOCK=true ou sem pasta de mock.
EOF
fi
echo
echo "Rode com: VITE_MOCK=true VITE_MOCK_API_URL=<host que o front chama> npm run dev"
