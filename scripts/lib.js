// Regras compartilhadas pelos workflows "PR padrão" da vizzela-labs.

const TYPES = {
  feat: { label: 'feature', color: '1d76db', description: 'Funcionalidade nova' },
  fix: { label: 'bug', color: 'd73a4a', description: 'Correção de bug' },
  refactor: { label: 'refactor', color: 'c5def5', description: 'Mudança interna sem alterar comportamento' },
  perf: { label: 'performance', color: 'fbca04', description: 'Performance' },
  docs: { label: 'documentation', color: '0075ca', description: 'Documentação' },
  test: { label: 'test', color: 'bfd4f2', description: 'Testes' },
  chore: { label: 'chore', color: 'ededed', description: 'Build, dependências, configuração' },
  ci: { label: 'ci', color: '5319e7', description: 'Pipelines / Actions' },
};

const EXTRA_LABELS = {
  breaking: { color: 'b60205', description: 'Breaking change' },
  'pr-auto': { color: '0e8a16', description: 'Sub-issue gerada automaticamente a partir de um PR' },
  'sem-issue-mae': { color: 'e99695', description: 'PR sem issue-mãe informada' },
  'no-issue': { color: 'cccccc', description: 'Não gerar sub-issue para este PR' },
  benchmark: { color: '5319e7', description: 'Benchmark e retro do fim da sprint' },
};

const TYPE_LABELS = Object.values(TYPES).map((t) => t.label);

const TITLE_RE = /^([a-z]+)\(([^()]+)\)(!)?: +(\S.*)$/;

/** "feat(pdv)!: algo" → { type, scope, breaking, subject } | null */
function parseTitle(title) {
  const m = TITLE_RE.exec((title || '').trim());
  if (!m || !TYPES[m[1]] || !m[2].trim()) return null;
  return { type: m[1], scope: m[2].trim(), breaking: Boolean(m[3]), subject: m[4].trim() };
}

function stripComments(text) {
  return (text || '').replace(/<!--[\s\S]*?-->/g, '');
}

const BODY_PARENT_RE =
  /Issue-m[aã]e:[ \t]*(?:(?:https:\/\/github\.com\/)?vizzela-labs\/)?(?:vzla-backlog)?(?:#|\/issues\/)?(\d+)\b/i;
const BRANCH_RE = /^[a-z]+\/(\d+)(?:[-_.]|$)/i;

/** Issue-mãe do PR: corpo ("Issue-mãe: vzla-backlog#42") tem prioridade sobre a branch ("feat/42-x"). */
function parseParent(body, branch) {
  const b = BODY_PARENT_RE.exec(stripComments(body));
  if (b) return { number: Number(b[1]), source: 'corpo do PR' };
  const r = BRANCH_RE.exec(branch || '');
  if (r) return { number: Number(r[1]), source: 'branch' };
  return null;
}

function branchFollowsPattern(branch) {
  return /^(feat|fix|refactor|perf|docs|test|chore|ci)\/\d+-[a-z0-9][a-z0-9._-]*$/i.test(branch || '');
}

/** Conteúdo da seção "## <título>" do corpo do PR, sem comentários HTML. */
function extractSection(body, title, max = 4000) {
  const text = stripComments(body).replace(/\r\n/g, '\n');
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^##[ \\t]*${esc}[ \\t]*\\n([\\s\\S]*?)(?=^##[ \\t]|(?![\\s\\S]))`, 'im').exec(text);
  const out = (m ? m[1] : '').trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Conteúdo da seção "## Resumo" do corpo do PR, sem comentários HTML. */
function extractSummary(body, max = 4000) {
  return extractSection(body, 'Resumo', max);
}

// Devs sorteados para review e QA. Sem cargos: qualquer um deles, menos o autor.
const DEVS = require('./devs.json').devs;

/** Sorteia um login de `pool` que não esteja em `exclude` (comparação sem caixa). */
function pickRandom(pool, exclude = [], rnd = Math.random) {
  const out = new Set(exclude.filter(Boolean).map((l) => l.toLowerCase()));
  const options = pool.filter((l) => !out.has(l.toLowerCase()));
  return options.length ? options[Math.floor(rnd() * options.length)] : null;
}

/** Arquivos de mock do front (MSW), que não podem chegar na main. */
const isMockPath = (p) => /(^|\/)src\/mocks\//.test(p);
/** Arquivos de spec (requisitos, design, contrato, tarefas). */
const isSpecPath = (p) => /(^|\/)specs\//.test(p);

async function ensureLabel(github, owner, repo, name) {
  const def = TYPES[Object.keys(TYPES).find((k) => TYPES[k].label === name)] || EXTRA_LABELS[name] ||
    (name.startsWith('repo:') ? { color: 'f9d0c4', description: 'Repositório de origem do PR' } : { color: 'ededed', description: '' });
  try {
    await github.rest.issues.createLabel({ owner, repo, name, color: def.color, description: def.description });
  } catch (e) {
    if (e.status !== 422) throw e; // 422 = já existe
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Repos com Preview Deployments ligado no Coolify → URL do preview de um PR.
// Um nível só de subdomínio: o certificado da Cloudflare cobre *.equipevizzela.com.br,
// não *.hub.equipevizzela.com.br. Tem que bater com o "Preview URL template" do app no Coolify.
// O Coolify só sobe preview de PR cuja base é a branch do app: os apps "-dev" (base dev).
// O panel-hub também tem preview no app de produção (base main).
const PREVIEWS = {
  'vzla-panel-hub': { prefix: 'hub', bases: ['dev', 'main'] },
  'vizzela-adm-pannel': { prefix: 'painel-dev', bases: ['dev'] },
  'vzla-cashback': { prefix: 'cashback-dev', bases: ['dev'] },
  'vzla-tracking': { prefix: 'tracking-dev', bases: ['dev'] },
  'vzla-gerencial': { prefix: 'gerencial-dev', bases: ['dev'] },
  'vzla-marketplaces-api': { prefix: 'marketplaces-dev', bases: ['dev'] },
  'vizzela-products-backend': { prefix: 'products-backend-dev', bases: ['dev'] },
  'vzla-data-hub': { prefix: 'data-hub-dev', bases: ['dev'] },
  'vzla-lojas-admin': { prefix: 'lojas-dev', bases: ['dev'] },
  'vzla-lojas-api': { prefix: 'api-lojas-dev', bases: ['dev'] },
  'vzla-zendesk-gateway': { prefix: 'zendesk-gateway-dev', bases: ['dev'] },
  'vizzela-data-adm': { prefix: 'etl-observador-dev', bases: ['dev'] },
};
// Onde cada back publica o OpenAPI gerado do código (@nestjs/swagger). Usado pelo check
// "Contrato × preview", que compara specs/*/contrato.yaml com o que o preview responde.
const OPENAPI_PATHS = {
  'vzla-cashback': '/docs-json',
  'vzla-tracking': '/docs-json',
  'vzla-gerencial': '/docs-json',
  'vzla-marketplaces-api': '/docs-json',
  'vizzela-products-backend': '/api/docs-json',
  'vzla-zendesk-gateway': '/docs-json',
};
/** URL do preview anunciada no comentário do Coolify, se o deploy terminou bem. */
function parseCoolifyReady(body) {
  if (!/preview deployment .* is ready/i.test(body || '')) return null;
  const m = /\[Open Preview\]\((https:\/\/[^)\s]+)\)/.exec(body);
  return m ? m[1].replace(/\/$/, '') : null;
}
/** PR de spec (passo 03): só mexe em specs/. Sem arquivos (lista vazia) não conta. */
const isSpecOnly = (paths) => paths.length > 0 && paths.every(isSpecPath);

/** Labels de caminho que levam a issue-mãe para a coluna Spec. */
const SPEC_PATH_LABELS = ['quick-spec', 'spec', 'bugfix-spec'];

/**
 * Coluna da issue-mãe enquanto um PR dela está aberto: PR de spec deixa a mãe em Spec (a
 * aprovação do contrato vem antes do código); PR de código com preview no ar = QA (vez de
 * quem pediu testar); senão, In progress.
 */
function parentStatusKey({ specOnly, preview }) {
  if (specOnly) return 'spec';
  return preview ? 'qa' : 'inProgress';
}

/**
 * Fase da issue no board a partir de um evento do vzla-backlog. Atribuir alguém a uma issue
 * ainda em Backlog (ou sem status) = Triagem (passo 02); label de caminho com spec = Spec
 * (passo 03). Qualquer outro evento não mexe na coluna (null).
 */
function issuePhaseKey({ action, label, currentStatus }) {
  if (action === 'assigned' && (!currentStatus || currentStatus === 'Backlog')) return 'triagem';
  if (action === 'labeled' && SPEC_PATH_LABELS.includes(label)) {
    // Não volta uma issue que já passou da spec (Todo em diante).
    if (!currentStatus || ['Backlog', 'Triagem'].includes(currentStatus)) return 'spec';
  }
  return null;
}

const previewUrl = (repo, prNumber, base = 'dev') => {
  const p = PREVIEWS[repo];
  return p && p.bases.includes(base) ? `https://${p.prefix}-pr-${prNumber}.equipevizzela.com.br` : null;
};

module.exports = {
  isSpecOnly,
  SPEC_PATH_LABELS,
  parentStatusKey,
  issuePhaseKey,
  TYPES,
  TYPE_LABELS,
  EXTRA_LABELS,
  parseTitle,
  parseParent,
  branchFollowsPattern,
  extractSummary,
  extractSection,
  DEVS,
  pickRandom,
  isMockPath,
  isSpecPath,
  stripComments,
  ensureLabel,
  sleep,
  previewUrl,
  PREVIEWS,
  OPENAPI_PATHS,
  parseCoolifyReady,
};
