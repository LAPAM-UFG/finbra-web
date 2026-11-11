import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { t } from '../idioma';

/** Leva o foco ao filtro de UF da barra de filtros (o município se escolhe logo ao lado). */
export function focarLocal() {
  const el = document.getElementById('f-uf');
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  (el as HTMLElement).focus({ preventScroll: true });
}

/** Ação para recursos que só existem com os microdados de uma UF ou município. */
export function BotaoEscolherLocal({ rotulo }: { rotulo?: string }) {
  return (
    <button type="button" className="botao-leve trabalho-local" onClick={focarLocal}>
      {rotulo ?? t('Escolher UF ou município', 'Choose a state or municipality')}
    </button>
  );
}

/** Resumo de uma linha do que a página oferece neste território, com os detalhes completos sob demanda. */
export function CapacidadeTrabalho({ micro, resumo, detalhe, rotulo }: { micro: boolean; resumo: ReactNode; detalhe: ReactNode; rotulo: string }) {
  return (
    <div className={`cobertura capacidade trabalho-capacidade ${micro ? '' : 'limitada'}`} role="note">
      <p>
        <strong>{rotulo}:</strong> {resumo}{' '}
        {!micro && <BotaoEscolherLocal />}
      </p>
      <details>
        <summary>{t('Detalhes do que está disponível', 'Details of what is available')}</summary>
        <p>{detalhe}</p>
      </details>
    </div>
  );
}

/**
 * Ajuda curta, sob demanda, para quem não conhece a RAIS: o que conta como emprego, profissão x atividade,
 * como ler média/mediana/percentis, salários ausentes e N. As definições completas ficam na metodologia.
 */
export function AjudaTrabalho({ foco = 'geral' }: { foco?: 'geral' | 'remuneracao' | 'estabelecimentos' }) {
  const { search } = useLocation();
  const itens: [string, string][] = [
    [t('O que é um “vínculo”', 'What a “job” (vínculo) is'), t(
      'É um contrato ou posto de trabalho formal registrado na RAIS, não uma pessoa: quem tem dois empregos formais conta duas vezes. Só entra o emprego com carteira, estatutário e afins; ficam de fora trabalho informal, autônomos e MEI sem empregados. A RAIS não mede desemprego.',
      'It is a formal employment contract or position recorded in RAIS, not a person: someone with two formal jobs counts twice. Formal, civil-service and similar jobs only; informal work, self-employed and MEI without employees are left out. RAIS does not measure unemployment.',
    )],
    [t('“Ativo em 31/12”', '“Active on Dec 31”'), t(
      'Contrato ainda em vigor no fim do ano: são os empregos existentes naquela data. Quem foi desligado ou saiu durante o ano aparece em “Desligados”.',
      'A contract still in force at year end: the jobs existing on that date. People separated during the year appear under “Separated”.',
    )],
    [t('Profissão (CBO) x atividade (CNAE)', 'Occupation (CBO) vs activity (CNAE)'), t(
      'Profissão é o que a pessoa faz no contrato (ex.: enfermeiro). Atividade é o ramo do estabelecimento onde ela trabalha (ex.: hospital). Um enfermeiro pode estar em hospital, escola ou indústria; um contador de hospital está na atividade de saúde.',
      'Occupation is what the person does in the contract (e.g. nurse). Activity is the line of business of the establishment (e.g. hospital). A nurse may work in a hospital, school or factory; an accountant in a hospital is in the health activity.',
    )],
    ...(foco === 'estabelecimentos' ? [] : [
      [t('Média, mediana, P10 e P90', 'Average, median, P10 and P90'), t(
        'A média soma tudo e divide pelo número de vínculos; valores muito altos a puxam para cima. A mediana é o valor do meio: metade ganha menos, metade ganha mais. P10 e P90 são os valores abaixo dos quais estão 10% e 90% dos vínculos: mostram os extremos baixo e alto. Mediana e percentis só existem com microdados (UF ou município).',
        'The average adds everything and divides by the number of jobs; very high values pull it up. The median is the middle value: half earn less, half earn more. P10 and P90 are the values below which 10% and 90% of jobs fall: they show the low and high ends. Median and percentiles need microdata (state or municipality).',
      )] as [string, string],
      [t('Remuneração ausente', 'Missing pay'), t(
        'Alguns vínculos ativos não têm remuneração de dezembro informada. Na média (regra do PDET/MTE) eles contam como zero e aparecem à parte; mediana e percentis usam só os valores informados.',
        'Some active jobs have no December pay reported. In the average (PDET/MTE rule) they count as zero and are shown separately; the median and percentiles use reported values only.',
      )] as [string, string],
    ]),
    [t('“N”', '“N”'), t(
      'É a quantidade de vínculos por trás de um número. Com N pequeno (marcado com ‡), o valor oscila muito: leia com cautela.',
      'It is the number of jobs behind a figure. With a small N (flagged with ‡) the value swings a lot: read with caution.',
    )],
  ];
  return (
    <details className="trabalho-ajuda">
      <summary>{t('Como ler estes números (ajuda rápida)', 'How to read these numbers (quick help)')}</summary>
      <dl>
        {itens.map(([termo, texto]) => <div key={termo}><dt>{termo}</dt><dd>{texto}</dd></div>)}
      </dl>
      <p className="nota-base"><Link to={`/trabalho/metodologia${search}`}>{t('Fontes e metodologia completas', 'Full sources and methodology')}</Link></p>
    </details>
  );
}
