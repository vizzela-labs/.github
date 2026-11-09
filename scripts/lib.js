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

/** Conteúdo da seção "## Resumo" do corpo do PR, sem comentários HTML. */
function extractSummary(body, max = 4000) {
  const text = stripComments(body).replace(/\r\n/g, '\n');
  const m = /^##[ \t]*Resumo[ \t]*\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im.exec(text);
  const out = (m ? m[1] : '').trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

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
const PREVIEWS = {
  'vzla-panel-hub': (pr) => `https://hub-pr-${pr}.equipevizzela.com.br`,
};
const previewUrl = (repo, prNumber) => (PREVIEWS[repo] ? PREVIEWS[repo](prNumber) : null);

module.exports = {
  TYPES,
  TYPE_LABELS,
  EXTRA_LABELS,
  parseTitle,
  parseParent,
  branchFollowsPattern,
  extractSummary,
  stripComments,
  ensureLabel,
  sleep,
  previewUrl,
};
