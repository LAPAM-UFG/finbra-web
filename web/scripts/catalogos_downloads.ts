/** Reaproveita os conceitos publicados; não harmoniza perguntas por semelhança de texto. */
import fs from 'node:fs';
import { INDICADORES, CAPITULOS, GRUPOS_ICSAP, anosDaColuna, anosDoIndicador, fonteDaColuna, fonteCurta, nomeContagem } from '../src/saude_comum';
import { CURADORIA } from '../src/munic_curadoria';
import { DICIONARIO } from '../src/trabalho_perfis';

const entrada = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const saude = entrada.parquet.find((p: {path: string}) => p.path === 'gold/saude/municipios.parquet');
const campos = Object.keys(saude.schema).filter(c => !['ano','cod_ibge','municipio','nome','uf'].includes(c));
const out = {
  versao: 1,
  base_gerado_em: entrada.manifesto.gerado_em,
  capitulos_cid: Object.fromEntries(CAPITULOS()),
  grupos_icsap: Object.fromEntries(GRUPOS_ICSAP.map(([n,nome])=>[n,nome()])),
  saude_campos: campos.map(c => ({campo:c,nome:nomeContagem(c),fonte:fonteDaColuna(c),anos:anosDaColuna(c,entrada.manifesto.fontes)})),
  saude_indicadores: INDICADORES.map(i => ({id:i.id,nome:i.nome(),descricao:i.nota(),unidade:i.unidade(),numerador:i.numerador,
    denominador:i.denominador,fator:i.fator,tipo:i.tipo,fonte:fonteCurta(i),anos:anosDoIndicador(i,entrada.manifesto.fontes)})),
  munic: CURADORIA.filter(i => i.pesquisa === 'munic'),
  rais_perfis: DICIONARIO,
};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({saude_campos:campos.length,saude_indicadores:out.saude_indicadores.length,munic:out.munic.length}));
