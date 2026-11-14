// Regras do fluxo que viram checks no PR. Nenhuma bloqueia o merge (plano Free):
// o check fica vermelho e avisa. Roda com o GITHUB_TOKEN do repo.
//   como-testar  → a seção "Como testar" do PR não pode estar vazia
//   spec         → PR que mexe em specs/ precisa de 2 aprovações (back e front)
//   mock         → nada de src/mocks/ chegando na main (o mock do front sai antes da release)
//   revisor      → sorteia outro dev para revisar, se ninguém foi pedido ainda
const lib = require('./lib.js');

const TRUNK = 'dev';
const PROD = 'main';

module.exports = async ({ github, context, core, mode }) => {
  const pr = context.payload.pull_request;
  if (!pr) return core.info('Evento sem PR: nada a fazer.');
  const { owner, repo } = context.repo;
  const author = pr.user?.login || '';
  const isBot = pr.user?.type === 'Bot' || /\[bot\]$/.test(author);
  const isRelease = pr.base.ref === PROD && pr.head.ref === TRUNK;
  const isSync = /^chore\(release\): sincroniza/.test(pr.title || '');

  if (mode === 'como-testar') {
    if (isBot || isRelease || isSync) return core.info('PR automático: dispensado do Como testar.');
    const text = lib.extractSection(pr.body, 'Como testar');
    if (!text) {
      return core.setFailed(
        'A seção "## Como testar" está vazia. Coloque o link do ambiente já buildado ' +
          '(preview do PR ou ambiente de dev) e os passos, direto: onde clicar e o que deve aparecer.',
      );
    }
    return core.info(`Como testar preenchido (${text.length} caracteres).`);
  }

  if (mode === 'spec') {
    const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
    const specFiles = files.map((f) => f.filename).filter(lib.isSpecPath);
    if (!specFiles.length) return core.info('PR sem arquivos em specs/: regra não se aplica.');
    const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: pr.number, per_page: 100 });
    const last = new Map(); // último estado de cada revisor
    for (const r of reviews) {
      if (!r.user || r.user.login === author || r.state === 'COMMENTED') continue;
      last.set(r.user.login, r.state);
    }
    const approvers = [...last].filter(([, s]) => s === 'APPROVED').map(([l]) => l);
    if (approvers.length < 2) {
      return core.setFailed(
        `Spec precisa da aprovação de 2 devs (back e front); tem ${approvers.length}` +
          `${approvers.length ? ` (${approvers.join(', ')})` : ''}. O merge não está bloqueado, mas o combinado é esperar.`,
      );
    }
    return core.info(`Spec aprovada por ${approvers.join(', ')}.`);
  }

  if (mode === 'mock') {
    if (pr.base.ref !== PROD) return core.info(`Base ${pr.base.ref}: regra só vale para PR na ${PROD}.`);
    const { data } = await github.rest.git.getTree({ owner, repo, tree_sha: pr.head.sha, recursive: 'true' });
    const mocks = data.tree.filter((t) => t.type === 'blob').map((t) => t.path).filter(lib.isMockPath);
    if (mocks.length) {
      const list = mocks.slice(0, 20).map((p) => `  - ${p}`).join('\n');
      return core.setFailed(
        `Há ${mocks.length} arquivo(s) de mock indo para a ${PROD}. O mock do front é apagado no PR de integração, ` +
          `antes da release:\n${list}${mocks.length > 20 ? '\n  - …' : ''}`,
      );
    }
    return core.info('Nenhum mock em src/mocks/.');
  }

  if (mode === 'revisor') {
    if (isBot || isRelease || isSync || pr.draft) return core.info('PR automático ou rascunho: sem sorteio.');
    if ((pr.requested_reviewers || []).length || (pr.requested_teams || []).length) {
      return core.info('Já há revisor pedido: sem sorteio.');
    }
    const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: pr.number, per_page: 100 });
    if (reviews.some((r) => r.user && r.user.login !== author && r.user.type !== 'Bot')) {
      return core.info('Já há review de outro dev: sem sorteio.');
    }
    const reviewer = lib.pickRandom(lib.DEVS, [author]);
    if (!reviewer) return core.warning('Nenhum dev disponível para sortear (veja scripts/devs.json).');
    await github.rest.pulls.requestReviewers({ owner, repo, pull_number: pr.number, reviewers: [reviewer] });
    return core.info(`Revisor sorteado: ${reviewer}`);
  }

  core.setFailed(`Modo desconhecido: ${mode}`);
};
