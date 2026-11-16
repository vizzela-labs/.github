// Mantém uma sub-issue no vzla-backlog espelhando o ciclo de vida de um PR.
// Roda com o token do GitHub App vizzela-labs (issues:write, organization_projects:write).
const lib = require('./lib.js');
const sprint = require('./sprint.js');

const HUB = { owner: 'vizzela-labs', repo: 'vzla-backlog' };
const PROJECT = {
  id: 'PVT_kwDOFBBL-s4BlX7s',
  statusField: 'PVTSSF_lADOFBBL-s4BlX7szhkFDoI',
  backlog: '9d1c2785',
  todo: 'f75ad846',
  inProgress: '47fc9ee4',
  inReview: '0909cf2b',
  triagem: '1f33c48e',
  spec: 'a675bd02',
  qa: '969ee038',
  done: '98236657',
};
const STATUS_NAME = {
  [PROJECT.backlog]: 'Backlog', [PROJECT.triagem]: 'Triagem', [PROJECT.spec]: 'Spec',
  [PROJECT.todo]: 'Todo', [PROJECT.inProgress]: 'In progress',
  [PROJECT.inReview]: 'In review', [PROJECT.qa]: 'QA', [PROJECT.done]: 'Done',
};
// "Pronto" é sempre manual: release e hotfix levam o item para esta coluna, e um dev
// move para Done depois de conferir em produção. A opção é buscada pelo nome; se ainda
// não existir no Status do projeto, o item fica em QA com um aviso.
const PROD_STATUS_NAME = 'Em produção';
const COMMENT_TAG = '<!-- vzla-sub-issue';

module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const action = context.payload.action;
  const { owner, repo } = context.repo;
  const prRef = `${owner}/${repo}#${pr.number}`;
  const marker = `<!-- vzla-pr: ${prRef} -->`;
  const hubRef = (n) => `${HUB.owner}/${HUB.repo}#${n}`;

  // Relê as labels: quem cria o PR via CLI/API aplica labels logo depois do "opened",
  // então o payload do evento pode vir sem elas.
  const { data: fresh } = await github.rest.pulls.get({ owner, repo, pull_number: pr.number });
  // Trunk-based em cima da dev: feature → dev (QA), dev → main = release (Done), hotfix/* → main.
  const TRUNK = 'dev';
  const PROD = 'main';
  const isRelease = pr.base.ref === PROD && pr.head.ref === TRUNK;
  const toTrunk = pr.base.ref === TRUNK;
  const isBot = pr.user?.type === 'Bot' || /\[bot\]$/.test(pr.user?.login || '');
  if (isBot && !(action === 'closed' && isRelease)) {
    core.info('PR de bot: nada a fazer.');
    return;
  }
  if (fresh.labels.some((l) => l.name === 'no-issue')) {
    core.info('PR com label no-issue: nada a fazer.');
    return;
  }

  // ---------- helpers ----------
  // PR de spec (passo 03): só mexe em specs/. Muda a coluna da issue-mãe (Spec, e Todo no merge).
  let specOnlyCache;
  async function specOnly() {
    if (specOnlyCache !== undefined) return specOnlyCache;
    try {
      const files = await github.paginate(github.rest.pulls.listFiles, {
        owner, repo, pull_number: pr.number, per_page: 100,
      });
      specOnlyCache = lib.isSpecOnly(files.map((f) => f.filename));
    } catch (e) {
      core.warning(`Não consegui listar os arquivos do PR: ${e.message}`);
      specOnlyCache = false;
    }
    return specOnlyCache;
  }

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
        return itemId;
      }
    }
    core.warning(`Status no projeto não ficou em ${STATUS_NAME[optionId]} após 3 tentativas.`);
    return itemId;
  }

  let prodStatusCache;
  async function prodStatus() {
    if (prodStatusCache !== undefined) return prodStatusCache;
    const r = await github.graphql(
      `query($id:ID!){node(id:$id){... on ProjectV2SingleSelectField{options{id name}}}}`,
      { id: PROJECT.statusField },
    );
    const opt = (r.node?.options || []).find((o) => o.name.toLowerCase() === PROD_STATUS_NAME.toLowerCase());
    if (opt) STATUS_NAME[opt.id] = opt.name;
    else core.warning(`Status "${PROD_STATUS_NAME}" não existe no projeto: item fica em QA. Crie a opção no campo Status.`);
    prodStatusCache = opt ? opt.id : PROJECT.qa;
    return prodStatusCache;
  }

  // Coloca o item na sprint atual, se ainda não tiver sprint.
  async function setCurrentSprintIfEmpty(itemId) {
    try {
      const cur = await github.graphql(
        `query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Iteration"){... on ProjectV2ItemFieldIterationValue{iterationId}}}}}`,
        { id: itemId },
      );
      if (cur.node?.fieldValueByName?.iterationId) return;
      const current = sprint.sprintAt(await sprint.readIterations(github), sprint.todaySP());
      if (!current) {
        core.warning('Não existe sprint para a semana atual; item ficou sem sprint. Rode o workflow "Sprint semanal".');
        return;
      }
      await github.graphql(
        `mutation($p:ID!,$i:ID!,$f:ID!,$it:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{iterationId:$it}}){projectV2Item{id}}}`,
        { p: PROJECT.id, i: itemId, f: sprint.FIELD_ID, it: current.id },
      );
      core.info(`Sprint: ${current.title}`);
    } catch (e) {
      core.warning(`Não consegui definir a sprint: ${e.message}`);
    }
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

  // Linha do tempo do comentário de rastreamento: só cresce, para o histórico
  // (link da homologação, merge etc.) não sumir quando o PR fecha.
  const HIST_HEADER = '#### Linha do tempo';
  const stamp = () =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date()).replace(',', '');
  const history = [];
  function loadHistory(c) {
    const body = c?.body || '';
    const i = body.indexOf(HIST_HEADER);
    if (i < 0) return;
    for (const l of body.slice(i + HIST_HEADER.length).split('\n')) if (l.startsWith('- ')) history.push(l);
  }
  function addEvent(key, text) {
    if (!history.some((l) => l.includes(key))) history.push(`- ${stamp()} · ${text}`);
  }
  const historyBlock = () => (history.length ? ['', HIST_HEADER, ...history] : []);

  async function upsertComment(comment, lines) {
    const body = lines.filter((l) => l !== null).join('\n');
    if (comment) {
      if (comment.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: comment.id, body });
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
    }
  }

  // "closes owner/repo#N" no corpo do PR é o que liga o PR à issue no painel
  // "Development" do GitHub. O bloco é gerenciado: reescrito se a sub-issue mudar.
  async function ensureClosingKeyword(issue) {
    const start = '<!-- vzla-closes:start -->';
    const end = '<!-- vzla-closes:end -->';
    const block = `${start}\nSub-issue: closes ${hubRef(issue.number)}\n${end}`;
    const { data: cur } = await github.rest.pulls.get({ owner, repo, pull_number: pr.number });
    const body = cur.body || '';
    const re = /<!-- vzla-closes:start -->[\s\S]*?<!-- vzla-closes:end -->/;
    if (re.test(body) ? body.match(re)[0] === block : false) return;
    const next = re.test(body) ? body.replace(re, block) : `${body.trimEnd()}\n\n${block}\n`;
    await github.rest.pulls.update({ owner, repo, pull_number: pr.number, body: next });
    core.info(`Vínculo "closes ${hubRef(issue.number)}" garantido no corpo do PR`);
  }

  // Avisa uma única vez, na issue-mãe (o pedido), que a homologação está no ar,
  // mencionando quem abriu o pedido e o desenvolvedor do PR.
  async function announcePreview(parent, url) {
    const tag = `<!-- vzla-preview: ${prRef} ${url} -->`; // a URL no marcador: se mudar, avisa de novo
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...HUB, issue_number: parent.number, per_page: 100,
    });
    if (comments.some((c) => c.body?.includes(tag))) return;
    const people = [...new Set([parent.user?.login, pr.user.login].filter(Boolean))].map((l) => `@${l}`);
    await github.rest.issues.createComment({
      ...HUB,
      issue_number: parent.number,
      body: [
        tag,
        '### Homologação disponível',
        `${people.join(' e ')}: o ${prRef} está no ar para teste em **${url}**.`,
        '',
        'O ambiente sobe alguns minutos depois do PR ficar pronto e é atualizado a cada push. Ele usa as mesmas variáveis do ambiente de **dev** (bancos e serviços de dev). Siga a seção **Como testar** do PR.',
        '',
        'Quando terminar o teste, responda aqui com **aprovado** ou com o que precisa ajustar.',
      ].join('\n'),
    });
    core.info(`Homologação anunciada em ${hubRef(parent.number)}`);
  }

  // Release (dev → main): os PRs incluídos saem dos commits da release (squash "(#N)" ou
  // "Merge pull request #N"); a sub-issue de cada um vem do comentário de rastreamento do PR.
  // Nada é fechado aqui: o item vai para "Em produção" e um dev marca Done à mão.
  async function handleRelease() {
    const commits = await github.paginate(github.rest.pulls.listCommits, { owner, repo, pull_number: pr.number, per_page: 100 });
    const nums = new Set();
    for (const c of commits) {
      const first = c.commit.message.split('\n')[0];
      const m = first.match(/\(#(\d+)\)\s*$/) || first.match(/^Merge pull request #(\d+)/);
      if (m && Number(m[1]) !== pr.number) nums.add(Number(m[1]));
    }
    const target = await prodStatus();
    const moved = [];
    for (const n of nums) {
      const cs = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: n, per_page: 100 });
      const tag = cs.find((c) => c.user?.type === 'Bot' && c.body?.includes(COMMENT_TAG));
      const m = tag && /vzla-sub-issue:\s*(\d+)/.exec(tag.body);
      if (!m) continue;
      const sub = await getHubIssue(Number(m[1]));
      if (!sub) continue;
      if (sub.state === 'closed') await github.rest.issues.update({ ...HUB, issue_number: sub.number, state: 'open' });
      await setStatus(sub.node_id, target);
      moved.push(`- ${owner}/${repo}#${n} → ${hubRef(sub.number)} ${STATUS_NAME[target]}`);
    }
    await github.rest.issues.createComment({
      owner, repo, issue_number: pr.number,
      body: [
        '### 🚀 Release em produção',
        `${nums.size} PR(s) na release; ${moved.length} item(ns) em **${STATUS_NAME[target]}**:`,
        ...moved,
        '',
        'Depois de conferir em produção, um dev move cada item para **Done** no board. Nada vira Done sozinho.',
      ].join('\n'),
    });
    core.info(`Release: ${moved.length} item(ns) em ${STATUS_NAME[target]}`);
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
  if (action === 'closed' && isRelease) {
    if (pr.merged) await handleRelease();
    return;
  }
  const comment = await findStickyComment();
  loadHistory(comment);
  let issue = await findSubIssue(comment);

  if (action === 'closed') {
    if (!issue) {
      core.info('PR fechado e sem sub-issue: nada a fazer.');
      return;
    }
    const merged = Boolean(pr.merged);
    if (merged && toTrunk) {
      if (issue.state === 'closed') {
        await github.rest.issues.update({ ...HUB, issue_number: issue.number, state: 'open' });
      }
      await setStatus(issue.node_id, PROJECT.qa);
      const parentNumber = await currentParentNumber(issue.number);
      // QA sorteado entre os devs (menos o autor), sem rodízio. Fica como responsável na sub-issue.
      const prev = /- \*\*QA:\*\* @([\w-]+)/.exec(comment?.body || '');
      const qa = prev ? prev[1] : lib.pickRandom(lib.DEVS, [pr.user.login]);
      if (qa && !prev) {
        try {
          await github.rest.issues.addAssignees({ ...HUB, issue_number: issue.number, assignees: [qa] });
        } catch (e) {
          core.warning(`Não consegui atribuir o QA ${qa}: ${e.message}`);
        }
      }
      addEvent('Mergeado na dev', `Mergeado na dev por ${pr.merged_by?.login || 'alguém'}: em QA no ambiente de dev${qa ? ` (QA: @${qa})` : ''}`);
      // Spec aprovada e mergeada: o pedido sai de Spec e vai para Todo (back e front começam).
      if (parentNumber && (await specOnly())) {
        const parentIssue = await getHubIssue(parentNumber);
        if (parentIssue) {
          await setStatus(parentIssue.node_id, PROJECT.todo);
          addEvent('Spec mergeada', `Spec mergeada: ${hubRef(parentNumber)} em Todo`);
        }
      }
      await upsertComment(comment, [
        `${COMMENT_TAG}: ${issue.number} -->`,
        '### 🔗 Rastreamento',
        `- **Sub-issue:** ${hubRef(issue.number)} → QA (na dev; vai para ${PROD_STATUS_NAME} na release e para Done quando um dev marcar)`,
        qa ? `- **QA:** @${qa} (sorteado) testa no ambiente de dev junto com quem pediu` : null,
        parentNumber ? `- **Issue-mãe:** ${hubRef(parentNumber)}` : null,
        ...historyBlock(),
        '',
        '<sub>Atualizado automaticamente pelo workflow PR padrão. [Convenções](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md)</sub>',
      ]);
      return;
    }
    // Merge fora da dev (hotfix → main): está em produção, mas Done continua manual.
    // Fechado sem merge: a sub-issue fecha como não planejada, sem passar por Done.
    let statusLine;
    if (merged) {
      if (issue.state === 'closed') await github.rest.issues.update({ ...HUB, issue_number: issue.number, state: 'open' });
      const target = await prodStatus();
      await setStatus(issue.node_id, target);
      statusLine = `- **Sub-issue:** ${hubRef(issue.number)} → ${STATUS_NAME[target]} (um dev move para Done depois de conferir em produção)`;
    } else {
      if (issue.state === 'open') {
        await github.rest.issues.update({ ...HUB, issue_number: issue.number, state: 'closed', state_reason: 'not_planned' });
      }
      statusLine = `- **Sub-issue:** ${hubRef(issue.number)}: fechada como não planejada (PR fechado sem merge)`;
    }
    const parentNumber = await currentParentNumber(issue.number);
    const parentLine = parentNumber ? `- **Issue-mãe:** ${hubRef(parentNumber)}` : null;
    const closedPreview = lib.previewUrl(repo, pr.number, pr.base.ref);
    addEvent(merged ? 'Mergeado' : 'Fechado sem merge',
      merged ? `Mergeado na ${pr.base.ref} por ${pr.merged_by?.login || 'alguém'}: em produção` : `Fechado sem merge: sub-issue ${hubRef(issue.number)} não planejada`);
    if (closedPreview) addEvent('Homologação removida', 'Ambiente de homologação removido pelo Coolify');
    await upsertComment(comment, [
      `${COMMENT_TAG}: ${issue.number} -->`,
      '### 🔗 Rastreamento',
      statusLine,
      parentLine,
      closedPreview ? `- **Homologação:** ~~${closedPreview}~~ (ambiente removido após o ${merged ? 'merge' : 'fechamento'}; o link não abre mais)` : null,
      ...historyBlock(),
      '',
      '<sub>Atualizado automaticamente pelo workflow PR padrão. [Convenções](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md)</sub>',
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

  const created = !issue;
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

  // Rascunho = In progress; pronto para revisão = In review. A issue-mãe segue
  // lib.parentStatusKey: PR de spec = Spec; preview no ar = QA (vez de quem pediu testar).
  const isSpecPr = await specOnly();
  const preview = pr.draft || isSpecPr ? null : lib.previewUrl(repo, pr.number, pr.base.ref);
  const subStatus = pr.draft ? PROJECT.inProgress : PROJECT.inReview;
  const parentStatus = PROJECT[lib.parentStatusKey({ specOnly: isSpecPr, preview })];
  if (parent) {
    await linkParent(parent, issue);
    await setStatus(parent.node_id, parentStatus);
  }
  await ensureClosingKeyword(issue);
  const itemId = await setStatus(issue.node_id, subStatus);
  await setCurrentSprintIfEmpty(itemId);
  if (preview && parent) {
    try {
      await announcePreview(parent, preview);
    } catch (e) {
      core.warning(`Não consegui anunciar a homologação: ${e.message}`);
    }
  }

  if (created) addEvent('Sub-issue', `Sub-issue ${hubRef(issue.number)} criada`);
  if (action === 'reopened') addEvent(`Reaberto (${stamp()})`, 'PR reaberto');
  if (action === 'ready_for_review') addEvent(`Pronto para revisão (${stamp()})`, 'PR pronto para revisão: sub-issue em In review');
  if (action === 'converted_to_draft') addEvent(`Rascunho (${stamp()})`, 'PR voltou para rascunho: sub-issue em In progress');
  if (preview) addEvent('Homologação disponível', `Homologação disponível em ${preview}`);

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
    `- **Sub-issue:** ${hubRef(issue.number)} → ${STATUS_NAME[subStatus]}`,
    parent ? `- **Issue-mãe:** ${hubRef(parent.number)} (${parentRef.source})` : null,
    preview ? `- **Homologação:** ${preview} (sobe alguns minutos depois do PR ficar pronto)` : null,
    notes.length ? '' : null,
    ...notes,
    ...historyBlock(),
    '',
    '<sub>Atualizado automaticamente pelo workflow PR padrão. [Convenções](https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md)</sub>',
  ]);
};
