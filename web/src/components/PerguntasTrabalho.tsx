import { Link } from 'react-router-dom';
import { t } from '../idioma';
import { ATALHOS_RAIS, urlAnalise } from '../trabalho_comum';
import { agruparAtalhos, PERGUNTAS_RAIS } from '../trabalho_orientacao';
import { BotaoEscolherLocal } from './AjudaTrabalho';

/**
 * Entrada da visão geral por perguntas: poucos caminhos principais, cada um abrindo uma página ou análise que já
 * existe, no mesmo ano e território (o recorte só segue quando a ação precisa dele, como a ocupação no perfil).
 */
export function PerguntasTrabalho({ busca, micro, temCaged, temIndicadores }: { busca: URLSearchParams; micro: boolean; temCaged: boolean; temIndicadores?: boolean }) {
  // o cabeçalho fixo já é compensado por scroll-padding-top no html
  const irAosIndicadores = () => {
    const el = document.getElementById('trabalho-indicadores');
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  };
  return (
    <section className="cartao trabalho-perguntas" aria-labelledby="trabalho-perguntas-t">
      <div className="cabeca-cartao">
        <div>
          <h3 id="trabalho-perguntas-t">{t('O que você quer saber?', 'What do you want to know?')}</h3>
          <p className="desc">{t('Escolha uma pergunta. Cada uma abre a análise já no mesmo ano e território; as opções avançadas continuam lá dentro.', 'Pick a question. Each opens the analysis for the same year and territory; the advanced options remain inside.')}</p>
        </div>
        {temIndicadores && <button type="button" className="botao-leve" onClick={irAosIndicadores}>{t('Ir aos indicadores', 'Go to the indicators')}</button>}
      </div>
      <ul className="trabalho-perguntas-lista">
        {PERGUNTAS_RAIS().map((q) => {
          const indisponivel = q.id === 'movimento' && !temCaged;
          return (
            <li key={q.id}>
              <h4>{q.pergunta}</h4>
              <p>{q.desc}</p>
              {indisponivel
                ? <small>{t('Os dados do Novo CAGED ainda não foram publicados.', 'New CAGED data have not been published yet.')}</small>
                : <Link className="botao" to={urlAnalise(busca, q.caminho, q.params, q.manter)}>{q.rotulo}</Link>}
              {q.notaBrasil && !micro && !indisponivel && (
                <small>{q.notaBrasil} <BotaoEscolherLocal /></small>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Todos os atalhos da Consulta e as páginas de análise, em grupos; os que exigem microdados levam à escolha do local. */
export function TodasAnalises({ busca, micro }: { busca: URLSearchParams; micro: boolean }) {
  const grupos = agruparAtalhos(ATALHOS_RAIS());
  return (
    <section className="cartao trabalho-todas" aria-labelledby="trabalho-todas-t">
      <div className="cabeca-cartao">
        <div>
          <h3 id="trabalho-todas-t">{t('Ver todas as análises', 'All analyses')}</h3>
          <p className="desc">{t('Atalhos para a Consulta personalizada, no mesmo território e ano; os filtros anteriores não são levados.', 'Shortcuts to the Custom query, for the same territory and year; earlier filters are not carried over.')}</p>
        </div>
      </div>
      {!micro && (
        <p className="nota-base">{t('Neste recorte só sexo e ocupações (grandes grupos) estão disponíveis nas tabelas pré-somadas; os demais cortes usam os microdados de uma UF ou município. ',
          'For this scope only sex and occupations (major groups) are available in the pre-aggregated tables; the other cuts use the microdata of a state or municipality. ')}<BotaoEscolherLocal /></p>
      )}
      {grupos.map((g) => (
        <div key={g.titulo} className="trabalho-grupo-atalhos">
          <h4>{g.titulo}</h4>
          <ul className="rais-atalhos">
            {g.itens.map((x) => {
              const bloqueado = x.micro && !micro;
              return (
                <li key={x.id} className={bloqueado ? 'bloqueado' : undefined}>
                  {bloqueado ? <strong>{x.titulo}</strong> : <Link to={urlAnalise(busca, '/trabalho/consulta', x.params)}><strong>{x.titulo}</strong></Link>}
                  <span>{x.desc}</span>
                  {bloqueado && <small>{t('Exige os microdados de uma UF ou município.', 'Needs the microdata of a state or municipality.')} <BotaoEscolherLocal /></small>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="trabalho-grupo-atalhos">
        <h4>{t('Páginas de análise', 'Analysis pages')}</h4>
        <ul className="rais-atalhos">
          <li><Link to={urlAnalise(busca, '/trabalho/remuneracao', {})}><strong>{t('Remuneração e desigualdades', 'Pay and inequality')}</strong></Link>
            <span>{t('Compara média, mediana e composição por sexo, raça/cor, escolaridade e idade.', 'Compares average, median and composition by sex, race/colour, education and age.')}</span></li>
          <li><Link to={urlAnalise(busca, '/trabalho/estabelecimentos', {})}><strong>{t('Estabelecimentos', 'Establishments')}</strong></Link>
            <span>{t('Estabelecimentos declarantes, estoque de vínculos, porte, atividade, natureza jurídica, Simples e PAT; o cálculo começa em Calcular.', 'Declaring establishments, job stock, size, activity, legal nature, Simples and PAT; the calculation starts on Calculate.')}</span></li>
          <li><Link to={urlAnalise(busca, '/trabalho/perfil', {}, ['cbo'])}><strong>{t('Perfil de uma ocupação', 'Occupation profile')}</strong></Link>
            <span>{t('Sete tabelas de um recorte de ocupação (série, remuneração, atividades, perfil); escolha a ocupação pelo nome na página.', 'Seven tables for an occupation (series, pay, activities, profile); choose the occupation by name on the page.')}</span></li>
        </ul>
      </div>
    </section>
  );
}
