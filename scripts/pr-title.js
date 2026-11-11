// Valida o título do PR (tipo(escopo): descrição) e aplica a label do tipo.
// Roda com o GITHUB_TOKEN do próprio repo.
const lib = require('./lib.js');

module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const parsed = lib.parseTitle(pr.title);

  if (!parsed) {
    core.setFailed(
      [
        `Título fora do padrão: "${pr.title}"`,
        '',
        'Use:  tipo(escopo): descrição',
        `Tipos: ${Object.keys(lib.TYPES).join(', ')}`,
        'Ex.:   feat(pdv): cancelamento da NFC-e na SEFAZ',
        '       fix(billing)!: muda o cálculo do faturamento   (o ! marca breaking change)',
        '',
        'Convenções: https://github.com/vizzela-labs/.github/blob/main/CONTRIBUTING.md',
      ].join('\n'),
    );
    return;
  }

  core.info(`OK: tipo=${parsed.type} escopo=${parsed.scope} breaking=${parsed.breaking}`);

  // Trunk-based: nos repos com branch dev, a main só recebe a release (dev) ou hotfix/*.
  if (pr.base.ref === 'main' && pr.head.ref !== 'dev' && !pr.head.ref.startsWith('hotfix/')) {
    const hasDev = await github.rest.repos.getBranch({ owner, repo, branch: 'dev' }).then(() => true, () => false);
    if (hasDev) {
      core.setFailed(
        [
          `PR para a main vindo de "${pr.head.ref}".`,
          'Neste repo o tronco é a dev: abra o PR com base **dev**.',
          'Para a main só vão a release da sprint (dev → main) e correções urgentes em branches hotfix/*.',
        ].join('\n'),
      );
      return;
    }
  }

  const want = [lib.TYPES[parsed.type].label];
  if (parsed.breaking) want.push('breaking');
  const current = pr.labels.map((l) => l.name);
  const stale = current.filter(
    (n) => (lib.TYPE_LABELS.includes(n) || n === 'breaking') && !want.includes(n),
  );

  try {
    for (const name of want) await lib.ensureLabel(github, owner, repo, name);
    const missing = want.filter((n) => !current.includes(n));
    if (missing.length) await github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: missing });
    for (const name of stale) {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name }).catch(() => {});
    }
  } catch (e) {
    core.warning(`Não consegui aplicar labels: ${e.message}`);
  }
};
