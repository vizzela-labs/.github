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

console.log('ok: todos os testes passaram');
