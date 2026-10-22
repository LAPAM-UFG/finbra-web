import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = (process.env.DATA_DIR ?? path.join(raiz, 'data')).replaceAll('\\', '/');

const instancia = await DuckDBInstance.create(':memory:', { threads: '4' });
const conexao = await instancia.connect();

const silver = `${DATA_DIR}/silver`;
const gold = `${DATA_DIR}/gold`;

await conexao.run(`
  CREATE VIEW dca AS SELECT * FROM read_parquet('${silver}/dca/*.parquet');
  CREATE VIEW contas AS SELECT * FROM read_parquet('${silver}/contas/*.parquet');
  CREATE VIEW populacao AS SELECT * FROM read_parquet('${silver}/populacao/*.parquet');
  CREATE VIEW entes AS SELECT * FROM read_parquet('${silver}/entes.parquet');
  CREATE VIEW indicadores AS SELECT * FROM read_parquet('${gold}/indicadores.parquet');
  CREATE VIEW faixas AS SELECT * FROM read_parquet('${gold}/faixas.parquet');
  CREATE VIEW ipca AS SELECT * FROM read_parquet('${gold}/ipca.parquet');
`);

// Ente-anos atípicos (fora dos agregados). Sem o arquivo, nada é excluído.
const alertas = `${gold}/alertas.parquet`;
await conexao.run(
  fs.existsSync(alertas)
    ? `CREATE VIEW alertas AS SELECT * FROM read_parquet('${alertas}');
       CREATE TABLE excluidos AS SELECT DISTINCT exercicio, cod_ibge FROM alertas;`
    : `CREATE TABLE alertas (exercicio INTEGER, cod_ibge INTEGER, nome VARCHAR, uf VARCHAR, esfera VARCHAR,
         indicador VARCHAR, valor DOUBLE, mediana DOUBLE, razao DOUBLE, motivo VARCHAR);
       CREATE TABLE excluidos (exercicio INTEGER, cod_ibge INTEGER);`,
);

/** Arquivo da silver de um exercício (lê só o ano pedido, sem varrer os outros). */
export const dcaAno = (ano) => `read_parquet('${silver}/dca/exercicio=${Number(ano)}.parquet')`;

const converter = (v) => (typeof v === 'bigint' ? Number(v) : v);

export async function consultar(sql, parametros = {}) {
  const resultado = await conexao.runAndReadAll(sql, parametros);
  return resultado.getRowObjectsJS().map((linha) =>
    Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, converter(v)])),
  );
}
