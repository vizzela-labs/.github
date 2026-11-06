// Mantém uma sub-issue no vzla-backlog espelhando o ciclo de vida de um PR.
// Roda com o token do GitHub App vizzela-labs (issues:write, organization_projects:write).
const lib = require('./lib.js');

const HUB = { owner: 'vizzela-labs', repo: 'vzla-backlog' };
const PROJECT = {
  id: 'PVT_kwDOFBBL-s4BlX7s',
  statusField: 'PVTSSF_lADOFBBL-s4BlX7szhkFDoI',
  inProgress: '47fc9ee4',
  done: '98236657',
};
const STATUS_NAME = { [PROJECT.inProgress]: 'In progress', [PROJECT.done]: 'Done' };
const COMMENT_TAG = '<!-- vzla-sub-issue';

module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const action = context.payload.action;
  const { owner, repo } = context.repo;
  const prRef = `${owner}/${repo}#${pr.number}`;
  const marker = `<!-- vzla-pr: ${prRef} -->`;
  const hubRef = (n) => `${HUB.owner}/${HUB.repo}#${n}`;

  if (pr.labels.some((l) => l.name === 'no-issue')) {
    core.info('PR com label no-issue: nada a fazer.');
    return;
  }

  // ---------- helpers ----------
  async function findStickyComment() {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: pr.number, per_page: 100,
    });
    return comments.find((c) => c.user?.type === 'Bot' && c.body?.includes(COMMENT_TAG)) || null;
  }

  async function getHubIssue(number) {
    try {
      const { data } = await github.rest.issues.get({ ...HUB, issue_number: number });
      return data;
    } catch (e) {
      if (e.status === 404 || e.status === 410) return null;
      throw e;
    }
  }

  async function findSubIssue(comment) {
    const m = comment && /vzla-sub-issue:\s*(\d+)/.exec(comment.body);
    if (m) {
      const issue = await getHubIssue(Number(m[1]));
      if (issue && issue.body?.includes(marker)) return issue;
    }
    // Fallback (comentário apagado): busca pelo PR no corpo das issues do hub.
    try {
      const { data } = await github.request('GET /search/issues', {
        q: `"${prRef}" repo:${HUB.owner}/${HUB.repo} is:issue label:pr-auto`,
        per_page: 10,
      });
      const hit = data.items.find((i) => i.body?.includes(marker));
      if (hit) return getHubIssue(hit.number);
    } catch (e) {
      core.warning(`Busca de fallback falhou: ${e.message}`);
    }
    return null;
  }

  async function setStatus(contentId, optionId) {
    const add = await github.graphql(
      `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
      { p: PROJECT.id, c: contentId },
    );
    const itemId = add.addProjectV2ItemById.item.id;
    // As automações nativas do projeto ("Item added to project" etc.) podem sobrescrever o
    // Status logo depois; por isso grava, confere e regrava.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await github.graphql(
        `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}`,
        { p: PROJECT.id, i: itemId, f: PROJECT.statusField, o: optionId },
      );
      await lib.sleep(5000);
      const cur = await github.graphql(
        `query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}}}}`,
        { id: itemId },
      );
      if (cur.node?.fieldValueByName?.optionId === optionId) {
        core.info(`Status no projeto: ${STATUS_NAME[optionId]}`);
        return;
      }
    }
    core.warning(`Status no projeto não ficou em ${STATUS_NAME[optionId]} após 3 tentativas.`);
  }

  async function currentParentNumber(issueNumber) {
    try {
      const { data } = await github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/parent', {
        ...HUB, issue_number: issueNumber,
      });
      return data?.number ?? null;
    } catch (e) {
      if (e.status !== 404) core.warning(`Não consegui ler a issue-mãe atual: ${e.message}`);
      return null;
    }
  }

  async function linkParent(parent, issue) {
    if ((await currentParentNumber(issue.number)) === parent.number) return;
    try {
      await github.request('POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
        ...HUB, issue_number: parent.number, sub_issue_id: issue.id, replace_parent: true,
      });
      core.info(`Vinculada como sub-issue de ${hubRef(parent.number)}`);
    } catch (e) {
      if (e.status === 422 && /already/i.test(e.message)) return;
      throw e;
    }
  }

  async function syncLabels(issue, wanted) {
    const current = issue.labels.map((l) => (typeof l === 'string' ? l : l.name));
    for (const name of wanted) await lib.ensureLabel(github, HUB.owner, HUB.repo, name);
    const missing = wanted.filter((n) => !current.includes(n));
    if (missing.length) await github.rest.issues.addLabels({ ...HUB, issue_number: issue.number, labels: missing });
    const managed = [...lib.TYPE_LABELS, 'breaking', 'sem-issue-mae'];
    for (const name of current.filter((n) => managed.includes(n) && !wanted.includes(n))) {
      await github.rest.issues.removeLabel({ ...HUB, issue_number: issue.number, name }).catch(() => {});
    }
  }

  async function upsertComment(comment, lines) {
    const body = lines.filter((l) => l !== null).join('\n');
    if (comment) {
      if (comment.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: comment.id, body });
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
    }
  }

  function buildBody() {
    const summary = lib.extractSummary(pr.body) || '_(PR sem resumo)_';
    return [
      marker,
      `**PR:** ${prRef}`,
      `**Repo:** \`${repo}\` · **Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\``,
      `**Autor:** ${pr.user.login}`,
      '',
      '### Resumo',
      summary,
      '',
      '---',
      '<sub>Sub-issue gerada automaticamente pelo workflow PR padrão (vizzela-labs/.github). Não remova o marcador oculto do topo.</sub>',
    ].join('\n');
  }

  // ---------- fluxo ----------
  const comment = await findStickyComment();
  let issue = await findSubIssue(comment);

  if (action === 'closed') {
    if (!issue) {
      core.info('PR fechado e sem sub-issue: nada a fazer.');
      return;
    }
    const merged = Boolean(pr.merged);
    if (issue.state === 'open') {
      await github.rest.issues.update({
        ...HUB, issue_number: issue.number, state: 'closed', state_reason: merged ? 'completed' : 'not_planned',
      });
    }
    await setStatus(issue.node_id, PROJECT.done);

    let parentLine = null;
    if (merged) {
      const parentNumber = await currentParentNumber(issue.number);
      if (parentNumber) {
        await lib.sleep(3000); // deixa o resumo de sub-issues da mãe atualizar
        const parent = await getHubIssue(parentNumber);
        const s = parent?.sub_issues_summary;
        if (parent && parent.state === 'open' && s && s.total > 0 && s.completed === s.total) {
          await github.rest.issues.update({ ...HUB, issue_number: parent.number, state: 'closed', state_reason: 'completed' });
          await setStatus(parent.node_id, PROJECT.done);
          parentLine = `- **Issue-mãe:** ${hubRef(parent.number)}: todas as sub-issues concluídas, fechada ✅`;
        } else if (parent) {
          parentLine = `- **Issue-mãe:** ${hubRef(parent.number)} (${s ? `${s.completed}/${s.total}` : '?'} sub-issues concluídas)`;
        }
      }
    }
    await upsertComment(comment, [
      `${COMMENT_TAG}: ${issue.number} -->`,
      '### 🔗 Rastreamento',
      `- **Sub-issue:** ${hubRef(issue.number)}: ${merged ? 'fechada como concluída (merge)' : 'fechada como não planejada (PR fechado sem merge)'} → Done`,
      parentLine,
    ]);
    return;
  }

  // opened / reopened / edited / ready_for_review / converted_to_draft
  const parsed = lib.parseTitle(pr.title);
  const parentRef = lib.parseParent(pr.body, pr.head.ref);
  let parent = null;
  let parentProblem = null;
  if (parentRef) {
    const p = await getHubIssue(parentRef.number);
    if (!p) parentProblem = `${hubRef(parentRef.number)} (vinda da ${parentRef.source}) não existe`;
    else if (p.pull_request) parentProblem = `${hubRef(parentRef.number)} (vinda da ${parentRef.source}) é um PR, não uma issue`;
    else if (p.state === 'closed') parentProblem = `${hubRef(parentRef.number)} (vinda da ${parentRef.source}) está fechada`;
    else if (issue && p.number === issue.number) parentProblem = 'a issue-mãe informada é a própria sub-issue';
    else parent = p;
  }

  const title = `[${repo}] ${pr.title}`.slice(0, 256);
  const labels = ['pr-auto', `repo:${repo}`];
  if (parsed) labels.push(lib.TYPES[parsed.type].label);
  if (parsed?.breaking) labels.push('breaking');
  if (!parent) labels.push('sem-issue-mae');

  if (!issue) {
    for (const name of labels) await lib.ensureLabel(github, HUB.owner, HUB.repo, name);
    ({ data: issue } = await github.rest.issues.create({ ...HUB, title, body: buildBody(), labels }));
    core.info(`Sub-issue criada: ${hubRef(issue.number)}`);
    try {
      await github.rest.issues.addAssignees({ ...HUB, issue_number: issue.number, assignees: [pr.user.login] });
    } catch (e) {
      core.warning(`Não consegui atribuir ${pr.user.login}: ${e.message}`);
    }
  } else {
    const patch = {};
    if (issue.title !== title) patch.title = title;
    if (issue.state === 'closed') patch.state = 'open';
    if (Object.keys(patch).length) {
      ({ data: issue } = await github.rest.issues.update({ ...HUB, issue_number: issue.number, ...patch }));
    }
    await syncLabels(issue, labels);
  }

  if (parent) await linkParent(parent, issue);
  await setStatus(issue.node_id, PROJECT.inProgress);

  const notes = [];
  if (!parentRef) {
    notes.push('⚠️ **Sem issue-mãe.** Use a branch `tipo/<nº>-slug` ou preencha `Issue-mãe: vzla-backlog#<nº>` no corpo do PR.');
  } else if (parentProblem) {
    notes.push(`⚠️ **Issue-mãe inválida:** ${parentProblem}. Corrija a linha \`Issue-mãe:\` no corpo do PR.`);
  }
  if (!lib.branchFollowsPattern(pr.head.ref)) {
    notes.push(`ℹ️ A branch \`${pr.head.ref}\` está fora do padrão \`tipo/<nº>-slug\` (ex.: \`feat/42-mapa-por-estado\`).`);
  }
  if (!parsed) notes.push('❌ Título fora do padrão `tipo(escopo): descrição`. Veja o check **Título**.');

  await upsertComment(comment, [
    `${COMMENT_TAG}: ${issue.number} -->`,
    '### 🔗 Rastreamento',
    `- **Sub-issue:** ${hubRef(issue.number)} → In progress`,
    parent ? `- **Issue-mãe:** ${hubRef(parent.number)} (${parentRef.source})` : null,
    notes.length ? '' : null,
    ...notes,
    '',
    '<sub>Atualizado automaticamente pelo workflow PR padrão. [Convenções](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md)</sub>',
  ]);
};
