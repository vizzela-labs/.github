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

console.log('ok: todos os testes passaram');
