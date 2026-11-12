import { numero, pct, reaisExato } from '../format';
import { t } from '../idioma';
import type { ItemDist } from '../trabalho_perfis';

function Remuneracao({ item: i }: { item: ItemDist }) {
  if (i.condicaoRem === 'nao_publicada') return null;
  return <span className="dist-remuneracao">
    <span className="dist-rem-titulo">{t('Remuneração média', 'Average pay')}: </span>
    <span className="dist-rem-media">{i.condicaoRem === 'registrada' ? reaisExato(i.media)
      : i.condicaoRem === 'sem_vinculos' ? '–' : t('sem valor válido', 'no valid value')}</span>
    <small className="dist-cobertura">{i.vinculos === 0 ? t('sem vínculos', 'no jobs')
      : t(`Com valor de dezembro: ${numero(i.nRem)} de ${numero(i.vinculos)}`, `With December pay: ${numero(i.nRem)} of ${numero(i.vinculos)}`)}</small>
  </span>;
}

/**
 * Distribuição de vínculos por categoria: nome, barra proporcional ao TOTAL (a barra cheia seria 100% dos vínculos) e,
 * à direita, contagem e participação. Reutilizável: recebe só itens já calculados (trabalho_perfis.ts). Percentual
 * indefinido (total zero) aparece como "–" e sem barra. O texto tem sempre os números; a barra é só apoio visual.
 */
export function DistribuicaoBarras({ itens, legenda }: { itens: ItemDist[]; legenda: string }) {
  return (
    <ul className="dist-perfil" aria-label={legenda}>
      {itens.map((i) => (
        <li key={i.codigo} data-codigo={i.codigo} className={`dist-item dist-${i.tipo}${i.vinculos === 0 ? ' dist-zero' : ''}`}>
          <span className="dist-nome">{i.rotulo}</span>
          <span className="dist-valor"><strong>{numero(i.vinculos)}</strong> <span className="dist-pct">{pct(i.pct)}</span></span>
          <Remuneracao item={i} />
          <span className="dist-barra" aria-hidden="true">
            {i.pct !== null && i.vinculos > 0 && <span style={{ width: `${Math.min(100, i.pct * 100)}%` }} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Mesma distribuição em tabela (tipos detalhados): três colunas, com o grupo do MTE sob o nome. */
export function TabelaDistribuicao({ itens, grupo }: { itens: ItemDist[]; grupo?: (i: ItemDist) => string | null }) {
  return (
    <table className="dist-tabela">
      <thead><tr><th>{t('Tipo de vínculo', 'Job type')}</th><th>{t('Vínculos', 'Jobs')}</th><th>%</th></tr></thead>
      <tbody>
        {itens.map((i) => {
          const g = grupo?.(i);
          return (
            <tr key={i.codigo} data-codigo={i.codigo} className={i.vinculos === 0 ? 'dist-zero' : undefined}>
              <td>{i.rotulo}{g && <small className="dist-grupo">{g}</small>}<Remuneracao item={i} /></td>
              <td>{numero(i.vinculos)}</td>
              <td>{pct(i.pct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
