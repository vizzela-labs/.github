// Seção "Fluxo Vizzela" do CLAUDE.md / AGENTS.md de cada repo. Gera o texto entre os marcadores
// <!-- vzla:fluxo --> … <!-- /vzla:fluxo -->; o resto do arquivo é do repo.
// Uso: node scripts/agentes.js <repo>            → imprime a seção
//      require('./agentes.js').upsert(texto, repo) → arquivo com a seção trocada ou anexada
const lib = require('./lib.js');

const BACKS = ['vzla-cashback', 'vzla-tracking', 'vzla-data-hub', 'vizzela-products-backend', 'vzla-gerencial',
  'vzla-marketplaces-api', 'vizzela-sales-dash', 'vzla-zendesk-gateway', 'vzla-lojas-api', 'vizzela-data-adm', 'vz-ra'];
const FRONTS = {
  'vzla-lojas-admin': 'vzla-lojas-api',
  'vzla-lojas-pdv': 'vzla-lojas-api',
  'vizzela-adm-pannel': 'vizzela-products-backend',
  'vzla-panel-hub': 'o back dono da API (vzla-data-hub, vzla-gerencial, vzla-cashback…)',
};
const MONO = {
  'vzla-lojas': { back: 'api', fronts: ['admin', 'pdv'] },
  'vizzela-adm-stores': { back: 'backend', fronts: ['frontend'] },
};

const START = '<!-- vzla:fluxo -->';
const END = '<!-- /vzla:fluxo -->';

function section(repo) {
  const p = lib.PREVIEWS[repo];
  const preview = p ? `o link de \`https://${p.prefix}-pr-<nº>.equipevizzela.com.br\` (sobe sozinho quando o PR para a \`dev\` sai do rascunho)` : 'o link do ambiente de dev (este repo não tem preview por PR)';
  const comum = [
    `- **Branches:** a \`dev\` é o tronco; a \`main\` é produção. Trabalho em \`tipo/<nº>-slug\` saindo da \`dev\`, PR para a \`dev\` (o nº é a issue do \`vzla-backlog\`). Urgência em produção: \`hotfix/<nº>-slug\` saindo da \`main\`.`,
    `- **PR:** título \`tipo(escopo): descrição\`. A seção **Como testar** é obrigatória: ${preview} e os passos, direto.`,
    `- **Antes de entregar:** a \`dev\` vai inteira para produção na release. Nada pela metade visível: esconda atrás de variável de ambiente.`,
    `- **Agente (Claude, Codex…):** nunca mergeia, nunca aprova, nunca marca Done, nunca commita direto na \`dev\` ou na \`main\` e nunca usa \`--force\`. Abre PR e deixa outro dev revisar.`,
  ];
  let especifico;
  if (BACKS.includes(repo)) {
    const oa = lib.OPENAPI_PATHS[repo];
    especifico = [
      `- **Specs ficam aqui**, em \`specs/<nº>-slug/\`: \`requisitos.md\` (EARS: \`QUANDO …, O SISTEMA DEVE …\`) ou \`bugfix.md\` (HOJE / ESPERADO / INALTERADO), \`design.md\`, \`contrato.yaml\` (OpenAPI) e \`tarefas.md\`. Modelo: https://github.com/vizzela-labs/.github/tree/main/specs-modelo`,
      `- **Feature com spec:** leia \`requisitos.md\` e \`contrato.yaml\` antes de codar e implemente exatamente o contrato (paths, campos, tipos, status de erro). Se o contrato precisa mudar, pare: isso é um PR de spec, com 2 aprovações (back e front), não um ajuste no meio do código.`,
      `- **Bugfix com spec:** cada item do INALTERADO vira teste de regressão. ESPERADO com pergunta em aberto: não chute, pergunte para quem pediu.`,
      oa
        ? `- **Contrato × preview:** quando o preview sobe, o CI compara cada \`specs/*/contrato.yaml\` com \`${oa}\` do preview. Mantenha os decorators do \`@nestjs/swagger\` em dia (DTOs com \`@ApiProperty\`, respostas com \`@ApiResponse\`), senão o check acusa diferença.`
        : `- **Contrato:** este repo ainda não publica o OpenAPI do código, então o contrato é conferido só no review. Ao mexer em rota coberta por \`specs/*/contrato.yaml\`, confira campos e status à mão.`,
    ];
  } else if (FRONTS[repo]) {
    especifico = [
      `- **Specs ficam no back** (\`specs/<nº>-slug/\` em ${FRONTS[repo].startsWith('vz') ? `\`${FRONTS[repo]}\`` : FRONTS[repo]}). Leia \`requisitos.md\` e \`contrato.yaml\` de lá antes de codar.`,
      `- **Back ainda não pronto?** Use o mock gerado do contrato, nunca escrito à mão: \`bash <(gh api repos/vizzela-labs/.github/contents/scripts/mock-do-contrato.sh --jq .content | base64 -d) <repo-do-back> <nº-slug>\`. Ele cria \`src/mocks/<nº>-slug/\` (MSW) e os tipos em \`src/api/<nº>-slug.ts\`. Rode com \`VITE_MOCK=true\`.`,
      `- **Use os tipos gerados** (\`src/api/<nº>-slug.ts\`) nas chamadas da API, não interfaces escritas à mão.`,
      `- **PR de integração:** troca o mock pela API de dev e **apaga** \`src/mocks/<nº>-slug/\`. Só o \`src/main.tsx\` pode referenciar \`./mocks\` (pelo \`import.meta.glob\`). Mock chegando na \`main\` deixa o check **Release: sem mock** vermelho.`,
    ];
  } else if (MONO[repo]) {
    const m = MONO[repo];
    especifico = [
      `- **Monorepo:** specs em \`${m.back}/specs/<nº>-slug/\` (modelo: https://github.com/vizzela-labs/.github/tree/main/specs-modelo). Mock do contrato em \`${m.fronts.map((f) => `${f}/src/mocks/<nº>-slug/`).join('` e `')}\`, apagado no PR de integração.`,
      `- **Feature com spec:** implemente exatamente o \`contrato.yaml\`. Se ele precisa mudar, é um PR de spec com 2 aprovações, não um ajuste no meio do código.`,
    ];
  } else {
    throw new Error(`Repo sem classificação (back/front): ${repo}`);
  }
  return [
    START,
    '## Fluxo Vizzela',
    '',
    'Regras da org para qualquer pessoa ou agente que mexa neste repo. Mantido por [vizzela-labs/.github](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md): não edite entre os marcadores, mude lá.',
    '',
    ...comum,
    ...especifico,
    END,
  ].join('\n');
}

/** Troca a seção entre os marcadores, ou anexa no fim. */
function upsert(text, repo) {
  const s = section(repo);
  const t = text || '';
  const a = t.indexOf(START);
  const b = t.indexOf(END);
  if (a >= 0 && b > a) return t.slice(0, a) + s + t.slice(b + END.length);
  return (t.trimEnd() ? t.trimEnd() + '\n\n' : '') + s + '\n';
}

module.exports = { section, upsert, BACKS, FRONTS, MONO, START, END };

if (require.main === module) console.log(section(process.argv[2]));
