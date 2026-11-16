// Benchmark do fim da sprint: abre no vzla-backlog a issue "Benchmark · Sprint DD/MM/AAAA" com os
// números da sprint que acabou e as perguntas da retro. Roda antes de levar os itens abertos para a
// sprint nova (senão eles saem da sprint antiga e somem do relatório). Só números: quem tira
// conclusão é o time.
const lib = require('./lib.js');

const PROJECT_ID = 'PVT_kwDOFBBL-s4BlX7s';
const ORG = 'vizzela-labs';
const BACKLOG = 'vzla-backlog';
const FIRST = '2026-11-15'; // primeira sprint de 15 dias; as semanais anteriores não têm benchmark
const H = 36e5;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtH = (h) => (h === null ? '–' : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1).replace('.', ',')} d`);
const isBotLogin = (l) => !l || /\[bot\]$/.test(l);

/** Classifica um PR mergeado. */
function kind(pr) {
  if (pr.baseRefName === 'main' && pr.headRefName === 'dev') return 'release';
  if (pr.baseRefName === 'main' && /^hotfix\//.test(pr.headRefName)) return 'hotfix';
  if (/^chore\(release\): sincroniza/.test(pr.title)) return 'sync';
  return pr.baseRefName === 'dev' ? 'trabalho' : 'outro';
}

/** Números da sprint. Pura: recebe os itens do projeto e os PRs mergeados (formato do GraphQL). */
function summarize({ items, prs }) {
  const status = {};
  for (const it of items) status[it.status || 'Sem status'] = (status[it.status || 'Sem status'] || 0) + 1;
  const carried = items.filter((it) => it.state === 'OPEN' && it.status !== 'Done').length;

  const byKind = { trabalho: 0, release: 0, hotfix: 0, sync: 0, outro: 0 };
  const lead = [];
  const firstReview = [];
  const semReview = [];
  const vermelho = [];
  const semComoTestar = [];
  const porRepo = {};
  for (const pr of prs) {
    const k = kind(pr);
    byKind[k]++;
    if (k !== 'trabalho' || isBotLogin(pr.author?.login)) continue;
    porRepo[pr.repository.name] = (porRepo[pr.repository.name] || 0) + 1;
    lead.push((Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / H);
    const others = (pr.reviews?.nodes || []).filter((r) => r.author && r.author.login !== pr.author.login && !isBotLogin(r.author.login));
    if (others.length) firstReview.push((Math.min(...others.map((r) => Date.parse(r.submittedAt))) - Date.parse(pr.createdAt)) / H);
    else semReview.push(pr);
    const st = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    if (st === 'FAILURE' || st === 'ERROR') vermelho.push(pr);
    if (!lib.extractSection(pr.body, 'Como testar')) semComoTestar.push(pr);
  }
  return {
    status, carried, byKind, porRepo,
    leadMedianH: median(lead), firstReviewMedianH: median(firstReview),
    semReview, vermelho, semComoTestar,
  };
}

const ref = (pr) => `${pr.repository.name}#${pr.number}`;
const list = (prs) => (prs.length ? prs.slice(0, 15).map(ref).join(', ') + (prs.length > 15 ? '…' : '') : '–');

function render(sprint, end, s) {
  const order = ['Done', 'Em produção', 'QA', 'In review', 'In progress', 'Todo', 'Spec', 'Triagem', 'Backlog', 'Sem status'];
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : 99);
  const statusRows = Object.entries(s.status)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  const repoRows = Object.entries(s.porRepo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n') || '| – | 0 |';
  return `<!-- vzla:benchmark -->
Sprint de ${sprint.startDate.split('-').reverse().join('/')} a ${end.split('-').reverse().join('/')}. Números tirados do board e dos PRs mergeados; a conclusão é do time.

## Board

| Status no fim da sprint | Itens |
|---|---|
${statusRows}

**${s.carried}** item(ns) abertos foram para a sprint seguinte.

## Entregas

| | PRs |
|---|---|
| Trabalho mergeado na dev | ${s.byKind.trabalho} |
| Releases (dev → main) | ${s.byKind.release} |
| Hotfixes | ${s.byKind.hotfix} |

| Repo | PRs na dev |
|---|---|
${repoRows}

## Fluxo

| Medida | Valor |
|---|---|
| Tempo mediano do PR aberto ao merge | ${fmtH(s.leadMedianH)} |
| Tempo mediano até o primeiro review humano | ${fmtH(s.firstReviewMedianH)} |
| Mergeados sem review de outro dev | ${s.semReview.length} · ${list(s.semReview)} |
| Mergeados com check vermelho | ${s.vermelho.length} · ${list(s.vermelho)} |
| Mergeados sem "Como testar" | ${s.semComoTestar.length} · ${list(s.semComoTestar)} |

## Retro

Cada dev responde num comentário:

1. **O que funcionou** e vale repetir?
2. **O que travou?** (espera de review, back e front fora de sincronia, ambiente, spec que mudou no meio…)
3. **Uma coisa para mudar** na próxima sprint. Se virar regra, entra no [fluxo](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md).

<sub>Gerado pela automação da sprint (vizzela-labs/.github, scripts/benchmark.js).</sub>`;
}

async function projectItems(github, iterationId) {
  const out = [];
  let after = null;
  do {
    const { node } = await github.graphql(
      `query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor}
        nodes{content{... on Issue{state} ... on PullRequest{state}}
        it:fieldValueByName(name:"Iteration"){... on ProjectV2ItemFieldIterationValue{iterationId}}
        st:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`,
      { p: PROJECT_ID, after },
    );
    for (const it of node.items.nodes) {
      if (it.it?.iterationId === iterationId) out.push({ status: it.st?.name || null, state: it.content?.state || 'OPEN' });
    }
    after = node.items.pageInfo.hasNextPage ? node.items.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function mergedPRs(github, from, to) {
  const out = [];
  let after = null;
  do {
    const { search } = await github.graphql(
      `query($q:String!,$after:String){search(type:ISSUE,query:$q,first:50,after:$after){pageInfo{hasNextPage endCursor}
        nodes{... on PullRequest{number title body createdAt mergedAt baseRefName headRefName repository{name} author{login}
          reviews(first:30){nodes{author{login} submittedAt}}
          commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`,
      { q: `org:${ORG} is:pr is:merged merged:${from}..${to}`, after },
    );
    out.push(...search.nodes.filter((n) => n.number));
    after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** Abre o benchmark da última sprint encerrada, se ainda não existir. */
async function benchmark({ github, core, dryRun, iterations, today, addDays }) {
  const done = iterations.filter((it) => it.startDate >= FIRST && addDays(it.startDate, it.duration) <= today);
  const sprint = done[done.length - 1];
  if (!sprint) return core.info('Benchmark: nenhuma sprint de 15 dias encerrada ainda.');
  const title = `Benchmark · ${sprint.title}`;
  const { data: found } = await github.rest.search.issuesAndPullRequests({
    q: `repo:${ORG}/${BACKLOG} is:issue in:title "${title}"`,
  });
  if (found.items.some((i) => i.title === title)) return core.info(`Benchmark já existe: ${title}`);

  const end = addDays(sprint.startDate, sprint.duration - 1);
  const [items, prs] = await Promise.all([projectItems(github, sprint.id), mergedPRs(github, sprint.startDate, end)]);
  const body = render(sprint, end, summarize({ items, prs }));
  if (dryRun) return core.info(`DRY RUN, abriria "${title}":\n${body}`);
  await lib.ensureLabel(github, ORG, BACKLOG, 'benchmark');
  const { data: issue } = await github.rest.issues.create({ owner: ORG, repo: BACKLOG, title, body, labels: ['benchmark'] });
  core.info(`Benchmark aberto: ${issue.html_url}`);
}

module.exports = { benchmark, summarize, render, kind, median, projectItems, mergedPRs };
