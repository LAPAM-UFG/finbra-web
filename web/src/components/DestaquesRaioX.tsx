import { useMemo } from 'react';
import { useSocial } from '../assistencia_dados';
import { periodoComparacao, textoComparacao } from '../comparacoes_apresentacao';
import type { GeografiaComparacao } from '../comparacoes_dados';
import { local, t } from '../idioma';
import { chaveRaio, formatarRaio, type CatalogoRaio, type IndicadorRaio, type MetaRaio, type RetratoRaio } from '../raio_x';
import { apresentacaoDestaque, destaquesRaio, gruposReferenciaDestaques, referenciaDestaque, referenciasDestaques } from '../raio_x_destaques';

export function DestaquesRaioX({ m, c, g, r, rede, ressalvas, focar }: {
  m: MetaRaio; c: CatalogoRaio; g: GeografiaComparacao; r: RetratoRaio; rede: string;
  ressalvas: boolean; focar: (i: IndicadorRaio) => void;
}) {
  const itens = useMemo(() => destaquesRaio(c, r.grupo, rede), [c, r.grupo, rede]);
  const grupos = gruposReferenciaDestaques(g, r.grupo);
  const datas = itens.map(x => r.linhas[x.k]?.[0] ?? null).join(',');
  const refs = useSocial(grupos.length ? `rx-destaques:${m.catalogo.sha256}:${r.grupo}:${rede}:${datas}` : null,
    () => referenciasDestaques(m, c, g, r, itens));
  return <section className="rx-resumo" aria-label={t('Indicadores gerais e referências', 'General indicators and benchmarks')}>
    <div className="rx-secao-titulo"><div><h3>{t('Indicadores gerais', 'General indicators')}</h3><p>{grupos.length ? t('Estado e Brasil no mesmo período. Nas contagens, a comparação usa taxas por habitante; os totais continuam em destaque.', 'State and Brazil at the same date. Counts are compared using per-resident rates; totals remain highlighted.') : t('Panorama nacional com a data e a condição de cada indicador. As taxas por habitante acompanham as contagens.', 'National overview with each indicator’s date and status. Per-resident rates accompany counts.')}</p></div></div>
    {refs.carregando && <p className="rx-ajuda" role="status">{t('Carregando referências do estado e do Brasil…', 'Loading state and Brazil benchmarks…')}</p>}
    {(refs.erro || !!refs.dados?.falhas.length) && <p className="rx-ajuda" role="status">{t('Algumas referências não carregaram. Os indicadores do lugar continuam disponíveis.', 'Some benchmarks did not load. The place’s indicators remain available.')} <button type="button" className="botao-leve" onClick={refs.recarregar}>{t('Tentar novamente', 'Retry')}</button></p>}
    <div className="rx-destaques">
      {itens.map(item => {
        const { i, k } = item, key = chaveRaio(i), ponto = refs.dados?.locais[key]??r.linhas[k];
        const trienio=refs.dados?.trienios[key];
        const trienioSemBase=refs.dados?.trieniosSemBase[key];
        const a = apresentacaoDestaque(item, ponto, r.grupo, ressalvas);
        const populacao = i.catalogo === 'referencias' && i.id === 'rx_populacao';
        const unidadeComparavel = textoComparacao(i, 'unidade');
        const outraUnidade = a.unidade !== unidadeComparavel && !populacao && !i.binario;
        const legenda = populacao ? t('Participação na população', 'Share of the population') : i.metodo_referencia === 'mediana' ? t('Mediana dos municípios', 'Municipal median') : i.binario ? t('Municípios com resposta “Sim”', 'Municipalities answering “Yes”') : i.metodo_referencia === 'area' ? t('Média ponderada pela área', 'Area-weighted average') : outraUnidade ? unidadeComparavel : t('No mesmo período', 'At the same date');
        return <button type="button" key={key} data-indicador={key} className="rx-destaque" onClick={() => focar(i)}>
          <span>{i.area === 'trabalho' && i.id === 'mulheres' ? t('Mulheres nos vínculos formais', 'Women in formal jobs') : a.nome}</span><strong title={a.valor===null?undefined:a.valor.toLocaleString(local(),{maximumFractionDigits:2})+' · '+a.unidade}>{a.texto}</strong>
          <small>{a.unidade==='%'?'':a.unidade+' · '}{trienio?`${trienio-2}–${trienio} · ${t('triênio','three-year period')}`:a.ponto?periodoComparacao(a.ponto[0]):'—'}</small>
          {trienio&&<small>{t('Destaque: óbitos ÷ nascidos vivos no triênio. A série anual continua no detalhe.','Highlight: deaths ÷ live births over three years. Annual values remain in the detail.')}</small>}
          {trienioSemBase&&<small>{t(`Triênio ${trienioSemBase-2}–${trienioSemBase} indisponível: faltam componentes completos. Exibe-se a taxa anual com aviso de instabilidade.`,`The ${trienioSemBase-2}–${trienioSemBase} three-year rate is unavailable: complete components are missing. The annual rate is shown with an instability warning.`)}</small>}
          {(grupos.length > 0 || outraUnidade || g.territorios[r.grupo].nivel !== 'M' && ['mediana', 'area', 'resposta'].includes(i.metodo_referencia)) && <span className="rx-destaque-comparacao">
            <small className="rx-comparacao-legenda">{legenda}</small>
            {outraUnidade && <small className="rx-comparacao-linha"><span>{t('Neste recorte', 'This scope')}</span><b>{formatarRaio(i, a.comparavel)}</b></small>}
            {grupos.map(grupo => {
              const p = refs.dados?.pontos[grupo]?.[key] ?? null;
              const ref = referenciaDestaque(i, ponto, p, ressalvas);
              return <small key={grupo} data-grupo={grupo} className="rx-comparacao-linha" title={ref.valor === null && !refs.carregando ? t('Sem valor comparável no mesmo período.', 'No comparable value at the same date.') : textoComparacao(i, 'normalizacao')}><span>{grupo === 'BR' ? t('Brasil', 'Brazil') : t(`Estado (${grupo})`, `State (${grupo})`)}</span><span><b>{refs.carregando ? '…' : ref.texto}</b>{ref.condicao && ` · ${ref.condicao}`}</span></small>;
            })}
          </span>}
          <small className="rx-status">{a.condicao}</small>
        </button>;
      })}
    </div>
    <p className="rx-ajuda rx-resumo-nota">{t('As referências preservam o método da fonte: taxas e médias ponderadas, ou mediana municipal quando indicada. A participação da população mostra quanto este lugar representa no estado e no país. “—” significa ausência de valor comparável, não zero. Clique em um indicador para ver a série, os componentes e a cobertura.', 'Benchmarks retain the source method: rates and weighted averages, or municipal medians where identified. Population shares show this place’s share of the state and country. “—” means no comparable value, not zero. Click an indicator for its time series, components and coverage.')}</p>
  </section>;
}
