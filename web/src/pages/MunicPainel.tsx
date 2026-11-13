import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { Estado } from '../components/Kpi';
import { useDados } from '../contexto';
import { numero, numero1, pct } from '../format';
import { idioma, t } from '../idioma';
import { CURADORIA } from '../munic_curadoria';
import { fonteMunic, nomePesquisa, notaSemResposta, semAcento, siglaPesquisa, territorioNome, type Pesquisa } from '../munic_comum';
import {
  BLOCOS_MUNIC, cobertura, COLUNAS_EXPORTACAO, condicaoDoCartao, contextoDoIndicador, contextoMunic, edicoesCuradas, ehLinkDoExplorador, lerEscolhas, linhasExportacao, montarCartoes, selecionar, UFS_MUNIC,
  type BlocoMunic, type CartaoMunic, type DadosPainel, type Escolhas, type Escopo, type ResumoBinario, type ResumoNumerico,
} from '../munic_painel';
import { IndiceSaude } from './SaudeDatasus';

type Rota = DadosPainel & { territorio: Linha | null };
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const BLOCOS = (): Record<BlocoMunic, { titulo: string; desc: string }> => ({
  pessoal: {
    titulo: t('Pessoal e gestão de pessoas', 'Staff and people management'),
    desc: t('Quadro de servidores da administração direta e práticas de gestão de pessoal. São números declarados pelos gestores; a administração direta e a indireta são quadros distintos e não se somam.',
      'Staff of the direct administration and personnel-management practices. These are figures declared by managers; the indirect administration (agencies, foundations and companies) has its own staff and is not added to the direct one.'),
  },
  transparencia: {
    titulo: t('Transparência e governo digital', 'Transparency and digital government'),
    desc: t('Acesso à informação, controle interno, proteção de dados e serviços pela internet.', 'Access to information, internal control, data protection and online services.'),
  },
  planejamento: {
    titulo: t('Planejamento, legislação e participação', 'Planning, legislation and participation'),
    desc: t('Instrumentos de planejamento urbano, planos setoriais e conselhos.', 'Urban planning instruments, sector plans and councils.'),
  },
  habitacao: {
    titulo: t('Habitação e mobilidade', 'Housing and mobility'),
    desc: t('Estruturas e programas de habitação e de transporte.', 'Housing and transport structures and programmes.'),
  },
  inclusao: {
    titulo: t('Inclusão, políticas setoriais e proteção', 'Inclusion, sector policies and protection'),
    desc: t('Assistência social, mulheres, segurança alimentar, segurança pública, igualdade racial e migração.', 'Social assistance, women, food security, public security, racial equality and migration.'),
  },
});

/** Entrada de /munic: links antigos do explorador (?var=…, ?aba=…) vão para /munic/perguntas com a pergunta preservada; o resto abre o painel. */
export function MunicEntrada() {
  const { search, hash } = useLocation();
  if (ehLinkDoExplorador(search)) return <Navigate replace to={{ pathname: '/munic/perguntas', search, hash }} />;
  return <MunicPainel />;
}

const erroTexto = (e: Extract<Escolhas, { ok: false }>) => ({
  pesquisa: t('A pesquisa do endereço não existe (use MUNIC ou ESTADIC).', 'The survey in the address does not exist (use MUNIC or ESTADIC).'),
  edicao: t(`O painel não tem a edição “${e.valor}”.`, `The dashboard has no “${e.valor}” edition.`),
  uf: t(`“${e.valor}” não é uma UF válida.`, `“${e.valor}” is not a valid state.`),
  cod: t(`O código “${e.valor}” não é válido para esta pesquisa.`, `The code “${e.valor}” is not valid for this survey.`),
}[e.erro]);

export function MunicPainel() {
  const [sp, setSp] = useSearchParams();
  const { meta } = useDados();
  const lang = idioma();
  const edicoes = useMemo(() => edicoesCuradas(CURADORIA), []);
  const esc = lerEscolhas(sp, edicoes);
  const raiz = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState('');
  const definir = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') novo.delete(k);
      else novo.set(k, v);
    }
    setSp(novo, { replace: true });
  };

  const pesquisa: Pesquisa = esc.ok ? esc.pesquisa : 'munic';
  const temFonte = !!(meta.fontes[pesquisa] as { anos?: number[] } | undefined)?.anos?.length;
  // lista de municípios só para a busca por nome (tabela em memória); o painel carrega à parte
  const lugares = useApi<Linha[]>(esc.ok && temFonte && pesquisa === 'munic' ? 'munic_territorios' : null, { pesquisa, ano: edicoes.munic[0] });
  const dadosApi = useApi<Rota>(esc.ok && temFonte ? 'munic_painel' : null, {
    pesquisa, ano: esc.ok && esc.modo.tipo === 'edicao' ? esc.modo.ano : undefined,
    uf: esc.ok && esc.escopo.tipo === 'uf' ? esc.escopo.uf : esc.ok && esc.escopo.tipo === 'territorio' && pesquisa === 'estadic' ? texto(esc.escopo.uf) : undefined,
    cod: esc.ok && esc.escopo.tipo === 'territorio' && pesquisa === 'munic' ? esc.escopo.cod : undefined,
  });
  const dados = dadosApi.dados;
  const territorio = dados?.territorio ?? null;
  const naoAchou = !!dados && esc.ok && esc.escopo.tipo === 'territorio' && !territorio;
  const ufDoMunicipio = pesquisa === 'munic' && territorio ? texto(territorio.uf) : null;
  const cartoes = useMemo(() => (dados && esc.ok && !naoAchou ? montarCartoes(selecionar(CURADORIA, esc.pesquisa, esc.modo), dados, esc.escopo, ufDoMunicipio) : []),
    [dados, esc.ok ? esc.pesquisa : '', esc.ok ? JSON.stringify([esc.modo, esc.escopo]) : '', naoAchou, ufDoMunicipio]); // eslint-disable-line react-hooks/exhaustive-deps

  const ufSel = esc.ok ? (esc.escopo.tipo === 'uf' ? esc.escopo.uf : esc.escopo.tipo === 'territorio' ? texto(esc.escopo.uf ?? ufDoMunicipio) : '') : '';
  const sugestoes = useSugestoes(lugares.dados ?? [], busca, ufSel);
  const titulo = t('Gestão pública: painel automático', 'Public management: automatic dashboard');
  if (!esc.ok) {
    return (
      <>
        <h2 className="titulo-pagina">{titulo}</h2>
        <div className="aviso" role="alert"><p>{erroTexto(esc)} {t('Nada foi trocado por outro recorte.', 'Nothing was replaced by another scope.')}</p>
          <p><Link to={{ pathname: '/munic', search: '' }}>{t('Abrir o painel do Brasil', 'Open the Brazil dashboard')}</Link></p></div>
      </>
    );
  }
  if (!temFonte) return <><h2 className="titulo-pagina">{titulo}</h2><p className="vazio">{t('Os dados da MUNIC e da ESTADIC ainda não foram publicados.', 'MUNIC and ESTADIC data have not been published yet.')}</p></>;

  const ehMunic = pesquisa === 'munic';
  const escopo = esc.escopo;
  const rotuloRecorte = escopo.tipo === 'brasil' ? (ehMunic ? t('Brasil · todas as prefeituras', 'Brazil · all city halls') : t('Brasil · todos os governos estaduais', 'Brazil · all state governments'))
    : escopo.tipo === 'uf' ? t(`Prefeituras de ${escopo.uf}`, `City halls in ${escopo.uf}`)
      : ehMunic ? (territorio ? `${texto(territorio.nome)} (${texto(territorio.uf)})` : t('Município', 'Municipality')) : t(`Governo do estado de ${texto(escopo.uf)}`, `Government of the state of ${texto(escopo.uf)}`);
  const nomeModo = esc.modo.tipo === 'ultima' ? t('Última informação de cada tema', 'Latest information for each topic') : t(`Edição ${esc.modo.ano}`, `${esc.modo.ano} edition`);

  const disponiveis = cartoes.filter((c) => c.fonte);
  const naoDisponiveis = cartoes.filter((c) => !c.fonte);
  const porEdicao = [...new Set(disponiveis.map((c) => c.fonte!.ano))].sort((a, b) => b - a).map((a) => [a, disponiveis.filter((c) => c.fonte!.ano === a).length] as const);
  const blocos = BLOCOS();
  const pronto = !!dados && !dadosApi.carregando && !dadosApi.erro && !naoAchou && cartoes.length > 0;

  const exportar = () => ({
    colunas: COLUNAS_EXPORTACAO(lang),
    linhas: linhasExportacao(cartoes, { lang, pesquisa: siglaPesquisa(pesquisa), recorte: rotuloRecorte, blocos: Object.fromEntries(BLOCOS_MUNIC.map((b) => [b, blocos[b].titulo])) as Record<BlocoMunic, string> }),
    metadados: [
      [t('Pesquisa', 'Survey'), nomePesquisa(pesquisa)], [t('Recorte', 'Scope'), rotuloRecorte],
      [t('Edição', 'Edition'), esc.modo.tipo === 'ultima' ? `${nomeModo}: ${porEdicao.map(([a, n]) => `${a} (${n})`).join(', ')}` : nomeModo],
      [t('Base do percentual', 'Percentage base'), t('só as respostas efetivas Sim e Não; sem resposta válida (não informou, recusa, não sabe informar, não se aplica) fica à parte, fora da base. O universo é o total de territórios da edição no recorte.',
        'only the effective Yes and No answers; answers without a valid answer (not reported, refusal, does not know, not applicable) are set apart, outside the base. The universe is the number of territories of the edition in the scope.')],
      [t('Ano', 'Year'), t('cada linha traz a edição da pesquisa em que o tema foi investigado; os temas rodam por edição', 'each row gives the survey edition in which the topic was investigated; topics rotate by edition')],
      [t('Leitura', 'How to read'), t('respostas dos gestores ao IBGE sobre a existência declarada de estruturas e instrumentos; não medem qualidade e não são nota nem ranking de gestão', 'managers’ answers to IBGE about the declared existence of structures and instruments; they do not measure quality and are not a score or ranking')],
      [t('Pessoal', 'Staff'), t('contagens declaradas da administração direta (a indireta tem quadro próprio); soma e média só dos territórios com valor, sem total derivado entre bases diferentes', 'declared counts for the direct administration (the indirect has its own staff); sum and mean only for territories with a value, with no total derived across different bases')],
      [t('Fonte', 'Source'), fonteMunic()], [t('Versão da base', 'Data version'), meta.geradoEm], [t('Endereço', 'Address'), location.href],
    ] as [string, string][],
  });

  return (
    <>
      <h2 className="titulo-pagina">{titulo}</h2>
      <p className="subtitulo">{nomePesquisa(pesquisa)} · {rotuloRecorte} <Dica rotulo={t('Fonte', 'Source')}>{fonteMunic()}</Dica></p>
      <section className="cartao mp-filtros" aria-label={t('Escolhas do painel', 'Dashboard choices')}>
        <div className="filtros">
          <div className="campo">
            <label htmlFor="mp-pesq">{t('Pesquisa', 'Survey')}</label>
            <select id="mp-pesq" value={pesquisa} onChange={(e) => { setBusca(''); definir({ pesq: e.target.value === 'munic' ? null : e.target.value, ano: null, uf: null, cod: null }); }}>
              <option value="munic">{t('MUNIC · municípios', 'MUNIC · municipalities')}</option>
              <option value="estadic">{t('ESTADIC · estados', 'ESTADIC · states')}</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="mp-ed">{t('Edição', 'Edition')}</label>
            <select id="mp-ed" value={esc.modo.tipo === 'edicao' ? String(esc.modo.ano) : ''} onChange={(e) => definir({ ano: e.target.value || null })}>
              <option value="">{t('Última informação de cada tema', 'Latest information for each topic')}</option>
              {edicoes[pesquisa].map((a) => <option key={a} value={a}>{t(`Só a edição ${a}`, `${a} edition only`)} ({selecionar(CURADORIA, pesquisa, { tipo: 'edicao', ano: a }).filter((s) => s.fonte).length})</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="mp-uf">{ehMunic ? 'UF' : t('Governo estadual', 'State government')}</label>
            <select id="mp-uf" value={ufSel} onChange={(e) => { setBusca(''); definir({ uf: e.target.value || null, cod: null }); }}>
              <option value="">{ehMunic ? t('Brasil (todas as UFs)', 'Brazil (all states)') : t('Todos os governos estaduais', 'All state governments')}</option>
              {UFS_MUNIC.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {ehMunic && (
            <div className="campo mp-busca">
              <label htmlFor="mp-mun">{t('Município', 'Municipality')}</label>
              <input id="mp-mun" value={busca} autoComplete="off" onChange={(e) => setBusca(e.target.value)}
                placeholder={territorio ? `${texto(territorio.nome)} (${texto(territorio.uf)})` : t('digite o nome', 'type the name')} />
              {busca.trim().length >= 2 && (
                <ul className="mp-sugestoes" aria-label={t('Municípios encontrados', 'Matching municipalities')}>
                  {sugestoes.map((r) => (
                    <li key={texto(r.cod)}>
                      <button type="button" onClick={() => { definir({ cod: texto(r.cod), uf: texto(r.uf) }); setBusca(''); }}>{texto(r.nome)} ({texto(r.uf)})</button>
                    </li>
                  ))}
                  {!sugestoes.length && !lugares.carregando && <li className="mp-sem">{t('Nenhum município com esse nome.', 'No municipality with that name.')}</li>}
                </ul>
              )}
              {escopo.tipo === 'territorio' && <button type="button" className="limpar" onClick={() => definir({ cod: null })}>{t('ver a UF inteira', 'see the whole state')}</button>}
            </div>
          )}
        </div>
      </section>
      <div className="aviso" role="note">
        <p>{t('Estes números vêm das respostas dos gestores ao IBGE. Mostram se uma estrutura, norma ou serviço existe, não se funciona bem: não são nota, ranking nem medida de qualidade da gestão.',
          'These figures come from managers’ answers to IBGE. They show whether a structure, rule or service exists, not whether it works well: they are not a score, a ranking or a measure of management quality.')}</p>
        {esc.modo.tipo === 'ultima' && <p><strong>{t('Cada tema foi pesquisado em um ano.', 'Each topic was surveyed in a given year.')}</strong>{' '}
          {t('O ano da pesquisa está em todos os cartões.', 'The survey year is shown on every card.')}{porEdicao.length > 0 && ` ${t('Cartões por edição', 'Cards by edition')}: ${porEdicao.map(([a, n]) => `${a} (${n})`).join(' · ')}.`}</p>}
        {esc.modo.tipo === 'edicao' && <p>{t(`Só os indicadores da edição ${esc.modo.ano}; os demais constam como “não disponível nesta edição”, sem valor.`, `Only ${esc.modo.ano} edition indicators; the others appear as “not available in this edition”, with no value.`)}</p>}
      </div>

      <div ref={raiz}>
        <IndiceSaude raiz={raiz} />
        <Estado carregando={dadosApi.carregando} erro={dadosApi.erro} tentarNovamente={dadosApi.recarregar} mensagem={t('Não foi possível carregar o painel.', 'The dashboard could not be loaded.')} />
        {naoAchou && <div className="vazio erro" role="alert"><p>{t('Esse município não foi encontrado na pesquisa. Escolha outro ou veja a UF inteira.', 'That municipality was not found in the survey. Choose another or see the whole state.')}</p></div>}
        {pronto && (
          <>
            {escopo.tipo === 'territorio' && (
              <p className="nota-base">{ehMunic && territorio ? <>{texto(territorio.nome)} ({texto(territorio.uf)}){territorio.populacao ? ` · ${t('população', 'population')} ${numero(Number(territorio.populacao))}` : ''}{territorio.faixa ? ` · ${texto(territorio.faixa)}` : ''}. </> : null}
                {t('Cada cartão mostra a resposta do território (Sim, Não ou sem resposta) e, abaixo, a participação de “Sim” no Brasil', 'Each card shows the territory’s answer (Yes, No or no answer) and, below, the share of “Yes” in Brazil')}{ehMunic ? t(' e na UF.', ' and in the state.') : '.'}</p>
            )}
            {BLOCOS_MUNIC.map((b) => {
              const lista = disponiveis.filter((c) => c.ind.bloco === b);
              const fora = naoDisponiveis.filter((c) => c.ind.bloco === b);
              if (!lista.length && !fora.length) return null;
              return (
                <section key={b} aria-labelledby={`munic-${b}`}>
                  <h3 className="secao bloco-saude" id={`munic-${b}`} data-indice={blocos[b].titulo} tabIndex={-1}>{blocos[b].titulo}</h3>
                  <p className="nota-base">{blocos[b].desc}</p>
                  <div className="mp-grade">{lista.map((c) => <CartaoIndicador key={c.ind.id} c={c} pesquisa={pesquisa} escopo={escopo} lang={lang} />)}</div>
                  {fora.length > 0 && (
                    <p className="nota-base mp-fora"><strong>{t('Não disponível nesta edição', 'Not available in this edition')}:</strong> {fora.map((c) => (lang === 'en' ? c.ind.titulo.en : c.ind.titulo.pt)).join('; ')}.</p>
                  )}
                </section>
              );
            })}
            <section className="cartao" aria-labelledby="munic-exportar">
              <h3 id="munic-exportar">{t('Exportar o painel', 'Export the dashboard')}</h3>
              <p className="nota-base">{t('Um arquivo com todos os indicadores acima: pergunta do IBGE, edição, recorte, numerador, denominador, sem resposta válida, universo, cobertura e condição do dado. Percentuais de 0 a 100.',
                'One file with every indicator above: IBGE question, edition, scope, numerator, denominator, without a valid answer, universe, coverage and data condition. Percentages from 0 to 100.')}</p>
              <BotoesExportar nome={`gestao_publica_${pesquisa}_${esc.modo.tipo === 'edicao' ? esc.modo.ano : 'ultima'}_${escopo.tipo === 'brasil' ? 'BR' : escopo.tipo === 'uf' ? escopo.uf : escopo.cod}`} obter={exportar} />
            </section>
            <details className="cartao mp-avancado">
              <summary>{t('Exploração avançada: todas as perguntas, evolução entre edições e ficha', 'Advanced exploration: every question, change across editions and profile')}</summary>
              <ul>
                <li><Link to={{ pathname: '/munic/perguntas', search: contextoMunic(`?${sp}`, 'avancado', edicoes) }}><strong>{t('Explorar por pergunta', 'Explore by question')}</strong></Link> — {t('qualquer tema e edição, por UF e faixa de população.', 'any topic and edition, by state and population bracket.')}</li>
                <li><Link to={{ pathname: '/munic/evolucao', search: contextoMunic(`?${sp}`, 'avancado', edicoes) }}><strong>{t('Evolução entre edições', 'Change across editions')}</strong></Link> — {t('perguntas com o mesmo enunciado em mais de uma edição.', 'questions with the same wording in more than one edition.')}</li>
                <li><Link to={{ pathname: '/munic/territorio', search: contextoMunic(`?${sp}`, 'ficha', edicoes) }}><strong>{t('Ficha do município ou estado', 'Municipality or state profile')}</strong></Link> — {t('todas as respostas de um território numa edição.', 'all answers of a territory in one edition.')}</li>
                <li><Link to="/munic/metodologia"><strong>{t('Fontes e metodologia', 'Sources and methodology')}</strong></Link></li>
              </ul>
            </details>
            <p className="nota-base">{notaSemResposta()} {t('Versão da base', 'Data version')}: {meta.geradoEm}.</p>
          </>
        )}
      </div>
    </>
  );
}

/** Municípios cujo nome contém o texto digitado (sem acento), dentro da UF escolhida; no máximo 8, sem consulta nova. */
function useSugestoes(lista: Linha[], busca: string, uf: string): Linha[] {
  return useMemo(() => {
    const termo = semAcento(busca.trim());
    if (termo.length < 2) return [];
    const achados = lista.filter((r) => (!uf || r.uf === uf) && semAcento(texto(r.nome)).includes(termo));
    // quem começa pelo texto vem antes
    return achados.sort((a, b) => Number(semAcento(texto(b.nome)).startsWith(termo)) - Number(semAcento(texto(a.nome)).startsWith(termo))).slice(0, 8);
  }, [lista, busca, uf]);
}

// ---------------- cartão de um indicador ----------------

const unidadePais = (p: Pesquisa) => territorioNome(p);

function CartaoIndicador({ c, pesquisa, escopo, lang }: { c: CartaoMunic; pesquisa: Pesquisa; escopo: Escopo; lang: 'pt' | 'en' }) {
  const f = c.fonte!;
  const ind = c.ind;
  const sigla = siglaPesquisa(pesquisa);
  const titulo = lang === 'en' ? ind.titulo.en : ind.titulo.pt;
  const condicao = condicaoDoCartao(c);
  const linkPergunta = `/munic/perguntas?pesq=${pesquisa}&ano=${f.ano}&aba=${encodeURIComponent(f.aba)}&var=${encodeURIComponent(f.var)}`;
  const linkFicha = escopo.tipo === 'territorio' ? `/munic/territorio?pesq=${pesquisa}&ano=${f.ano}&cod=${escopo.cod}` : null;
  let corpo: ReactNode;
  if (c.territorio) corpo = <CorpoTerritorio c={c} />;
  else if (ind.tipo === 'binario') corpo = <CorpoBinario r={c.recorte as ResumoBinario} brasil={c.brasil as ResumoBinario | null} universo={c.universo} pesquisa={pesquisa} escopo={escopo} condicao={condicao} />;
  else corpo = <CorpoNumerico r={c.recorte as ResumoNumerico} brasil={c.brasil as ResumoNumerico | null} universo={c.universo} unidade={lang === 'en' ? ind.unidade?.en : ind.unidade?.pt} pesquisa={pesquisa} escopo={escopo} condicao={condicao} />;
  return (
    <article className="mp-cartao">
      <header>
        <span className="mp-ano" title={t('Ano da pesquisa em que o tema foi investigado', 'Survey year in which the topic was investigated')}>{sigla} {f.ano}</span>
        <h4>{titulo}</h4>
      </header>
      {contextoDoIndicador(ind, lang) && <p className="mp-contexto">{contextoDoIndicador(ind, lang)}</p>}
      {corpo}
      <details className="mp-pergunta">
        <summary>{t('Pergunta do IBGE', 'IBGE question')}</summary>
        <p>{f.rotulo}</p>
        <p className="mp-meta">{t('Tema', 'Topic')}: {f.tema} · {t('código', 'code')} {f.var}</p>
        <p className="mp-links"><Link to={linkPergunta}>{t('ver a pergunta', 'see the question')}</Link>{linkFicha && <> · <Link to={linkFicha}>{t('ver a ficha', 'see the profile')}</Link></>}</p>
      </details>
    </article>
  );
}

function Barra({ valor }: { valor: number | null }) {
  return <div className="mp-barra" aria-hidden="true">{valor !== null && <span style={{ width: `${Math.min(100, Math.max(0, valor * 100))}%` }} />}</div>;
}

const semRespostaTxt = (x: { semResposta: number; semRespostaDetalhe: { texto: string; n: number }[] }) => (x.semResposta > 0
  ? `${t('Sem resposta válida (fora da base)', 'Without a valid answer (outside the base)')}: ${numero(x.semResposta)}${x.semRespostaDetalhe.length ? ` (${x.semRespostaDetalhe.slice(0, 2).map((d) => `${d.texto}: ${numero(d.n)}`).join('; ')})` : ''}` : null);

function CorpoBinario({ r, brasil, universo, pesquisa, escopo, condicao }: { r: ResumoBinario; brasil: ResumoBinario | null; universo: number | null; pesquisa: Pesquisa; escopo: { tipo: string }; condicao: string }) {
  if (condicao === 'sem_dados') return <p className="mp-vazio">{t('Sem dados neste recorte.', 'No data in this scope.')}</p>;
  if (condicao === 'inesperada') return <p className="mp-vazio">{t('Há respostas fora do previsto; o percentual não foi calculado.', 'There are unexpected answers; the share was not computed.')}</p>;
  const cob = cobertura(r.base, universo);
  const sem = semRespostaTxt(r);
  return (
    <>
      <p className="mp-valor"><strong>{r.pct === null ? '–' : pct(r.pct)}</strong> <span>{t('responderam Sim', 'answered Yes')}</span></p>
      <Barra valor={r.pct} />
      <p className="mp-num">{r.base > 0
        ? <>{numero(r.sim)} {t('de', 'of')} {numero(r.base)} {t('respostas efetivas (Sim ÷ Sim + Não)', 'effective answers (Yes ÷ Yes + No)')}</>
        : t('Nenhuma resposta válida Sim ou Não.', 'No valid Yes or No answer.')}</p>
      {universo !== null && <p className="mp-num">{t('Universo', 'Universe')}: {numero(universo)} {unidadePais(pesquisa)}{cob !== null ? ` · ${t('cobertura', 'coverage')} ${pct(cob)}` : ''}</p>}
      {sem && <p className="mp-num mp-aviso">{sem}</p>}
      {brasil && escopo.tipo === 'uf' && brasil.pct !== null && <p className="mp-comp">{t('Brasil', 'Brazil')}: {pct(brasil.pct)} ({numero(brasil.base)} {t('respostas efetivas', 'effective answers')})</p>}
    </>
  );
}

function CorpoNumerico({ r, brasil, universo, unidade, pesquisa, escopo, condicao }: { r: ResumoNumerico; brasil: ResumoNumerico | null; universo: number | null; unidade?: string; pesquisa: Pesquisa; escopo: { tipo: string }; condicao: string }) {
  if (condicao === 'sem_dados') return <p className="mp-vazio">{t('Sem dados neste recorte.', 'No data in this scope.')}</p>;
  if (condicao === 'inesperada') return <p className="mp-vazio">{t('Há respostas fora do previsto; a soma não foi calculada.', 'There are unexpected answers; the sum was not computed.')}</p>;
  const cob = cobertura(r.n, universo);
  const sem = semRespostaTxt(r);
  return (
    <>
      <p className="mp-valor"><strong>{r.soma === null ? '–' : numero(r.soma)}</strong> <span>{unidade ?? ''} {t('(soma das respostas)', '(sum of answers)')}</span></p>
      <p className="mp-num">{r.media === null ? t('Nenhum território com valor válido.', 'No territory with a valid value.') : `${t('Média por território com valor', 'Mean per territory with a value')}: ${numero1(r.media)}`}</p>
      <p className="mp-num">{numero(r.n)} {universo !== null ? `${t('de', 'of')} ${numero(universo)} ` : ''}{unidadePais(pesquisa)} {t('com valor válido', 'with a valid value')}{cob !== null ? ` · ${pct(cob)}` : ''}</p>
      {sem && <p className="mp-num mp-aviso">{sem}</p>}
      {brasil && escopo.tipo === 'uf' && brasil.soma !== null && <p className="mp-comp">{t('Brasil', 'Brazil')}: {numero(brasil.soma)} · {t('média', 'mean')} {numero1(brasil.media)} ({numero(brasil.n)} {t('com valor', 'with a value')})</p>}
    </>
  );
}

function CorpoTerritorio({ c }: { c: CartaoMunic }) {
  const tr = c.territorio!;
  const ind = c.ind;
  let principal: ReactNode;
  if (tr.estado === 'sim' || tr.estado === 'nao') principal = <p className={`mp-resposta ${tr.estado === 'sim' ? 'mp-sim' : 'mp-nao'}`}><strong>{tr.estado === 'sim' ? t('Sim', 'Yes') : t('Não', 'No')}</strong>{tr.texto !== 'Sim' && tr.texto !== 'Não' ? <small> {tr.texto}</small> : null}</p>;
  else if (tr.estado === 'valor') principal = <p className="mp-valor"><strong>{numero(tr.valor)}</strong> <span>{ind.unidade ? (idioma() === 'en' ? ind.unidade.en : ind.unidade.pt) : ''}</span></p>;
  else if (tr.estado === 'sem_resposta') principal = <p className="mp-resposta mp-sem-resp"><strong>{t('Sem resposta válida', 'No valid answer')}</strong><small> {tr.texto}</small></p>;
  else if (tr.estado === 'sem_registro') principal = <p className="mp-resposta mp-sem-resp"><strong>{t('Sem resposta registrada', 'No answer recorded')}</strong></p>;
  else principal = <p className="mp-resposta mp-sem-resp"><strong>{t('Resposta fora do previsto', 'Unexpected answer')}</strong><small> {tr.texto}</small></p>;
  const comp = (r: ResumoBinario | ResumoNumerico | null, rotulo: string) => {
    if (!r) return null;
    if ('pct' in r) return r.pct === null ? null : <p className="mp-comp">{rotulo}: {pct(r.pct)} {t('responderam Sim', 'answered Yes')} ({numero(r.sim)} {t('de', 'of')} {numero(r.base)})</p>;
    return r.media === null ? null : <p className="mp-comp">{rotulo}: {t('média', 'mean')} {numero1(r.media)} {t('por território', 'per territory')} ({numero(r.n)} {t('com valor', 'with a value')})</p>;
  };
  return <>{principal}{comp(c.ufDoTerritorio, 'UF')}{comp(c.brasil, t('Brasil', 'Brazil'))}</>;
}
