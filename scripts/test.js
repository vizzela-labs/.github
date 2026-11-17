// node scripts/test.js
const assert = require('node:assert/strict');
const lib = require('./lib.js');

// título
assert.deepEqual(lib.parseTitle('feat(pdv): cancelamento da NFC-e'), { type: 'feat', scope: 'pdv', breaking: false, subject: 'cancelamento da NFC-e' });
assert.deepEqual(lib.parseTitle('fix(product-performance)!: Algo'), { type: 'fix', scope: 'product-performance', breaking: true, subject: 'Algo' });
assert.equal(lib.parseTitle('feat: sem escopo'), null);
assert.equal(lib.parseTitle('[FEATURE] Algo'), null);
assert.equal(lib.parseTitle('feature(x): tipo inválido'), null);
assert.equal(lib.parseTitle('feat(x):sem espaço'), null);
assert.equal(lib.parseTitle('feat( ): escopo vazio'), null);
assert.equal(lib.parseTitle('Feat(x): maiúsculo'), null);

// issue-mãe
const tpl = '## Issue-mãe\n\n<!--\nex.: Issue-mãe: vzla-backlog#42\n-->\nIssue-mãe:\n\n## Checklist\n- [ ] 1 item';
assert.deepEqual(lib.parseParent(tpl, 'feat/42-mapa'), { number: 42, source: 'branch' });
assert.equal(lib.parseParent(tpl, 'feat/mapa'), null);
assert.deepEqual(lib.parseParent('Issue-mãe: vzla-backlog#7', 'feat/42-x'), { number: 7, source: 'corpo do PR' });
assert.deepEqual(lib.parseParent('Issue-mae: #8', ''), { number: 8, source: 'corpo do PR' });
assert.deepEqual(lib.parseParent('Issue-mãe: vizzela-labs/vzla-backlog#9', ''), { number: 9, source: 'corpo do PR' });
assert.deepEqual(lib.parseParent('Issue-mãe: https://github.com/vizzela-labs/vzla-backlog/issues/10', ''), { number: 10, source: 'corpo do PR' });
assert.equal(lib.parseParent('Issue-mãe: vzla-lojas#5', ''), null);
assert.deepEqual(lib.parseParent('', 'fix/12'), { number: 12, source: 'branch' });
assert.equal(lib.parseParent('', 'fix/12abc'), null);

// branch
assert.equal(lib.branchFollowsPattern('feat/42-mapa-por-estado'), true);
assert.equal(lib.branchFollowsPattern('feat/mapa'), false);
assert.equal(lib.branchFollowsPattern('staging'), false);

// resumo
const body = '## Resumo\n\n<!-- instruções -->\nFaz X e Y.\n\n## Por quê\n\nporque sim';
assert.equal(lib.extractSummary(body), 'Faz X e Y.');
assert.equal(lib.extractSummary('## Resumo\nsó isso'), 'só isso');
assert.equal(lib.extractSummary('sem seções'), '');

// seções do corpo (Como testar)
const prBody = '## Resumo\nX\n\n## Como testar\n\n<!-- passo a passo -->\n\n## Issue-mãe\nIssue-mãe:';
assert.equal(lib.extractSection(prBody, 'Como testar'), '');
assert.equal(lib.extractSection('## Como testar\nAbra https://lojas-dev-pr-3.equipevizzela.com.br e clique em Salvar', 'Como testar'),
  'Abra https://lojas-dev-pr-3.equipevizzela.com.br e clique em Salvar');
assert.equal(lib.extractSection('## Como testar\npasso 1\n## Checklist\n- [ ] x', 'Como testar'), 'passo 1');

// sorteio
assert.equal(lib.pickRandom(['a', 'b', 'c'], ['A'], () => 0), 'b');
assert.equal(lib.pickRandom(['a', 'b', 'c'], ['a'], () => 0.99), 'c');
assert.equal(lib.pickRandom(['a'], ['a']), null);
assert.equal(lib.pickRandom(['a', 'b'], [undefined, null], () => 0), 'a');
assert.ok(Array.isArray(lib.DEVS) && lib.DEVS.length > 0);

// mock e spec
assert.equal(lib.isMockPath('src/mocks/42-cashback/handlers.ts'), true);
assert.equal(lib.isMockPath('apps/web/src/mocks/browser.ts'), true);
assert.equal(lib.isMockPath('src/mocksx/a.ts'), false);
assert.equal(lib.isMockPath('test/mocks/a.ts'), false);
assert.equal(lib.isSpecPath('specs/42-cashback/contrato.yaml'), true);
assert.equal(lib.isSpecPath('docs/specs/x.md'), true);
assert.equal(lib.isSpecPath('src/specsheet.ts'), false);

// preview: só para PR com a base certa
assert.equal(lib.previewUrl('vzla-cashback', 12, 'dev'), 'https://cashback-dev-pr-12.equipevizzela.com.br');
assert.equal(lib.previewUrl('vzla-cashback', 12, 'main'), null);
assert.equal(lib.previewUrl('vzla-panel-hub', 7, 'main'), 'https://hub-pr-7.equipevizzela.com.br');
assert.equal(lib.previewUrl('vzla-lojas-pdv', 7, 'dev'), null);

// comentário do Coolify
assert.equal(lib.parseCoolifyReady('The preview deployment for **vzla-cashback** is ready. 🟢\n\n[Open Preview](https://cashback-dev-pr-3.equipevizzela.com.br) | [Open Build Logs](https://x)'),
  'https://cashback-dev-pr-3.equipevizzela.com.br');
assert.equal(lib.parseCoolifyReady('The preview deployment for **x** is in progress. 🟡\n[Open Preview](https://a.b)'), null);
assert.equal(lib.OPENAPI_PATHS['vizzela-products-backend'], '/api/docs-json');

// formato da spec
const spec = require('./spec-lint.js');
assert.deepEqual(spec.specDirs(['specs/42-x/requisitos.md', 'specs/42-x/contrato.yaml', 'apps/api/specs/7-y/bugfix.md', 'specs/README.md', 'specs/_modelo/a.md', 'src/a.ts']),
  ['apps/api/specs/7-y', 'specs/42-x']);
const ok = spec.lintSpec({
  'requisitos.md': '# x\n<!-- QUANDO exemplo -->\n- QUANDO o lojista abre a tela, O SISTEMA DEVE mostrar os cards.\n- O SISTEMA DEVE registrar o acesso.\n- SE a API falhar, ENTÃO O SISTEMA DEVE mostrar o erro.',
  'tarefas.md': '- [ ] a\n\n## Branches\n| Onda | Repo | Branch | Dono |\n|---|---|---|---|\n| 2 | vzla-cashback | feat/42-x | @h |', 'contrato.yaml': 'openapi: 3.1.0',
});
assert.deepEqual(ok, { errors: [], warnings: [] });
assert.equal(spec.lintSpec({ 'design.md': 'x' }).errors.length, 1);
assert.match(spec.lintSpec({ 'requisitos.md': 'A tela deve carregar.' }).errors[0], /QUANDO/);
assert.ok(spec.lintSpec({ 'requisitos.md': '- QUANDO abrir, O SISTEMA DEVE ser rápido.' }).warnings.some((w) => /vago/.test(w)));
assert.ok(spec.lintSpec({ 'requisitos.md': '- O SISTEMA DEVE x [PERGUNTA: qual a regra?]' }).errors.some((e) => /pendência/.test(e)));
const bug = (esperado) => `## HOJE\n1. abre\n2. cards zerados\n\n## ESPERADO\n${esperado}\n\n## INALTERADO\n- O SISTEMA DEVE manter o filtro.`;
assert.deepEqual(spec.lintSpec({ 'bugfix.md': bug('- QUANDO não houver lançamento, O SISTEMA DEVE mostrar R$ 0,00.') }).errors, []);
assert.ok(spec.lintSpec({ 'bugfix.md': bug('Esconde o card ou mostra zero?') }).errors.some((e) => /pergunta/.test(e)));
assert.ok(spec.lintSpec({ 'bugfix.md': '## HOJE\nx\n## ESPERADO\n\n## INALTERADO\ny' }).errors.some((e) => /ESPERADO.*vazia/.test(e)));
assert.ok(spec.lintSpec({ 'bugfix.md': '## HOJE\nx' }).errors.some((e) => /INALTERADO/.test(e)));
// o próprio modelo só pode reclamar dos placeholders, nunca do formato
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'specs-modelo');
const modelo = Object.fromEntries(fs.readdirSync(dir).filter((f) => /\.(md|ya?ml)$/.test(f) && f !== 'README.md').map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
assert.deepEqual(spec.lintSpec(modelo).errors, []);

// migration destrutiva
assert.equal(spec.isMigrationPath('prisma/migrations/2026_x/migration.sql'), true);
assert.equal(spec.isMigrationPath('migrations/20260518_prefix.ts'), true);
assert.equal(spec.isMigrationPath('prisma/migrations/migration_lock.toml'), false);
assert.equal(spec.isMigrationPath('src/migrations.ts'), false);
assert.deepEqual(spec.destructiveOps('ALTER TABLE "a" ADD COLUMN "b" INT;\nCREATE INDEX x ON a(b);'), []);
assert.deepEqual(spec.destructiveOps('-- DROP TABLE antigo\nALTER TABLE "a" DROP COLUMN "b";').map((o) => [o.op, o.line]), [['DROP', 2]]);
assert.equal(spec.destructiveOps('ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE TEXT;')[0].op, 'troca de tipo de coluna');
assert.equal(spec.destructiveOps('await knex.schema.alterTable("t", (t) => t.dropColumn("x"))')[0].op, 'drop/rename (knex)');
assert.deepEqual(spec.destructiveOps('ALTER TABLE "tax_rules" DROP CONSTRAINT "x";'), []);

// sprint de 15 dias
const sprint = require('./sprint.js');
const it = (startDate, duration) => ({ startDate, duration });
assert.deepEqual(sprint.plan([it('2026-11-15', 14), it('2026-11-29', 14)], '2026-11-16'), []);
assert.deepEqual(sprint.plan([it('2026-11-15', 14)], '2026-11-16'), [it('2026-11-29', 14)]);
assert.deepEqual(sprint.plan([it('2026-11-15', 14), it('2026-11-29', 14)], '2026-11-29'), [it('2026-12-13', 14)]);
assert.deepEqual(sprint.plan([it('2026-11-15', 14)], '2027-01-05'), [it('2026-12-27', 14), it('2027-01-10', 14)]);
assert.deepEqual(sprint.plan([], '2026-11-18'), [it('2026-11-15', 14), it('2026-11-29', 14)]);

// benchmark
const bm = require('./benchmark.js');
const pr = (o) => ({ number: 1, title: 'feat(x): y', body: '## Como testar\nabre', createdAt: '2026-11-16T10:00:00Z', mergedAt: '2026-11-17T10:00:00Z',
  baseRefName: 'dev', headRefName: 'feat/1-y', repository: { name: 'vzla-cashback' }, author: { login: 'a' },
  reviews: { nodes: [{ author: { login: 'b' }, submittedAt: '2026-11-16T14:00:00Z' }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...o });
const sm = bm.summarize({
  items: [{ status: 'Done', state: 'CLOSED' }, { status: 'QA', state: 'OPEN' }, { status: 'Done', state: 'OPEN' }],
  prs: [pr({}), pr({ number: 2, body: '## Como testar\n', reviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }),
    pr({ number: 3, baseRefName: 'main', headRefName: 'dev', title: 'chore(release): dev → main' }), pr({ number: 4, baseRefName: 'main', headRefName: 'hotfix/9-x' })],
});
assert.deepEqual(sm.byKind, { trabalho: 2, release: 1, hotfix: 1, sync: 0, outro: 0 });
assert.equal(sm.carried, 1);
assert.equal(sm.leadMedianH, 24);
assert.equal(sm.firstReviewMedianH, 4);
assert.deepEqual([sm.semReview.length, sm.vermelho.length, sm.semComoTestar.length], [1, 1, 1]);
assert.match(bm.render({ startDate: '2026-11-15' }, '2026-11-28', sm), /Sprint de 15\/11\/2026 a 28\/11\/2026/);

// seção do CLAUDE.md
const ag = require('./agentes.js');
const once = ag.upsert('# Repo\n\nregras locais\n', 'vzla-cashback');
assert.ok(once.startsWith('# Repo\n\nregras locais\n\n<!-- vzla:fluxo -->'));
assert.equal(ag.upsert(once, 'vzla-cashback'), once);
assert.equal(ag.upsert(once.replace('## Fluxo Vizzela', '## velho'), 'vzla-cashback'), once);
assert.match(ag.section('vzla-lojas-admin'), /src\/mocks/);
assert.match(ag.section('vzla-cashback'), /docs-json/);
assert.throws(() => ag.section('repo-desconhecido'));


// fases do board (Triagem → Spec → Todo)
assert.equal(lib.isSpecOnly(['specs/150-cupom/requisitos.md', 'apps/api/specs/150-cupom/contrato.yaml']), true);
assert.equal(lib.isSpecOnly(['specs/150-cupom/requisitos.md', 'src/main.ts']), false);
assert.equal(lib.isSpecOnly([]), false);
assert.equal(lib.parentStatusKey({ specOnly: true, preview: 'https://x' }), 'spec');
assert.equal(lib.parentStatusKey({ specOnly: false, preview: 'https://x' }), 'qa');
assert.equal(lib.parentStatusKey({ specOnly: false, preview: null }), 'inProgress');
assert.equal(lib.issuePhaseKey({ action: 'assigned', currentStatus: 'Backlog' }), 'triagem');
assert.equal(lib.issuePhaseKey({ action: 'assigned', currentStatus: null }), 'triagem');
assert.equal(lib.issuePhaseKey({ action: 'assigned', currentStatus: 'In progress' }), null);
assert.equal(lib.issuePhaseKey({ action: 'labeled', label: 'spec', currentStatus: 'Triagem' }), 'spec');
assert.equal(lib.issuePhaseKey({ action: 'labeled', label: 'bugfix-spec', currentStatus: 'Backlog' }), 'spec');
assert.equal(lib.issuePhaseKey({ action: 'labeled', label: 'spec', currentStatus: 'Todo' }), null);
assert.equal(lib.issuePhaseKey({ action: 'labeled', label: 'plan', currentStatus: 'Triagem' }), null);

// plano da spec (tabela Branches do tarefas.md)
const plan = require('./spec-plan.js');
assert.equal(plan.slugify('Cashback: APIs do painel (hub) e do PDV'), 'cashback-apis-do-painel-hub-e-do-pdv');
assert.equal(plan.slugify('[FEATURE] Ação rápida'), 'acao-rapida');
assert.equal(plan.slugify('Um título bem comprido que passa do limite de quarenta caracteres'), 'um-titulo-bem-comprido-que-passa-do');
assert.equal(plan.slugify('!!!'), 'spec');
assert.equal(plan.backRepoFromLabels([{ name: 'feature' }, { name: 'repo:vzla-cashback' }]), 'vzla-cashback');
assert.equal(plan.backRepoFromLabels(['repo:vzla-panel-hub', 'repo:vzla-cashback']), 'vzla-cashback');
assert.equal(plan.backRepoFromLabels(['repo:vzla-panel-hub']), null);
assert.equal(plan.backRepoFromLabels(['repo:vzla-cashback', 'repo:vzla-tracking']), null);
const tarefas = [
  '# Tarefas', '', '## Branches', '',
  '| Onda | Repo | Branch | Issue | Dono | Requisitos |',
  '|---|---|---|---|---|---|',
  '| 2 | vizzela-labs/vzla-cashback | `feat/176-admin-api` | #176 | @higorless | R1–R6 |',
  '| 2 | vzla-panel-hub | feat/174-painel-cashback | vzla-backlog#174 | Moredy | R7 |',
  '| 3 | todos | — | | | integração |',
  '', '## Onda 1', '- [ ] x',
].join('\n');
const parsed = plan.parseBranches(tarefas);
assert.deepEqual(parsed.errors, []);
assert.deepEqual(parsed.rows.map((r) => [r.repo, r.branch, r.issue, r.dono]),
  [['vzla-cashback', 'feat/176-admin-api', 176, 'higorless'], ['vzla-panel-hub', 'feat/174-painel-cashback', 174, 'Moredy']]);
assert.deepEqual(plan.owners(parsed.rows), ['higorless', 'Moredy']);
assert.match(plan.parseBranches('- [ ] a').errors[0], /Branches/);
assert.match(plan.parseBranches('## Branches\n| Repo | Branch |\n|---|---|\n| vzla-x | minha-branch |').errors[0], /fora do padrão/);
assert.match(plan.parseBranches('## Branches\n| Repo | Branch |\n|---|---|\n| a, b | feat/1-x |').errors[0], /repo inválido/);
assert.match(plan.parseBranches('## Branches\n| Repo | Branch |\n|---|---|\n| todos | — |').errors[0], /nenhuma branch/);
assert.ok(spec.lintSpec({ 'requisitos.md': '- O SISTEMA DEVE x.', 'tarefas.md': '- [ ] a' }).errors.some((e) => /Branches/.test(e)));
const pr1 = plan.promptFor({ back: 'vzla-cashback', dir: 'specs/176-cashback', row: parsed.rows[1] });
assert.match(pr1, /gh api "repos\/vizzela-labs\/vzla-cashback\/contents\/specs\/176-cashback/);
assert.match(pr1, /Issue-mãe: vzla-backlog#174/);
assert.doesNotMatch(plan.promptFor({ back: 'vzla-cashback', dir: 'specs/176-cashback', row: parsed.rows[0] }), /gh api/);

console.log('ok: todos os testes passaram');
