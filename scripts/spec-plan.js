// Plano de execução de uma spec: a tabela "## Branches" do tarefas.md.
//   PR de spec gerado da triagem → revisores = donos da tabela (reusable-spec-draft.yml)
//   spec mergeada na dev         → cria cada branch a partir da dev e comenta o prompt na issue (pr-sync.js)
// As funções puras são testadas em test.js.
const lib = require('./lib.js');
const { section } = require('./spec-lint.js');

const HUB = { owner: 'vizzela-labs', repo: 'vzla-backlog' };
const ORG = 'vizzela-labs';
const TRUNK = 'dev';
const COMMENT_TAG = '<!-- vzla:spec-branches';

/** "Cashback: APIs do painel e do PDV" → "cashback-apis-do-painel-e-do-pdv" (até `max` caracteres, sem cortar palavra). */
function slugify(title, max = 40) {
  const s = (title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s || 'spec';
  const cut = s.slice(0, max + 1);
  const i = cut.lastIndexOf('-');
  return (i > 10 ? cut.slice(0, i) : s.slice(0, max)).replace(/-+$/, '');
}

/** Repo do back onde a spec mora, a partir das labels `repo:<nome>` da issue. Só backs contam. */
function backRepoFromLabels(labels) {
  const names = (labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
  const repos = names.filter((n) => n.startsWith('repo:')).map((n) => n.slice(5).trim());
  const backs = repos.filter((r) => lib.BACK_REPOS.includes(r));
  return backs.length === 1 ? backs[0] : null;
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cell = (s) => (s || '').replace(/`/g, '').replace(/\*\*/g, '').trim();
const EMPTY = /^(?:|-|—|–|n\/a)$/i;

/**
 * Linhas da tabela "## Branches" do tarefas.md:
 * | Onda | Repo | Branch | Issue | Dono | Requisitos |
 * Retorna { rows, errors }. Linha sem branch ("—") é só informativa (ex.: onda de integração).
 */
function parseBranches(md) {
  const body = section(md, 'Branches');
  if (body === null) return { rows: [], errors: ['tarefas.md sem a seção "## Branches" (repo, branch e dono de cada PR)'] };
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2) return { rows: [], errors: ['tarefas.md: a seção "## Branches" não tem tabela'] };
  const split = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell);
  const head = split(lines[0]).map(norm);
  const col = (name) => head.indexOf(name);
  const errors = [];
  for (const need of ['repo', 'branch']) {
    if (col(need) < 0) errors.push(`tarefas.md: a tabela de "## Branches" não tem a coluna "${need}"`);
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (const l of lines.slice(1)) {
    if (/^\|?\s*:?-{3,}/.test(l)) continue; // separador
    const c = split(l);
    const get = (name) => (col(name) >= 0 ? c[col(name)] || '' : '');
    const repo = get('repo').replace(/^vizzela-labs\//, '');
    const branch = get('branch');
    if (EMPTY.test(branch)) continue;
    const issueMatch = /#(\d+)/.exec(get('issue'));
    const row = {
      onda: get('onda'),
      repo,
      branch,
      issue: issueMatch ? Number(issueMatch[1]) : null,
      dono: (/@?([A-Za-z0-9-]+)/.exec(get('dono')) || [])[1] || null,
      requisitos: get('requisitos'),
    };
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) {
      errors.push(`tarefas.md: branch "${branch}" com repo inválido "${get('repo')}" (um repo por linha, ex.: vzla-panel-hub)`);
      continue;
    }
    if (!lib.branchFollowsPattern(branch)) {
      errors.push(`tarefas.md: branch "${branch}" fora do padrão tipo/<nº>-slug`);
      continue;
    }
    rows.push(row);
  }
  if (!rows.length && !errors.length) errors.push('tarefas.md: a tabela de "## Branches" não tem nenhuma branch');
  return { rows, errors };
}

/** Logins dos donos da tabela (para pedir review do PR de spec). */
const owners = (rows) => [...new Set(rows.map((r) => r.dono).filter(Boolean))];

/** Prompt que o dev cola no Claude dele para executar uma linha da tabela. */
function promptFor({ back, dir, row }) {
  const files = `specs/${dir.replace(/^.*specs\//, '')}`;
  return [
    `Siga a spec ${files}/ do vizzela-labs/${back} (branch dev), linha "${row.branch}" da tabela Branches do tarefas.md.`,
    `Leia requisitos.md (ou bugfix.md), design.md, contrato.yaml e tarefas.md antes de codar` +
      (row.repo === back ? '.' : ` (gh api "repos/vizzela-labs/${back}/contents/${files}/<arquivo>?ref=dev" --jq .content | base64 -d).`),
    `Faça só as tarefas desta linha (${row.requisitos || 'requisitos da linha'}), implementando exatamente o contrato. Se o contrato precisar mudar, pare e me avise: isso é um PR de spec.`,
    `Trabalhe na branch ${row.branch}, já criada a partir da dev. Abra o PR para a dev como rascunho, com "Issue-mãe: vzla-backlog#${row.issue || '<nº>'}" no corpo e o Como testar preenchido.`,
  ].join('\n');
}

/**
 * Spec mergeada na dev: cria as branches da tabela e comenta, na issue-mãe e nas issues de cada
 * linha, a branch e o prompt. Branch que já existe fica como está. Sem permissão de escrita no
 * repo (App sem contents:write), avisa e manda criar à mão.
 */
async function onSpecMerged({ github, core, owner, repo, pr, parentNumber }) {
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
  const { specDirs } = require('./spec-lint.js');
  const dirs = specDirs(files.filter((f) => f.status !== 'removed').map((f) => f.filename));
  for (const dir of dirs) {
    let md;
    try {
      const { data } = await github.rest.repos.getContent({ owner, repo, path: `${dir}/tarefas.md`, ref: pr.merge_commit_sha || TRUNK });
      md = Buffer.from(data.content, 'base64').toString('utf8');
    } catch (e) {
      core.info(`${dir}: sem tarefas.md (${e.status || e.message}). Nenhuma branch criada.`);
      continue;
    }
    const { rows, errors } = parseBranches(md);
    for (const err of errors) core.warning(`${dir}: ${err}`);
    if (!rows.length) continue;

    const results = [];
    for (const row of rows) results.push({ row, status: await createBranch(github, core, row) });
    await announce({ github, core, back: repo, dir, results, parentNumber, prRef: `${owner}/${repo}#${pr.number}` });
  }
}

async function createBranch(github, core, row) {
  try {
    await github.rest.repos.getBranch({ owner: ORG, repo: row.repo, branch: row.branch });
    return 'já existia';
  } catch (e) {
    if (e.status !== 404) return `erro ao conferir: ${e.message}`;
  }
  try {
    const { data: base } = await github.rest.repos.getBranch({ owner: ORG, repo: row.repo, branch: TRUNK });
    await github.rest.git.createRef({ owner: ORG, repo: row.repo, ref: `refs/heads/${row.branch}`, sha: base.commit.sha });
    core.info(`Branch criada: ${row.repo}@${row.branch}`);
    return 'criada';
  } catch (e) {
    core.warning(`Não consegui criar ${row.repo}@${row.branch}: ${e.message}`);
    return e.status === 403 || e.status === 404 ? 'sem permissão: crie você' : `erro: ${e.message}`;
  }
}

async function announce({ github, core, back, dir, results, parentNumber, prRef }) {
  const tag = `${COMMENT_TAG}: ${back}/${dir} -->`;
  const table = [
    '| Onda | Repo | Branch | Dono | Requisitos | Situação |',
    '|---|---|---|---|---|---|',
    ...results.map(({ row, status }) =>
      `| ${row.onda || ''} | ${row.repo} | \`${row.branch}\` | ${row.dono ? `@${row.dono}` : ''} | ${row.requisitos} | ${status} |`),
  ];
  const targets = new Set([parentNumber, ...results.map((r) => r.row.issue)].filter(Boolean));
  for (const number of targets) {
    const mine = results.filter((r) => r.row.issue === number);
    const list = mine.length ? mine : number === parentNumber ? results : [];
    const prompts = list.map(({ row }) => [
      `**${row.repo} · \`${row.branch}\`**${row.dono ? ` (@${row.dono})` : ''}`,
      '```text',
      promptFor({ back, dir, row }),
      '```',
      `Sem a branch? \`git fetch origin && git switch -c ${row.branch} origin/${TRUNK}\``,
    ].join('\n'));
    const body = [
      tag,
      '### 🌿 Spec aprovada: branches para começar',
      `A spec \`${dir}\` entrou na \`dev\` do ${back} (${prRef}). Cada linha da tabela **Branches** do \`tarefas.md\` virou uma branch saindo da \`dev\`:`,
      '',
      ...table,
      '',
      '**Para executar:** faça checkout da sua branch e cole o prompt da sua linha no Claude Code. O PR para a `dev` sai como rascunho; saindo do rascunho, sobe o preview.',
      '',
      ...prompts,
      '',
      '<sub>Comentário automático do PR padrão. [Convenções](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md)</sub>',
    ].join('\n');
    try {
      const comments = await github.paginate(github.rest.issues.listComments, { ...HUB, issue_number: number, per_page: 100 });
      const prev = comments.find((c) => c.body?.includes(tag));
      if (prev) await github.rest.issues.updateComment({ ...HUB, comment_id: prev.id, body });
      else await github.rest.issues.createComment({ ...HUB, issue_number: number, body });
    } catch (e) {
      core.warning(`Não consegui comentar as branches em vzla-backlog#${number}: ${e.message}`);
    }
  }
}

module.exports = { slugify, backRepoFromLabels, parseBranches, owners, promptFor, onSpecMerged };
