import { useMemo } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros } from '../contexto';
import { numero, reais } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { condicaoDado, faixaAnos, fonteSaude, rotuloCondicao } from '../saude_comum';
import { AvisoAno, numero1Local, referencia, useSaude } from './SaudeDatasus';

/** Grupos de procedimentos da tabela SIGTAP (os dois primeiros dígitos do procedimento) e a coluna de cada um. */
const GRUPOS: [string, string, () => string][] = [
  ['promocao', '01', () => t('Promoção e prevenção em saúde', 'Health promotion and prevention')],
  ['diagnostico', '02', () => t('Diagnóstico (exames e imagem)', 'Diagnosis (tests and imaging)')],
  ['clinicos', '03', () => t('Procedimentos clínicos (consultas e terapias)', 'Clinical procedures (visits and therapies)')],
  ['cirurgicos', '04', () => t('Procedimentos cirúrgicos', 'Surgical procedures')],
  ['transplantes', '05', () => t('Transplantes de órgãos, tecidos e células', 'Organ, tissue and cell transplants')],
  ['medicamentos', '06', () => t('Medicamentos (componente especializado)', 'Medicines (specialised component)')],
  ['orteses', '07', () => t('Órteses, próteses e materiais especiais', 'Orthoses, prostheses and special materials')],
  ['complementares', '08', () => t('Ações complementares da atenção à saúde', 'Complementary health care actions')],
];

const razao = (a: number | null, b: number | null) => (a === null || !b ? null : a / b);

/**
 * Produção ambulatorial do SUS (SIA, grupo PA): procedimentos aprovados e valor aprovado, pelo município do estabelecimento
 * e pela competência de apresentação. A unidade é procedimentos (não pessoas) e o valor é o da tabela do SUS.
 */
export function SaudeAmbulatorial() {
  const { ano, semAno, escopo, rotulo, temDados, fontes, meta } = useSaude();
  const serie = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  const dados = serie.dados ?? [];
  const cobertos = fontes.sia?.anos ?? [];
  const ref = referencia(cobertos, ano, semAno);
  const a = dados.find((r) => Number(r.ano) === ref);
  const anosS = dados.map((r) => Number(r.ano)).filter((x) => cobertos.includes(x));
  const doSia = dados.filter((r) => cobertos.includes(Number(r.ano)));
  const cond = a ? condicaoDado('amb_qtd', num(a.amb_qtd), ref, fontes) : null;
  const qtd = num(a?.amb_qtd);
  const valor = num(a?.amb_valor_real);
  const valorMedio = razao(valor, qtd);
  const porHab = razao(qtd, num(a?.populacao));
  const reais2 = (v: number | null) => (v === null ? '–' : reais(v));

  const grupos = GRUPOS.map(([k, cod, nome]) => ({ k, cod, nome: `${cod} · ${nome()}`, qtd: num(a?.[`amb_${k}_qtd`]), valor: num(a?.[`amb_${k}_valor_real`]) }));
  const opcaoQtd = useMemo(() => linhas(anosS, [{ nome: t('Procedimentos aprovados', 'Approved procedures'), valores: doSia.map((r) => num(r.amb_qtd)) }], (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoValor = useMemo(() => linhas(anosS, [{ nome: t('Valor aprovado (R$ de 2025)', 'Approved value (R$ of 2025)'), valores: doSia.map((r) => num(r.amb_valor_real)) }], (v) => reais(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoGrupoQtd = useMemo(() => barras(grupos.map((g) => g.nome), grupos.map((g) => g.qtd), (v) => numero(v), true), [serie.dados, ref]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoGrupoValor = useMemo(() => barras(grupos.map((g) => g.nome), grupos.map((g) => g.valor), (v) => reais(v), true), [serie.dados, ref]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalGrupos = grupos.reduce((s, g) => s + (g.qtd ?? 0), 0);

  if (!temDados) return <><h2 className="titulo-pagina">{t('Produção ambulatorial', 'Outpatient output')}</h2><p className="vazio">{t('Os dados de saúde ainda não foram publicados.', 'Health data have not been published yet.')}</p></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Produção ambulatorial do SUS', 'SUS outpatient output')}</h2>
      <p className="subtitulo">{rotulo} · SIA {ref ?? t('fora da cobertura', 'outside coverage')} · {t('procedimentos aprovados, pelo município do estabelecimento', 'approved procedures, by municipality of the facility')} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros comUltimo ultimoPadrao anosCobertos={cobertos} />
      <AvisoAno ano={ano} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !serie.dados?.length && t('Sem registros para este recorte.', 'No records for this scope.')} />
      {serie.dados && serie.dados.length > 0 && !('amb_qtd' in serie.dados[0]) && (
        <p className="aviso" role="status">{t('A produção ambulatorial (SIA) é indisponível nesta versão dos dados.', 'Outpatient output (SIA) is unavailable in this data version.')}</p>
      )}
      {ref === null && serie.dados && ('amb_qtd' in (serie.dados[0] ?? {})) && (
        <p className="aviso" role="status">{t(`Ano fora da cobertura: o SIA tem dados de ${faixaAnos(cobertos)}.`, `Year outside coverage: SIA has data for ${faixaAnos(cobertos)}.`)}</p>
      )}
      {a && (
        <>
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Procedimentos aprovados', 'Approved procedures')} valor={qtd === null ? t('sem registro', 'no record') : numero(qtd)}
              nota={`${t('procedimentos (não pessoas)', 'procedures (not people)')} · ${ref}${cond === 'zero_registrado' ? ` · ${rotuloCondicao(cond)}` : ''}`}
              dica={<Dica rotulo={t('Como ler', 'How to read')}>{t('Quantidade aprovada para pagamento pelo SUS: cada consulta, exame, sessão ou cirurgia ambulatorial é um procedimento. Uma pessoa gera vários.', 'Quantity approved for payment by SUS: each visit, test, session or outpatient surgery is a procedure. One person generates several.')}</Dica>} />
            <Kpi rotulo={t('Valor aprovado', 'Approved value')} valor={reais2(valor)} nota={`${t('R$ de 2025, tabela do SUS (SIGTAP)', 'R$ of 2025, SUS table (SIGTAP)')} · ${ref}`}
              dica={<Dica rotulo={t('Como ler', 'How to read')}>{t('Valor da tabela de procedimentos do SUS aprovado para pagamento, em reais de 2025 pelo IPCA acumulado (dez/dez). Não é o custo do serviço nem o gasto do município.', 'SUS procedure table value approved for payment, in 2025 reais using the accumulated IPCA (Dec/Dec). It is not the cost of the service or municipal spending.')}</Dica>} />
            <Kpi rotulo={t('Valor médio por procedimento', 'Average value per procedure')} valor={reais2(valorMedio)} nota={`${t('R$ de 2025 por procedimento', 'R$ of 2025 per procedure')} · ${ref}`} />
            <Kpi rotulo={t('Procedimentos por habitante', 'Procedures per inhabitant')} valor={porHab === null ? '–' : numero1Local(porHab)}
              nota={t('estabelecimento ÷ população residente: polos regionais ficam altos', 'facility ÷ resident population: regional hubs appear high')} />
          </div>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Procedimentos por grupo (SIGTAP)', 'Procedures by group (SIGTAP)')} desc={`${rotulo} · ${ref} · ${t('procedimentos aprovados', 'approved procedures')}`}
              tabela={<TabelaGrupos grupos={grupos} total={totalGrupos} ref_={ref!} rotulo={rotulo} versao={meta.geradoEm} />}>
              <Grafico opcao={opcaoGrupoQtd} nome="saude_ambulatorial_grupos_qtd" altura={360} />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Valor aprovado por grupo (R$ de 2025)', 'Approved value by group (R$ of 2025)')} desc={`${rotulo} · ${ref}`}>
              <Grafico opcao={opcaoGrupoValor} nome="saude_ambulatorial_grupos_valor" altura={360} />
            </CartaoGrafico>
          </div>
        </>
      )}
      {serie.dados && anosS.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Procedimentos aprovados por ano', 'Approved procedures per year')} desc={`${rotulo} · ${t('competência de apresentação', 'submission competence')}`}
            tabela={<TabelaAmb anos={anosS} dados={doSia} rotulo={rotulo} cobertos={cobertos} versao={meta.geradoEm} />}>
            <Grafico opcao={opcaoQtd} nome="saude_ambulatorial_qtd" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Valor aprovado por ano (R$ de 2025)', 'Approved value per year (R$ of 2025)')} desc={`${rotulo} · ${t('tabela do SUS', 'SUS table')}`}>
            <Grafico opcao={opcaoValor} nome="saude_ambulatorial_valor" />
          </CartaoGrafico>
        </div>
      )}
      <p className="nota-base">
        {t('Pelo município do estabelecimento e pela competência de apresentação: atendimentos de meses anteriores apresentados depois entram no ano da apresentação. Só o SUS (não inclui a saúde suplementar nem a privada). O valor é o da tabela do SUS e não se soma à despesa em saúde das finanças como se fosse a mesma coisa.',
          'By municipality of the facility and submission competence: care from earlier months submitted later enters the year of submission. SUS only (it excludes supplementary and private care). The value is the SUS table value and is not added to health spending from the finances as if it were the same thing.')}
      </p>
      <p className="nota-base">
        {t('Procedimentos de pacientes de outro município: a proporção ainda não é publicada. O agregado atual tem a parte aprovada de residentes de outro município, mas não tem o total com município de residência válido, que é o denominador correto, nem permite informar a completude desse campo. Será publicada quando houver esse denominador.',
          'Procedures for patients from another municipality: the share is not published yet. The current aggregate has the approved part for residents of another municipality, but not the total with a valid residence municipality, which is the correct denominator, and it does not allow reporting the completeness of that field. It will be published once that denominator exists.')}
      </p>
    </>
  );
}

function TabelaGrupos({ grupos, total, ref_, rotulo, versao }: {
  grupos: { k: string; cod: string; nome: string; qtd: number | null; valor: number | null }[]; total: number; ref_: number; rotulo: string; versao: string;
}) {
  return (
    <TabelaSerie nome={`saude_ambulatorial_grupos_${ref_}`} anos={grupos.map((g) => g.nome)} primeiraColuna={t('Grupo SIGTAP', 'SIGTAP group')} semAnoSelecionado valoresReais
      conteudo={t(`distribuição por grupo SIGTAP do ano exibido (${ref_})`, `distribution by SIGTAP group for the year shown (${ref_})`)} colunas={[
      { titulo: t('Procedimentos aprovados', 'Approved procedures'), valores: grupos.map((g) => g.qtd), formato: numero },
      { titulo: t('Participação nos procedimentos', 'Share of procedures'), valores: grupos.map((g) => (total && g.qtd !== null ? g.qtd / total : null)), formato: (v) => (v === null ? '–' : `${numero1Local(100 * v)}%`) },
      { titulo: t('Valor aprovado (R$ de 2025)', 'Approved value (R$ of 2025)'), valores: grupos.map((g) => g.valor), formato: (v) => reais(v) },
    ]} metadados={[[t('Recorte', 'Scope'), rotulo], [t('Ano exibido', 'Year shown'), String(ref_)], [t('Unidade', 'Unit'), t('procedimentos aprovados e reais de 2025', 'approved procedures and 2025 reais')],
      [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), versao]]} />
  );
}

function TabelaAmb({ anos, dados, rotulo, cobertos, versao }: { anos: number[]; dados: Linha[]; rotulo: string; cobertos: number[]; versao: string }) {
  return (
    <TabelaSerie nome="saude_ambulatorial" anos={anos} valoresReais="parcial" colunas={[
      { titulo: t('Procedimentos aprovados', 'Approved procedures'), valores: dados.map((r) => num(r.amb_qtd)), formato: numero },
      { titulo: t('Valor aprovado (R$ de 2025)', 'Approved value (R$ of 2025)'), valores: dados.map((r) => num(r.amb_valor_real)), formato: (v) => reais(v) },
      { titulo: t('Valor aprovado (R$ correntes)', 'Approved value (current R$)'), valores: dados.map((r) => num(r.amb_valor)), formato: (v) => reais(v) },
      { titulo: t('Valor médio por procedimento (R$ de 2025)', 'Average value per procedure (R$ of 2025)'), valores: dados.map((r) => razao(num(r.amb_valor_real), num(r.amb_qtd))), formato: (v) => reais(v) },
      ...GRUPOS.map(([k, cod, nome]) => ({ titulo: `${cod} · ${nome()} (${t('procedimentos', 'procedures')})`, valores: dados.map((r) => num(r[`amb_${k}_qtd`])), formato: numero })),
    ]} metadados={[[t('Recorte', 'Scope'), rotulo], [t('Unidade', 'Unit'), t('procedimentos aprovados (não pessoas)', 'approved procedures (not people)')],
      [t('Território', 'Territory'), t('município do estabelecimento', 'municipality of the facility')], [t('Período', 'Period'), `${faixaAnos(cobertos)} (${t('competência de apresentação', 'submission competence')})`],
      [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), versao]]} />
  );
}
