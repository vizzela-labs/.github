// Formato da spec (specs/<nº>-slug/). Funções puras, testadas em test.js.
// O contrato (contrato.yaml) é validado à parte, pelo Redocly, no workflow.
const { stripComments } = require('./lib.js');

/** Pastas de spec tocadas por uma lista de arquivos: "specs/42-x" ou "apps/api/specs/42-x". */
function specDirs(paths) {
  const dirs = new Set();
  for (const p of paths) {
    const m = /^((?:.*\/)?specs\/[^/]+)\/./.exec(p);
    if (m && !/\/_[^/]*$/.test(m[1])) dirs.add(m[1]); // specs/_modelo é ignorada
  }
  return [...dirs].sort();
}

const REQ_RE = /\bO SISTEMA DEVE\b/i;
const EARS_RE = /^\s*(?:[-*]|\d+[.)])?\s*(?:\*\*[^*]+\*\*\s*)?(?:(?:QUANDO|SE|ENQUANTO|ONDE)\b.*?,\s*)?(?:ENT[AÃ]O\s+)?O SISTEMA DEVE\b/i;
const VAGUE_RE = /\b(r[aá]pid[oa]s?|adequad[oa]s?|amig[aá]vel|intuitiv[oa]|etc\.?|e\/ou|se poss[ií]vel|quando necess[aá]rio)\b/i;
const OPEN_RE = /\[(?:PERGUNTA|D[UÚ]VIDA|TODO)\b[^\]]*\]|\bTODO\b|\bTBD\b/i;

/** Seção "## Título" de um markdown (sem comentários). */
function section(md, title) {
  const lines = stripComments(md || '').split('\n');
  const re = new RegExp(`^#{1,4}\\s*${title}\\b`, 'i');
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    const h = l.match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

/**
 * Confere uma pasta de spec. `files` = { 'requisitos.md': '...', ... } (só os nomes, sem caminho).
 * Retorna { errors: [], warnings: [] }. Erro deixa o check vermelho; aviso só aparece no log.
 */
function lintSpec(files) {
  const errors = [];
  const warnings = [];
  const has = (n) => typeof files[n] === 'string';

  if (!has('requisitos.md') && !has('bugfix.md')) {
    errors.push('falta requisitos.md (feature) ou bugfix.md (correção)');
  }

  if (has('requisitos.md')) {
    const lines = stripComments(files['requisitos.md']).split('\n');
    const reqs = lines.filter((l) => REQ_RE.test(l));
    if (!reqs.length) {
      errors.push('requisitos.md sem nenhum requisito no formato "QUANDO <evento>, O SISTEMA DEVE <resposta>"');
    }
    for (const l of reqs) {
      if (!EARS_RE.test(l)) warnings.push(`requisitos.md: fora do formato EARS: "${l.trim().slice(0, 120)}"`);
      if (VAGUE_RE.test(l)) warnings.push(`requisitos.md: termo vago, troque por algo mensurável: "${l.trim().slice(0, 120)}"`);
    }
  }

  if (has('bugfix.md')) {
    for (const s of ['HOJE', 'ESPERADO', 'INALTERADO']) {
      const body = section(files['bugfix.md'], s);
      if (body === null) errors.push(`bugfix.md sem a seção "## ${s}"`);
      else if (!body) errors.push(`bugfix.md: a seção "## ${s}" está vazia`);
    }
    const esperado = section(files['bugfix.md'], 'ESPERADO') || '';
    if (/\?/.test(esperado)) {
      errors.push('bugfix.md: o ESPERADO ainda tem pergunta em aberto. Responda com quem pediu antes de aprovar a spec');
    }
  }

  for (const [name, text] of Object.entries(files)) {
    if (!/\.md$/.test(name)) continue;
    const open = stripComments(text).split('\n').filter((l) => OPEN_RE.test(l));
    for (const l of open) errors.push(`${name}: pendência em aberto: "${l.trim().slice(0, 120)}"`);
  }

  // A tabela "## Branches" é o plano de execução: no merge da spec, cada linha vira uma branch.
  if (has('tarefas.md')) {
    const { parseBranches } = require('./spec-plan.js'); // aqui dentro: spec-plan.js também usa este arquivo
    errors.push(...parseBranches(files['tarefas.md']).errors);
  }

  if (has('requisitos.md') && !has('tarefas.md')) warnings.push('sem tarefas.md (ok para quick-spec)');
  if (has('requisitos.md') && !has('contrato.yaml')) warnings.push('sem contrato.yaml (ok se a feature não muda API)');

  return { errors, warnings };
}

/** Arquivos de migration (Prisma, Knex, TypeORM, SQL solto em migrations/). */
const isMigrationPath = (p) => /(^|\/)(prisma\/)?migrations\/.+\.(sql|ts|js)$/.test(p) && !/migration_lock\.toml$/.test(p);

// O que apaga ou reescreve dado. Comentários SQL (-- …) e JS (// …) são ignorados.
const DESTRUCTIVE = [
  [/\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i, 'DROP'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bRENAME\s+(COLUMN|TO)\b/i, 'RENAME'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, 'troca de tipo de coluna'],
  [/\bSET\s+NOT\s+NULL\b/i, 'SET NOT NULL em coluna existente'],
  [/\.(dropTable|dropColumn|dropSchema|renameColumn|renameTable)\s*\(/, 'drop/rename (knex)'],
];
/** Operações destrutivas num arquivo de migration: [{ op, line }]. */
function destructiveOps(text) {
  const out = [];
  (text || '').split('\n').forEach((raw, i) => {
    const l = raw.replace(/--.*$/, '').replace(/\/\/.*$/, '');
    for (const [re, op] of DESTRUCTIVE) if (re.test(l)) out.push({ op, line: i + 1, text: raw.trim().slice(0, 140) });
  });
  return out;
}

module.exports = { specDirs, lintSpec, section, isMigrationPath, destructiveOps };
