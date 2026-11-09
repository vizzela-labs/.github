// Garante a sprint da semana atual e a da próxima no campo "Iteration" do projeto
// Tecnologia Vizzela. Sprints semanais começando no domingo, título "Sprint DD/MM/AAAA".
// Iterações existentes são reenviadas com o próprio id, o que preserva os itens vinculados.
const FIELD_ID = 'PVTIF_lADOFBBL-s4BlX7szhkFER8';
const DAY = 864e5;

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

async function ensureSprints({ github, core, dryRun }) {
  const all = await readIterations(github);
  const thisWeek = sundayOf(todaySP());
  const wanted = [thisWeek, addDays(thisWeek, 7)].filter((s) => !sprintAt(all, s));
  if (!wanted.length) {
    core.info(`Nada a fazer: já existem a sprint atual e a próxima (${thisWeek}).`);
    return;
  }
  const iterations = [
    ...all.map((it) => ({ id: it.id, startDate: it.startDate, duration: it.duration, title: it.title })),
    ...wanted.map((s) => ({ startDate: s, duration: 7, title: title(s) })),
  ];
  core.info(`Sprints a criar: ${wanted.map(title).join(', ')}`);
  if (dryRun) {
    core.info(`DRY RUN, nada gravado. Configuração que seria enviada:\n${JSON.stringify(iterations, null, 2)}`);
    return;
  }
  await github.graphql(
    `mutation($f:ID!,$c:ProjectV2IterationFieldConfigurationInput!){updateProjectV2Field(input:{fieldId:$f,iterationConfiguration:$c}){projectV2Field{... on ProjectV2IterationField{id}}}}`,
    { f: FIELD_ID, c: { startDate: iterations[0].startDate, duration: 7, iterations } },
  );
  // Confere que nenhuma sprint antiga perdeu a identidade (itens vinculados).
  const after = await readIterations(github);
  const ids = new Set(after.map((it) => it.id));
  const lost = all.filter((it) => !ids.has(it.id));
  if (lost.length) {
    core.setFailed(`ATENÇÃO: sprints recriadas com outro id: ${lost.map((it) => it.title).join(', ')}`);
    return;
  }
  core.info(`Criadas: ${wanted.map(title).join(', ')}. Sprints existentes preservadas (${all.length}).`);
}

module.exports = async ({ github, core }) => ensureSprints({ github, core, dryRun: process.env.DRY_RUN === 'true' });
module.exports.readIterations = readIterations;
module.exports.sprintAt = sprintAt;
module.exports.todaySP = todaySP;
module.exports.FIELD_ID = FIELD_ID;
