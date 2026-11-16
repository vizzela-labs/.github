// Garante a sprint atual e a próxima no campo "Iteration" do projeto Tecnologia Vizzela.
// Sprints de 15 dias (14 de duração, uma emenda na outra), título "Sprint DD/MM/AAAA".
// A partir de 15/11/2026; as semanais anteriores ficam como estão.
// Iterações existentes são reenviadas com o próprio id, o que preserva os itens vinculados.
const { benchmark } = require('./benchmark.js');

const FIELD_ID = 'PVTIF_lADOFBBL-s4BlX7szhkFER8';
const PROJECT_ID = 'PVT_kwDOFBBL-s4BlX7s';
const DAY = 864e5;
const LEN = 14;

const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const sundayOf = (iso) => addDays(iso, -new Date(Date.parse(iso)).getUTCDay());
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const title = (iso) => `Sprint ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const QUERY = `query($id:ID!){node(id:$id){... on ProjectV2IterationField{configuration{
  iterations{id title startDate duration} completedIterations{id title startDate duration}}}}}`;

async function readIterations(github) {
  const { node } = await github.graphql(QUERY, { id: FIELD_ID });
  const c = node.configuration;
  return [...c.completedIterations, ...c.iterations].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Sprint que contém a data (ISO), ou null. */
function sprintAt(iterations, iso) {
  return iterations.find((it) => it.startDate <= iso && iso < addDays(it.startDate, it.duration)) || null;
}

/**
 * Sprints que faltam criar para existirem a atual e a próxima. Pura (testada em test.js).
 * A nova começa onde a última termina; se houve um buraco, pula de LEN em LEN até hoje.
 */
function plan(all, today) {
  const wanted = [];
  let cur = sprintAt(all, today);
  if (!cur) {
    const last = all[all.length - 1];
    let start = last ? addDays(last.startDate, last.duration) : sundayOf(today);
    if (start > today) start = sundayOf(today);
    while (addDays(start, LEN) <= today) start = addDays(start, LEN);
    cur = { startDate: start, duration: LEN };
    wanted.push(cur);
  }
  const next = addDays(cur.startDate, cur.duration);
  if (!sprintAt(all, next)) wanted.push({ startDate: next, duration: LEN });
  return wanted;
}

async function ensureSprints({ github, core, dryRun }) {
  const all = await readIterations(github);
  const wanted = plan(all, todaySP()).map((w) => ({ ...w, title: title(w.startDate) }));
  if (!wanted.length) {
    core.info('Nada a fazer: já existem a sprint atual e a próxima.');
    return;
  }
  const iterations = [
    ...all.map((it) => ({ id: it.id, startDate: it.startDate, duration: it.duration, title: it.title })),
    ...wanted,
  ];
  core.info(`Sprints a criar: ${wanted.map((w) => w.title).join(', ')}`);
  if (dryRun) {
    core.info(`DRY RUN, nada gravado. Configuração que seria enviada:\n${JSON.stringify(iterations, null, 2)}`);
    return;
  }
  await github.graphql(
    `mutation($f:ID!,$c:ProjectV2IterationFieldConfigurationInput!){updateProjectV2Field(input:{fieldId:$f,iterationConfiguration:$c}){projectV2Field{... on ProjectV2IterationField{id}}}}`,
    { f: FIELD_ID, c: { startDate: iterations[0].startDate, duration: LEN, iterations } },
  );
  // Confere que nenhuma sprint antiga perdeu a identidade (itens vinculados).
  const after = await readIterations(github);
  const ids = new Set(after.map((it) => it.id));
  const lost = all.filter((it) => !ids.has(it.id));
  if (lost.length) {
    core.setFailed(`ATENÇÃO: sprints recriadas com outro id: ${lost.map((it) => it.title).join(', ')}`);
    return;
  }
  core.info(`Criadas: ${wanted.map((w) => w.title).join(', ')}. Sprints existentes preservadas (${all.length}).`);
}

// Itens abertos que ficaram numa sprint já encerrada passam para a sprint atual.
async function carryOver({ github, core, dryRun }) {
  const current = sprintAt(await readIterations(github), todaySP());
  if (!current) { core.warning('Sem sprint atual; nada a levar.'); return; }
  const today = todaySP();
  const moved = [];
  let after = null;
  do {
    const { node } = await github.graphql(
      `query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor}
        nodes{id content{... on Issue{number state repository{name}} ... on PullRequest{number state repository{name}}}
        it:fieldValueByName(name:"Iteration"){... on ProjectV2ItemFieldIterationValue{iterationId title startDate duration}}
        st:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`,
      { p: PROJECT_ID, after },
    );
    for (const it of node.items.nodes) {
      const iter = it.it;
      if (!iter?.iterationId || iter.iterationId === current.id) continue;
      if (addDays(iter.startDate, iter.duration) > today) continue; // sprint ainda não terminou (ou é futura)
      if (it.st?.name === 'Done' || it.content?.state !== 'OPEN') continue;
      moved.push(`${it.content.repository.name}#${it.content.number} (${iter.title})`);
      if (!dryRun) {
        await github.graphql(
          `mutation($p:ID!,$i:ID!,$f:ID!,$it:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{iterationId:$it}}){projectV2Item{id}}}`,
          { p: PROJECT_ID, i: it.id, f: FIELD_ID, it: current.id },
        );
      }
    }
    after = node.items.pageInfo.hasNextPage ? node.items.pageInfo.endCursor : null;
  } while (after);
  core.info(`${dryRun ? 'DRY RUN, levaria' : 'Levados'} para ${current.title}: ${moved.length} item(ns)${moved.length ? '\n- ' + moved.join('\n- ') : ''}`);
}

module.exports = async ({ github, core }) => {
  const dryRun = process.env.DRY_RUN === 'true';
  await ensureSprints({ github, core, dryRun });
  // Antes do carryOver: ele tira da sprint encerrada os itens abertos.
  await benchmark({ github, core, dryRun, iterations: await readIterations(github), today: todaySP(), addDays });
  await carryOver({ github, core, dryRun });
};
module.exports.readIterations = readIterations;
module.exports.sprintAt = sprintAt;
module.exports.plan = plan;
module.exports.addDays = addDays;
module.exports.todaySP = todaySP;
module.exports.FIELD_ID = FIELD_ID;
