import { useMemo, type ReactNode } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros } from '../contexto';
import { numero, pct } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { anosDaColuna, condicaoDado, faixaAnos, fonteSaude, rotuloCondicao, type FontesMeta } from '../saude_comum';
import { BlocoAps } from './SaudeAps';
import { AvisoAno, referencia, useSaude } from './SaudeDatasus';

const razao = (a: number | null, b: number | null) => (a === null || !b ? null : a / b);

/** Valor de uma coluna num ano coberto pela fonte; fora da cobertura ou sem registro, o texto diz qual dos dois. */
function celula(col: string, valor: number | null, ano: number | null, fontes: FontesMeta, formato: (v: number) => string = numero) {
  if (ano === null) return t('fora da cobertura', 'outside coverage');
  const c = condicaoDado(col, valor, ano, fontes);
  if (c === 'ausente') return t('sem registro', 'no record');
  if (c === 'fora_cobertura') return t('fora da cobertura', 'outside coverage');
  return c === 'zero_registrado' ? `${formato(0)} (${rotuloCondicao(c)})` : formato(valor as number);
}

function Painel({ titulo, dica, children }: { titulo: string; dica: string; children: ReactNode }) {
  return (
    <section className="cartao">
      <h3>{titulo} <Dica rotulo={t('Como ler', 'How to read')}>{dica}</Dica></h3>
      <div className="kpis">{children}</div>
    </section>
  );
}

/**
 * Rede e acesso ao SUS: as internações dos moradores do município ao lado das realizadas pelos hospitais do município,
 * com a rede do CNES (leitos SUS, UBS e as três medidas de médicos, cada uma com a sua regra de agregação).
 */
export function SaudeRede() {
  const { ano, semAno, escopo, rotulo, temDados, fontes, municipio, uf, f, meta } = useSaude();
  const serie = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  // município ignorado (sem município válido): só existe em UF e Brasil, e entra nos totais; aqui sai à parte
  const ignorados = useApi<Linha[]>(temDados && !municipio ? 'saude_ignorados' : null, { uf: uf ?? undefined });
  const dados = serie.dados ?? [];
  const refSih = referencia(fontes.sih?.anos ?? [], ano, semAno);
  const refCnes = referencia(fontes.cnes?.anos ?? [], ano, semAno);
  const sih = dados.find((r) => Number(r.ano) === refSih);
  const ign = (ignorados.dados ?? []).find((r) => Number(r.ano) === refSih);
  const anosS = dados.map((r) => Number(r.ano));
  const cobSih = fontes.sih?.anos ?? [];
  const cobCnes = fontes.cnes?.anos ?? [];
  const noSih = (c: string) => celula(c, num(sih?.[c]), refSih, fontes);
  // cada medida do CNES tem a sua cobertura: médicos só desde 2007, leitos e estabelecimentos desde 2006
  const refCol = (c: string) => referencia(anosDaColuna(c, fontes), ano, semAno);
  const noCnes = (c: string) => { const a = refCol(c); return celula(c, num(dados.find((r) => Number(r.ano) === a)?.[c]), a, fontes); };
  const pctDe = (n: string, d: string) => (refSih === null ? t('fora da cobertura', 'outside coverage') : pct(razao(num(sih?.[n]), num(sih?.[d])), 1));

  // em UF e Brasil os totais somam os municípios do recorte: os títulos dizem isso e as internações entre municípios da mesma UF também contam
  const recorte = !municipio;
  const tMoradores = recorte ? t('Moradores dos municípios do recorte', 'Residents of the scope’s municipalities') : t('Moradores do município', 'Residents of the municipality');
  const tHospitais = recorte ? t('Hospitais dos municípios do recorte', 'Hospitals of the scope’s municipalities') : t('Hospitais do município', 'Hospitals of the municipality');

  const opcao = useMemo(() => linhas(anosS, [
    { nome: t('Internações de moradores', 'Admissions of residents'), valores: dados.map((r) => num(r.int_total)) },
    { nome: recorte ? t('Internações realizadas pelos hospitais dos municípios do recorte', 'Admissions by the hospitals of the scope’s municipalities') : t('Internações realizadas pelos hospitais do município', 'Admissions by the municipality’s hospitals'), valores: dados.map((r) => num(r.int_atendidas)) },
  ], (v) => numero(v)), [serie.dados, recorte]); // eslint-disable-line react-hooks/exhaustive-deps

  // médicos: só a medida por vínculo principal e a de vínculos somam em UF e Brasil; "atuam no município" é por município
  const medicosAtuam = municipio ? noCnes('cnes_medicos_no_municipio') : t('não se soma por UF ou Brasil', 'not summed by state or Brazil');

  if (!temDados) return <><h2 className="titulo-pagina">{t('Rede e acesso ao SUS', 'Network and access to SUS')}</h2><p className="vazio">{t('Os dados de saúde ainda não foram publicados.', 'Health data have not been published yet.')}</p></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Rede e acesso ao SUS', 'Network and access to SUS')}</h2>
      <p className="subtitulo">{rotulo} · {semAno ? t('último ano de cada fonte', 'latest year of each source') : ano} · SIH: {refSih ?? t('fora da cobertura', 'outside coverage')} · CNES: {refCnes ?? t('fora da cobertura', 'outside coverage')} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros comUltimo ultimoPadrao />
      <AvisoAno ano={ano} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !serie.dados?.length && t('Sem registros para este recorte.', 'No records for this scope.')} />
      {serie.dados && serie.dados.length > 0 && !('int_atendidas' in serie.dados[0]) && (
        <p className="aviso" role="status">{t('Os dois pontos de vista das internações (moradores e hospitais do município) são indisponíveis nesta versão dos dados.', 'The two views of admissions (residents and municipality hospitals) are unavailable in this data version.')}</p>
      )}
      {serie.dados && serie.dados.length > 0 && 'int_atendidas' in serie.dados[0] && (
        <>
          <p className="nota-base"><strong>{t('Internações do SUS: onde moram × onde foram feitas', 'SUS admissions: where people live × where they were done')}</strong> · SIH {refSih ?? t('fora da cobertura', 'outside coverage')}{refSih === null ? ` (${faixaAnos(cobSih)})` : ''}</p>
          {recorte && (
            <p className="nota-base">{t('Em UF e Brasil, os números somam os municípios do recorte. Os deslocamentos entre municípios da mesma UF também contam: uma internação de morador de um município feita no hospital de outro conta como "feita fora do município" e como "de morador de outro município", ainda que os dois fiquem na mesma UF.',
              'For a state or Brazil, the numbers add up the municipalities of the scope. Moves between municipalities of the same state also count: an admission of a resident of one municipality done in another municipality’s hospital counts as "done outside the municipality" and as "of a resident of another municipality", even if both are in the same state.')}</p>
          )}
          <div className="grade-2">
            <Painel titulo={tMoradores}
              dica={t('Internações pagas pelo SUS (AIH tipo 1) de pessoas que moram no município, onde quer que tenham sido internadas. Entram as feitas em hospitais de outros municípios.', 'SUS-paid admissions (type-1 AIH) of people who live in the municipality, wherever they were admitted. It includes those in hospitals of other municipalities.')}>
              <Kpi rotulo={t('Internações dos moradores', 'Admissions of residents')} valor={noSih('int_total')} nota={refSih ? `SIH ${refSih}` : undefined} />
              <Kpi rotulo={t('Feitas fora do município', 'Done outside the municipality')} valor={noSih('int_fora')}
                nota={t(`${pctDe('int_fora', 'int_total')} das internações dos moradores`, `${pctDe('int_fora', 'int_total')} of residents’ admissions`)} />
            </Painel>
            <Painel titulo={tHospitais}
              dica={t('Internações feitas nos hospitais do município, de quem for morador. Para uma UF ou o Brasil, soma os hospitais dos municípios; "de outros municípios" inclui moradores de outros municípios da mesma UF.', 'Admissions done in the municipality’s hospitals, of any resident. For a state or Brazil, it adds up the hospitals of its municipalities; "from other municipalities" includes residents of other municipalities in the same state.')}>
              <Kpi rotulo={t('Internações realizadas pelos hospitais', 'Admissions done by the hospitals')} valor={noSih('int_atendidas')} nota={refSih ? `SIH ${refSih}` : undefined} />
              <Kpi rotulo={t('De moradores de outros municípios', 'Of residents of other municipalities')} valor={noSih('int_atendidas_de_fora')}
                nota={t(`${pctDe('int_atendidas_de_fora', 'int_atendidas')} das internações dos hospitais`, `${pctDe('int_atendidas_de_fora', 'int_atendidas')} of the hospitals’ admissions`)} />
            </Painel>
          </div>
          <p className="nota-base">
            {t('Os dois pontos de vista não se misturam numa mesma razão: um ranking de "fora do município" é sobre os moradores; um ranking de "atende pacientes de fora" é sobre quem recebe. Os hospitais de um município que recebe muitos pacientes de fora aparecem com muitas internações atendidas.',
              'The two views are not mixed in one ratio: an "outside the municipality" ranking is about residents; a "serves outside patients" ranking is about who receives them. Hospitals of a municipality that receives many outside patients appear with many admissions served.')}
          </p>
          {!municipio && refSih !== null && (
            <p className="aviso" role="note">
              {ign && num(ign.int_total)
                ? t(`Município ignorado: ${numero(num(ign.int_total))} internações de residentes sem município válido (${numero(num(ign.int_fora))} apontadas como feitas fora do município) entram nos totais acima e nunca nos rankings de municípios.`,
                  `Unknown municipality: ${numero(num(ign.int_total))} admissions of residents without a valid municipality (${numero(num(ign.int_fora))} flagged as done outside the municipality) are inside the totals above and never in municipal rankings.`)
                : t('Município ignorado: sem registros neste ano e recorte.', 'Unknown municipality: no records in this year and scope.')}
            </p>
          )}

          <p className="nota-base"><strong>{t('Rede de saúde (CNES)', 'Health network (CNES)')}</strong> · CNES {refCnes ?? t('fora da cobertura', 'outside coverage')}{refCnes === null ? ` (${faixaAnos(cobCnes)})` : ''} · {t('retrato de dezembro, pelo município do estabelecimento', 'December snapshot, by municipality of the facility')}</p>
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Leitos SUS', 'SUS beds')} valor={noCnes('cnes_leitos_sus')} nota={refCnes ? t(`de ${noCnes('cnes_leitos')} existentes`, `of ${noCnes('cnes_leitos')} existing`) : undefined} />
            <Kpi rotulo={t('Unidades básicas de saúde (UBS)', 'Primary care units (UBS)')} valor={noCnes('cnes_ubs')} nota={t('posto de saúde e centro de saúde/unidade básica', 'health post and health center/basic unit')} />
            <Kpi rotulo={t('Médicos que atuam no município', 'Physicians who work in the municipality')} valor={medicosAtuam}
              dica={<Dica rotulo={t('Regra de agregação', 'Aggregation rule')}>{t('Cada médico é contado em todos os municípios onde tem vínculo: a mesma pessoa aparece em vários. Serve para ver quem atende no município; NÃO se soma por UF ou Brasil.', 'Each physician is counted in every municipality where they have a link: the same person appears in several. It shows who serves in the municipality; it is NOT summed by state or Brazil.')}</Dica>} />
            <Kpi rotulo={t('Médicos atribuídos pelo vínculo principal', 'Physicians assigned by main link')} valor={noCnes('cnes_medicos')}
              nota={t('cada pessoa uma vez; soma por UF e Brasil', 'each person once; sums by state and Brazil')}
              dica={<Dica rotulo={t('Regra de agregação', 'Aggregation rule')}>{t('Cada pessoa (CNS) conta uma só vez no ano, no município do vínculo de maior carga horária: a soma por UF e Brasil são pessoas distintas, mas municípios que dependem de profissionais itinerantes ficam subestimados.', 'Each person (CNS) counts once a year, in the municipality of the link with the most weekly hours: the sum by state and Brazil is distinct people, but municipalities that rely on itinerant professionals are understated.')}</Dica>} />
            <Kpi rotulo={t('Vínculos médicos', 'Physician links')} valor={noCnes('cnes_medicos_vinculos')}
              nota={t('vínculos, não pessoas; soma por UF e Brasil', 'links, not people; sums by state and Brazil')}
              dica={<Dica rotulo={t('Regra de agregação', 'Aggregation rule')}>{t('Conta vínculos de trabalho de médicos nos estabelecimentos: uma pessoa com dois vínculos conta duas vezes. Soma por UF e Brasil, mas não é número de médicos.', 'Counts physicians’ work links in facilities: a person with two links counts twice. It sums by state and Brazil, but it is not a number of physicians.')}</Dica>} />
          </div>
          <p className="nota-base">{t('A capacidade é do município onde fica o estabelecimento, enquanto as internações dos moradores são do município de residência: municípios com hospital regional têm leitos e médicos altos para a própria população porque atendem moradores de outros.', 'Capacity belongs to the municipality where the facility is, while residents’ admissions are by municipality of residence: municipalities with a regional hospital have high beds and physicians for their own population because they serve residents of others.')}</p>
        </>
      )}
      {temDados && <BlocoAps ano={ano} semAno={semAno} escopo={escopo} rotulo={rotulo} municipio={municipio} fontes={fontes} versao={meta.geradoEm} />}
      {serie.dados && serie.dados.length > 0 && (
        <CartaoGrafico titulo={recorte ? t('Internações: moradores × hospitais dos municípios do recorte', 'Admissions: residents × hospitals of the scope’s municipalities') : t('Internações: moradores × hospitais do município', 'Admissions: residents × municipality hospitals')} desc={`${rotulo} · ${t('SIH, por ano de competência', 'SIH, by competence year')}`}
          tabela={<TabelaSerie nome="saude_rede_acesso" anos={anosS} colunas={[
            { titulo: t('Internações dos moradores', 'Admissions of residents'), valores: dados.map((r) => num(r.int_total)), formato: numero },
            { titulo: t('Moradores internados fora do município', 'Residents admitted outside'), valores: dados.map((r) => num(r.int_fora)), formato: numero },
            { titulo: t('Internações realizadas pelos hospitais', 'Admissions done by hospitals'), valores: dados.map((r) => num(r.int_atendidas)), formato: numero },
            { titulo: t('Atendidas de moradores de outros municípios', 'Served for residents of other municipalities'), valores: dados.map((r) => num(r.int_atendidas_de_fora)), formato: numero },
            { titulo: t('Leitos SUS (dezembro)', 'SUS beds (December)'), valores: dados.map((r) => num(r.cnes_leitos_sus)), formato: numero },
            { titulo: t('UBS (dezembro)', 'UBS (December)'), valores: dados.map((r) => num(r.cnes_ubs)), formato: numero },
            { titulo: t('Médicos: vínculo principal', 'Physicians: main link'), valores: dados.map((r) => num(r.cnes_medicos)), formato: numero },
            { titulo: t('Vínculos médicos', 'Physician links'), valores: dados.map((r) => num(r.cnes_medicos_vinculos)), formato: numero },
            ...(municipio ? [{ titulo: t('Médicos que atuam no município', 'Physicians who work in the municipality'), valores: dados.map((r) => num(r.cnes_medicos_no_municipio)), formato: numero }] : []),
          ]} metadados={[
            [t('Recorte', 'Scope'), rotulo], [t('Fonte', 'Source'), fonteSaude()],
            [t('Cobertura', 'Coverage'), `SIH ${faixaAnos(cobSih)}; CNES ${faixaAnos(cobCnes)}`],
            [t('Unidade', 'Unit'), t('internações (SIH), estabelecimentos e leitos (CNES, dezembro), médicos (pessoas) e vínculos', 'admissions (SIH), facilities and beds (CNES, December), physicians (people) and links')],
            [t('Regra de agregação dos médicos', 'Physician aggregation rule'), t('"atuam no município" só por município; "vínculo principal" e "vínculos" somam por UF e Brasil', '"work in the municipality" only by municipality; "main link" and "links" sum by state and Brazil')],
            [t('Versão da base', 'Data version'), meta.geradoEm]]} />}>
          <Grafico opcao={opcao} nome="saude_rede_acesso" />
        </CartaoGrafico>
      )}
      {f.alvo === null && <p className="nota-base">{t('Escolha um município para ver os médicos que atuam nele.', 'Choose a municipality to see the physicians who work in it.')}</p>}
      <BotoesExportar nome="saude_rede_resumo" obter={() => ({
        colunas: [t('Medida', 'Measure'), t('Ano', 'Year'), t('Valor', 'Value'), t('Condição do dado', 'Data condition')],
        linhas: ([['int_total', refSih], ['int_fora', refSih], ['int_atendidas', refSih], ['int_atendidas_de_fora', refSih], ['cnes_leitos_sus', refCnes], ['cnes_ubs', refCnes],
          ['cnes_medicos', refCnes], ['cnes_medicos_vinculos', refCnes], ...(municipio ? [['cnes_medicos_no_municipio', refCnes]] : [])] as [string, number | null][]).map(([c, a]) => {
          const a2 = c.startsWith('cnes') ? refCol(c) : a;
          const r = dados.find((x) => Number(x.ano) === a2);
          const v = num(r?.[c]);
          return [c, a2, v, a2 === null ? rotuloCondicao('fora_cobertura') : rotuloCondicao(condicaoDado(c, v, a2, fontes))];
        }),
        metadados: [[t('Recorte', 'Scope'), rotulo], [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), meta.geradoEm]],
      })} />
    </>
  );
}

