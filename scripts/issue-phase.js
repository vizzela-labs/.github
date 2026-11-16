// Fase da issue no board Tecnologia Vizzela a partir de eventos do vzla-backlog:
//   atribuída enquanto em Backlog       → Triagem (passo 02: quem pegou escolhe o caminho)
//   label quick-spec / spec / bugfix-spec → Spec  (passo 03: spec + contrato em PR)
// O resto (Todo em diante) segue o PR (pr-sync.js). Roda com o token do GitHub App vizzela-labs.
const lib = require('./lib.js');

const PROJECT = {
  id: 'PVT_kwDOFBBL-s4BlX7s',
  statusField: 'PVTSSF_lADOFBBL-s4BlX7szhkFDoI',
  triagem: '1f33c48e',
  spec: 'a675bd02',
};
const NAME = { triagem: 'Triagem', spec: 'Spec' };

module.exports = async ({ github, context, core }) => {
  const { issue, action, label } = context.payload;
  // Sub-issues geradas de PR ([repo] título) andam pelo PR, não pela triagem.
  if (issue.title.startsWith('[') || issue.labels?.some((l) => l.name === 'pr-auto')) {
    core.info('Sub-issue de PR: nada a fazer.');
    return;
  }

  // Item da issue no projeto (cria se ainda não estiver) e coluna atual.
  const add = await github.graphql(
    `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}`,
    { p: PROJECT.id, c: issue.node_id },
  );
  const item = add.addProjectV2ItemById.item;
  const currentStatus = item.fieldValueByName?.name || null;

  const key = lib.issuePhaseKey({ action, label: label?.name, currentStatus });
  if (!key) {
    core.info(`Sem mudança de fase (${action}${label ? ` ${label.name}` : ''}, coluna ${currentStatus || 'vazia'}).`);
    return;
  }
  await github.graphql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}`,
    { p: PROJECT.id, i: item.id, f: PROJECT.statusField, o: PROJECT[key] },
  );
  core.info(`#${issue.number}: ${currentStatus || 'sem coluna'} → ${NAME[key]}`);
};
