// Regras do fluxo que viram checks no PR. Nenhuma bloqueia o merge (plano Free):
// o check fica vermelho e avisa. Roda com o GITHUB_TOKEN do repo.
//   como-testar  → a seção "Como testar" do PR não pode estar vazia
//   spec         → PR que mexe em specs/ precisa de SPEC_APPROVALS aprovação(ões) de outro dev
//   spec-formato → requisitos em EARS, bugfix com HOJE/ESPERADO/INALTERADO, sem pergunta em aberto;
//                  devolve em `contratos` os contrato.yaml para o Redocly validar
//   migration    → migration que apaga ou reescreve dado: backup antes da release e aviso no PR
//   mock         → nada de src/mocks/ chegando na main (o mock do front sai antes da release)
//   revisor      → sorteia outro dev para revisar, se ninguém foi pedido ainda
const lib = require('./lib.js');
const { specDirs, lintSpec, isMigrationPath, destructiveOps } = require('./spec-lint.js');

// Quantas aprovações uma spec pede (sem contar o autor). Era 2 (back e front); desde 17/11/2026
// basta 1, enquanto o time avalia se a revisão dupla compensa.
const SPEC_APPROVALS = 1;

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
    if (approvers.length < SPEC_APPROVALS) {
      const precisa = SPEC_APPROVALS === 1 ? '1 aprovação (back ou front)' : `${SPEC_APPROVALS} aprovações`;
      return core.setFailed(
        `Spec precisa de ${precisa}, de alguém que não seja o autor; tem ${approvers.length}` +
          `${approvers.length ? ` (${approvers.join(', ')})` : ''}. O merge não está bloqueado, mas o combinado é esperar.`,
      );
    }
    return core.info(`Spec aprovada por ${approvers.join(', ')}.`);
  }

  if (mode === 'spec-formato') {
    core.setOutput('contratos', '');
    const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
    const dirs = specDirs(files.filter((f) => f.status !== 'removed').map((f) => f.filename));
    if (!dirs.length) return core.info('PR sem arquivos em specs/: regra não se aplica.');
    const ref = pr.head.sha;
    const contratos = [];
    const problems = [];
    for (const dir of dirs) {
      let entries;
      try {
        ({ data: entries } = await github.rest.repos.getContent({ owner, repo, path: dir, ref }));
      } catch (e) {
        if (e.status === 404) continue; // pasta apagada no PR
        throw e;
      }
      const content = {};
      for (const f of [].concat(entries).filter((x) => x.type === 'file' && /\.(md|ya?ml)$/.test(x.name))) {
        const { data } = await github.rest.repos.getContent({ owner, repo, path: f.path, ref });
        content[f.name] = Buffer.from(data.content, 'base64').toString('utf8');
        if (/^contrato\.ya?ml$/.test(f.name)) contratos.push(f.path);
      }
      const { errors, warnings } = lintSpec(content);
      for (const w of warnings) core.warning(`${dir}: ${w}`);
      for (const e of errors) problems.push(`${dir}: ${e}`);
      if (!errors.length) core.info(`${dir}: ok`);
    }
    core.setOutput('contratos', contratos.join(' '));
    if (problems.length) {
      return core.setFailed(
        `Spec fora do padrão (modelo em https://github.com/vizzela-labs/.github/tree/main/specs-modelo):\n` +
          problems.map((p) => `  - ${p}`).join('\n'),
      );
    }
    return core.info('Spec no formato.');
  }

  if (mode === 'migration') {
    const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
    const migs = files.filter((f) => f.status !== 'removed' && isMigrationPath(f.filename));
    if (!migs.length) return core.info('PR sem migration.');
    const found = [];
    for (const f of migs) {
      const { data } = await github.rest.repos.getContent({ owner, repo, path: f.filename, ref: pr.head.sha });
      for (const o of destructiveOps(Buffer.from(data.content, 'base64').toString('utf8'))) found.push(`${f.filename}:${o.line} ${o.op}: ${o.text}`);
    }
    if (!found.length) return core.info(`${migs.length} migration(s), nenhuma destrutiva.`);
    const ok = /backup/i.test(lib.extractSection(pr.body, 'Como testar')) || /backup/i.test(lib.extractSection(pr.body, 'Por quê'));
    const msg = `Migration que apaga ou reescreve dado (roda sozinha no deploy):\n${found.slice(0, 20).map((x) => `  - ${x}`).join('\n')}\n` +
      'Antes da release: backup manual do banco de produção no Coolify (Backups → Backup Now) e, se possível, a migration em duas etapas (expandir e depois contrair). ' +
      'Diga no PR como volta atrás; com a palavra "backup" no Como testar ou no Por quê, isto vira só aviso.';
    return ok ? core.warning(msg) : core.setFailed(msg);
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
