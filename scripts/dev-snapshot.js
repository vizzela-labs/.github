// Snapshot produção → ambiente de dev, rodado DE DENTRO do app de dev no Coolify
// (post_deployment_command), porque o banco de dev só é alcançável pela rede interna.
//
// Variáveis (só durante o snapshot; apagar do app de dev logo depois):
//   PROD_COPY_DATABASE_URL  origem (produção). Aberta em transação READ ONLY e desfeita no fim.
//   DATABASE_URL            destino (o banco de dev do próprio app).
//   EXPECTED_DEV_DB         nome do banco de dev; o script recusa rodar em outro banco.
//   SNAPSHOT_SCHEMA         schema a copiar (padrão public).
//   SNAPSHOT_SKIP_TABLES    tabelas a ignorar, separadas por vírgula.
//   SNAPSHOT_SCRUB_PII      "true" troca dados pessoais de cliente (LGPD) e esvazia payloads JSON brutos.
// Colunas de token/secret/senha são sempre trocadas. A saída aparece no log do deploy
// (Coolify → Deployments → Show Debug Logs), na linha "SNAPSHOT:".
//
// Uso no Coolify: post_deployment_command =
//   node -e "eval(Buffer.from(process.env.SNAPSHOT_JS_B64,'base64').toString())"
// com SNAPSHOT_JS_B64 = este arquivo em base64.
const { Client } = require('pg');
const SKIP = new Set(['_prisma_migrations', ...(process.env.SNAPSHOT_SKIP_TABLES || '').split(',').map((s) => s.trim()).filter(Boolean)]);
const EXPECTED = process.env.EXPECTED_DEV_DB;
const q = (id) => '"' + id.replace(/"/g, '""') + '"';
const SCHEMA = process.env.SNAPSHOT_SCHEMA || 'public';

(async () => {
  const srcUrl = process.env.PROD_COPY_DATABASE_URL;
  if (!srcUrl) { console.log('SNAPSHOT: sem PROD_COPY_DATABASE_URL, nada feito'); return; }
  if (!EXPECTED) throw new Error('EXPECTED_DEV_DB não definido');
  if (srcUrl === process.env.DATABASE_URL) throw new Error('origem igual ao destino');
  const src = new Client({ connectionString: srcUrl });
  const dst = new Client({ connectionString: process.env.DATABASE_URL });
  await src.connect(); await dst.connect();
  const db = (await dst.query('select current_database() as db')).rows[0].db;
  if (db !== EXPECTED) throw new Error('destino não é o banco de dev esperado: ' + db);

  const tables = (await dst.query(
    "select table_name from information_schema.tables where table_schema=$1 and table_type='BASE TABLE' and table_name not like 'knex_migrations%' order by table_name", [SCHEMA],
  )).rows.map((r) => r.table_name).filter((t) => !SKIP.has(t));

  await src.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await dst.query('BEGIN');
  await dst.query("SET LOCAL session_replication_role = 'replica'"); // sem checar FKs durante a carga, só no dev
  if (tables.length) await dst.query('TRUNCATE ' + tables.map((t) => q(SCHEMA) + '.' + q(t)).join(',') + ' RESTART IDENTITY CASCADE');

  const colsOf = async (c, t) => (await c.query(
    "select column_name, data_type from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position", [SCHEMA, t],
  )).rows;
  const summary = [];
  for (const t of tables) {
    const dcols = await colsOf(dst, t);
    const scols = new Map((await colsOf(src, t)).map((c) => [c.column_name, c.data_type]));
    if (!scols.size) { summary.push(t + '=ausente-na-produção'); continue; }
    const common = dcols.filter((c) => scols.has(c.column_name));
    // Credenciais nunca saem da produção: colunas de texto com token/secret no nome são trocadas.
    // Com SNAPSHOT_SCRUB_PII=true, dados pessoais de cliente (LGPD) também. A troca usa um hash
    // curto do valor original: some o dado real, mas valores únicos continuam únicos.
    const SCRUB = /(token|secret|password|senha)/i;
    const PII = /(phone|telefone|celular|whatsapp|e_?mail|cpf|cnpj|document|documento|address|endereco|endereço|zip|cep|customer_name|first_name|last_name|nome_cliente)/i;
    const scrubPii = process.env.SNAPSHOT_SCRUB_PII === 'true';
    const isText = (dt) => ['text', 'character varying', 'character'].includes(dt);
    const select = common.map((c) => {
      const col = q(c.column_name);
      if (isText(c.data_type) && (SCRUB.test(c.column_name) || (scrubPii && PII.test(c.column_name)))) {
        return 'case when ' + col + " is null then null else 'dev-' || substr(md5(" + col + '), 1, 12) end as ' + col;
      }
      if (scrubPii && ['json', 'jsonb'].includes(c.data_type) && /(payload|raw)/i.test(c.column_name)) return 'null as ' + col;
      if (c.data_type === 'bytea') return "'\\x' || encode(" + col + ", 'hex') as " + col;
      return col;
    }).join(',');
    const list = common.map((c) => q(c.column_name)).join(',');
    const rows = (await src.query('select ' + select + ' from ' + q(SCHEMA) + '.' + q(t))).rows;
    for (let i = 0; i < rows.length; i += 200) {
      await dst.query(
        'insert into ' + q(SCHEMA) + '.' + q(t) + ' (' + list + ') select ' + list + ' from json_populate_recordset(null::' + q(SCHEMA) + '.' + q(t) + ', $1::json)',
        [JSON.stringify(rows.slice(i, i + 200))],
      );
    }
    summary.push(t + '=' + rows.length);
  }
  // Ajusta as sequences (serial/identity) para o maior id copiado.
  const seqs = (await dst.query(
    "select table_name, column_name, pg_get_serial_sequence(quote_ident($1) || '.' || quote_ident(table_name), column_name) as seq from information_schema.columns where table_schema=$1 and (column_default like 'nextval%' or is_identity='YES')", [SCHEMA],
  )).rows.filter((r) => r.seq && !SKIP.has(r.table_name));
  for (const s of seqs) {
    await dst.query('select setval($1, coalesce((select max(' + q(s.column_name) + ') from ' + q(SCHEMA) + '.' + q(s.table_name) + '), 0) + 1, false)', [s.seq]);
  }
  await dst.query('COMMIT'); await src.query('ROLLBACK');
  await src.end(); await dst.end();
  console.log('SNAPSHOT: ok ' + summary.join(' '));
})().catch((e) => { console.error('SNAPSHOT: erro', e.message); process.exit(1); });
