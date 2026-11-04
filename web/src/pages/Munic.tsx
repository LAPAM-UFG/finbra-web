import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { useDados } from '../contexto';
import { numero, numero1 } from '../format';
import { local, t } from '../idioma';
import {
  avisoComparacao, compararVar, distribuicao, FAIXAS_PORTE, fonteMunic, nomePesquisa, notaSemResposta, pctTxt, pesquisaDe, semAcento,
  siglaPesquisa, territorioNome, UFS, type Pesquisa,
} from '../munic_comum';

const num = (v: unknown) => (typeof v === 'number' ? v : null);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Escolhas da página guardadas no endereço: pesquisa, edição, tema e pergunta (nada vem dos filtros de outros painéis). */
function useEscolhas() {
  const [sp, setSp] = useSearchParams();
  const pesquisa: Pesquisa = pesquisaDe(sp.get('pesq'));
  const definir = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') novo.delete(k);
      else novo.set(k, v);
    }
    setSp(novo, { replace: true });
  };
  return { sp, pesquisa, definir };
}

function SeletorPesquisa({ pesquisa, mudar }: { pesquisa: Pesquisa; mudar: (p: Pesquisa) => void }) {
  return (
    <div className="campo">
      <label htmlFor="m-pesq">{t('Pesquisa', 'Survey')}</label>
      <select id="m-pesq" value={pesquisa} onChange={(e) => mudar(pesquisaDe(e.target.value))}>
        <option value="munic">{t('MUNIC (municípios)', 'MUNIC (municipalities)')}</option>
        <option value="estadic">{t('ESTADIC (estados)', 'ESTADIC (states)')}</option>
      </select>
    </div>
  );
}

function useMetaMunic(pesquisa: Pesquisa) {
  const { meta } = useDados();
  const f = meta.fontes[pesquisa] as { anos?: number[]; processado_em?: string } | undefined;
  return { anos: f?.anos ?? [], processadoEm: f?.processado_em, geradoEm: meta.geradoEm };
}

const SemDados = () => (
  <p className="vazio">{t('Os dados da MUNIC e da ESTADIC ainda não foram publicados.', 'MUNIC and ESTADIC data have not been published yet.')}</p>
);

// ---------------- visão geral ----------------

export function MunicVisaoGeral() {
  const { sp, pesquisa, definir } = useEscolhas();
  const { anos: anosMeta, processadoEm, geradoEm } = useMetaMunic(pesquisa);
  const [busca, setBusca] = useState('');
  const temas = useApi<Linha[]>('munic_temas', { pesquisa });
  const anos = useMemo(() => [...new Set((temas.dados ?? []).map((r) => Number(r.ano)))].sort((a, b) => b - a), [temas.dados]);
  const pedido = Number(sp.get('ano'));
  const ano = anos.includes(pedido) ? pedido : anos[0];
  const abas = useMemo(() => (temas.dados ?? []).filter((r) => Number(r.ano) === ano), [temas.dados, ano]);
  const aba = abas.some((r) => r.aba === sp.get('aba')) ? sp.get('aba')! : texto(abas[0]?.aba);
  const perguntas = useApi<Linha[]>(ano ? 'munic_perguntas' : null, { pesquisa, ano, aba });
  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    return (perguntas.dados ?? []).filter((r) => !termo || semAcento(texto(r.rotulo)).includes(termo)).sort((a, b) => compararVar(texto(a.var), texto(b.var)));
  }, [perguntas.dados, busca]);
  const pergunta = lista.find((r) => r.var === sp.get('var')) ?? lista[0];
  const dist = useApi<Linha[]>(ano && pergunta ? 'munic_distribuicao' : null, { pesquisa, ano, var: texto(pergunta?.var) });

  const brasil = useMemo(() => distribuicao(dist.dados ?? [], 'brasil', 'BR'), [dist.dados]);
  const numerica = pergunta?.tipo === 'numerica';
  const porUf = useMemo(() => UFS.map((uf) => ({ grupo: uf, d: distribuicao(dist.dados ?? [], 'uf', uf) })).filter((x) => x.d.total || x.d.numerico), [dist.dados]);
  const porFaixa = useMemo(() => FAIXAS_PORTE.map((g) => ({ grupo: g, d: distribuicao(dist.dados ?? [], 'faixa', g) })).filter((x) => x.d.total || x.d.numerico), [dist.dados]);
  const colunas = brasil.respostas.slice(0, 6).map((r) => r.texto);
  const universo = num(pergunta?.n_territorios);
  const respondentes = num(pergunta?.n_respostas);

  if (!anosMeta.length && !temas.carregando) return <><h2 className="titulo-pagina">{t('Gestão pública: MUNIC e ESTADIC', 'Public management: MUNIC and ESTADIC')}</h2><SemDados /></>;

  const tabelaExportar = () => ({
    colunas: [t('Recorte', 'Group'), t('Território(s) com resposta válida', 'Territories with a valid answer'), ...(numerica
      ? [t('Soma', 'Sum'), t('Média', 'Mean')]
      : brasil.respostas.flatMap((r) => [`${r.texto} (n)`, `${r.texto} (%)`]))],
    linhas: [{ grupo: 'Brasil', d: brasil }, ...porUf, ...porFaixa].map(({ grupo, d }) => [grupo, numerica ? d.numerico : d.total,
      ...(numerica ? [d.soma, d.media] : brasil.respostas.flatMap((r) => {
        const x = d.respostas.find((y) => y.texto === r.texto);
        return [x?.n ?? 0, x ? x.parte : 0];
      }))]),
    metadados: [
      [t('Pesquisa', 'Survey'), nomePesquisa(pesquisa)], [t('Edição', 'Edition'), String(ano)], [t('Tema', 'Topic'), aba],
      [t('Pergunta', 'Question'), texto(pergunta?.rotulo)], [t('Código da variável', 'Variable code'), texto(pergunta?.var)],
      [t('Base do percentual', 'Percentage base'), notaSemResposta()], [t('Fonte', 'Source'), fonteMunic()],
      [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href],
    ] as [string, string][],
  });

  return (
    <>
      <h2 className="titulo-pagina">{t('Gestão pública: MUNIC e ESTADIC', 'Public management: MUNIC and ESTADIC')}</h2>
      <p className="subtitulo">{nomePesquisa(pesquisa)} <Dica rotulo={t('Fonte', 'Source')}>{fonteMunic()}</Dica></p>
      <section className="cartao">
        <div className="filtros">
          <SeletorPesquisa pesquisa={pesquisa} mudar={(p) => definir({ pesq: p === 'munic' ? null : p, ano: null, aba: null, var: null })} />
          <div className="campo">
            <label htmlFor="m-ano">{t('Edição', 'Edition')}</label>
            <select id="m-ano" value={ano ?? ''} onChange={(e) => definir({ ano: e.target.value, aba: null, var: null })}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="m-aba">{t('Tema', 'Topic')}</label>
            <select id="m-aba" value={aba} onChange={(e) => definir({ aba: e.target.value, var: null })}>
              {abas.map((r) => <option key={texto(r.aba)} value={texto(r.aba)}>{texto(r.aba)} ({numero(num(r.perguntas))})</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="m-busca">{t('Buscar na pergunta', 'Search the question')}</label>
            <input id="m-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('ex.: plano diretor', 'e.g. master plan')} />
          </div>
        </div>
        <div className="filtros">
          <div className="campo" style={{ flex: '1 1 100%' }}>
            <label htmlFor="m-var">{t(`Pergunta (${numero(lista.length)})`, `Question (${numero(lista.length)})`)}</label>
            <select id="m-var" value={texto(pergunta?.var)} onChange={(e) => definir({ var: e.target.value })}>
              {lista.map((r) => <option key={texto(r.var)} value={texto(r.var)}>{texto(r.var)} · {texto(r.rotulo).slice(0, 180)}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={temas.carregando || perguntas.carregando} erro={temas.erro ?? perguntas.erro} tentarNovamente={temas.recarregar}
          vazio={!temas.carregando && !perguntas.carregando && !lista.length && t('Nenhuma pergunta com este filtro.', 'No question matches this filter.')} />
      </section>
      {pergunta && (
        <>
          <p className="nota-base"><strong>{texto(pergunta.rotulo)}</strong><br />
            {t('Tema', 'Topic')}: {texto(pergunta.aba)}{texto(pergunta.subtema) ? ` · ${texto(pergunta.subtema)}` : ''} · {t('código', 'code')} {texto(pergunta.var)} · {siglaPesquisa(pesquisa)} {ano}</p>
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Responderam', 'Answered')} valor={numero(respondentes)}
              nota={universo ? t(`de ${numero(universo)} ${territorioNome(pesquisa)} da edição`, `of ${numero(universo)} ${territorioNome(pesquisa)} in the edition`) : undefined} />
            <Kpi rotulo={t('Respostas válidas', 'Valid answers')} valor={numero(num(pergunta.n_validas))}
              nota={brasil.invalidas.length ? brasil.invalidas.slice(0, 3).map((x) => `${x.texto}: ${numero(x.n)}`).join(' · ') : undefined} />
            {numerica
              ? <Kpi rotulo={t('Soma no Brasil', 'Total in Brazil')} valor={numero(brasil.soma)} nota={t('soma das respostas numéricas', 'sum of numeric answers')} />
              : <Kpi rotulo={t('Resposta mais frequente', 'Most frequent answer')} valor={brasil.respostas[0] ? pctTxt(brasil.respostas.slice().sort((a, b) => b.n - a.n)[0].parte) : '–'}
                nota={brasil.respostas.slice().sort((a, b) => b.n - a.n)[0]?.texto} />}
            {numerica && <Kpi rotulo={t('Média por território', 'Mean per territory')} valor={numero1(brasil.media)} nota={t('entre quem respondeu', 'among those who answered')} />}
          </div>
          <Estado carregando={dist.carregando} erro={dist.erro} tentarNovamente={dist.recarregar} />
          {!numerica && brasil.respostas.length > 0 && (
            <CartaoGrafico titulo={t('Como responderam (Brasil)', 'How they answered (Brazil)')}
              desc={t(`${numero(brasil.total)} respostas válidas`, `${numero(brasil.total)} valid answers`)}
              acoes={<BotoesExportar nome={`${pesquisa}_${ano}_${texto(pergunta.var)}`} obter={tabelaExportar} />}
              tabela={<div className="rolagem"><table><thead><tr><th>{t('Resposta', 'Answer')}</th><th>n</th><th>%</th></tr></thead>
                <tbody>{brasil.respostas.map((r) => <tr key={r.texto}><td>{r.texto}</td><td>{numero(r.n)}</td><td>{pctTxt(r.parte)}</td></tr>)}</tbody></table></div>}>
              <Grafico nome={`${pesquisa}_${ano}_${texto(pergunta.var)}`} altura={Math.max(160, 44 * brasil.respostas.length + 30)}
                opcao={barras(brasil.respostas.map((r) => r.texto.slice(0, 70)), brasil.respostas.map((r) => r.parte), (v) => pctTxt(v))} />
            </CartaoGrafico>
          )}
          {(porUf.length > 0) && (
            <section className="cartao">
              <div className="cabeca-cartao">
                <div>
                  <h3>{numerica ? t('Por UF: soma e média', 'By state: total and mean') : t('Por UF: participação de cada resposta', 'By state: share of each answer')}</h3>
                  <p className="desc">{t(`Cada linha é a UF e considera os ${territorioNome(pesquisa)} com resposta válida.`, `Each row is the state and uses the ${territorioNome(pesquisa)} with a valid answer.`)} {notaSemResposta()}</p>
                </div>
                {(numerica || brasil.respostas.length === 0) && <BotoesExportar nome={`${pesquisa}_${ano}_${texto(pergunta.var)}`} obter={tabelaExportar} />}
              </div>
              <div className="rolagem">
                <table className="tabela-fixa">
                  <thead><tr><th>UF</th><th>n</th>{numerica ? <><th>{t('Soma', 'Sum')}</th><th>{t('Média', 'Mean')}</th></> : colunas.map((c) => <th key={c}>{c.slice(0, 40)}</th>)}</tr></thead>
                  <tbody>
                    {[{ grupo: 'Brasil', d: brasil }, ...porUf].map(({ grupo, d }) => (
                      <tr key={grupo} className={grupo === 'Brasil' ? 'destaque' : undefined}>
                        <td>{grupo === 'Brasil' ? t('Brasil', 'Brazil') : grupo}</td><td>{numero(numerica ? d.numerico : d.total)}</td>
                        {numerica ? <><td>{numero(d.soma)}</td><td>{numero1(d.media)}</td></>
                          : colunas.map((c) => <td key={c}>{pctTxt(d.respostas.find((x) => x.texto === c)?.parte ?? (d.total ? 0 : null))}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {pesquisa === 'munic' && porFaixa.length > 0 && (
            <section className="cartao">
              <div className="cabeca-cartao">
                <div>
                  <h3>{t('Por faixa de população do município', 'By municipal population bracket')}</h3>
                  <p className="desc">{t('A faixa usa a população do município no ano da edição, a mesma regra em todas as edições. Municípios maiores respondem a mais serviços e estruturas, por isso compare dentro da faixa.', 'The bracket uses the municipality’s population in the edition year, the same rule in every edition. Larger municipalities have more services and structures, so compare within a bracket.')}</p>
                </div>
              </div>
              <div className="rolagem">
                <table className="tabela-fixa">
                  <thead><tr><th>{t('Faixa de habitantes', 'Inhabitants')}</th><th>n</th>{numerica ? <><th>{t('Soma', 'Sum')}</th><th>{t('Média', 'Mean')}</th></> : colunas.map((c) => <th key={c}>{c.slice(0, 40)}</th>)}</tr></thead>
                  <tbody>
                    {porFaixa.map(({ grupo, d }) => (
                      <tr key={grupo}><td>{grupo}</td><td>{numero(numerica ? d.numerico : d.total)}</td>
                        {numerica ? <><td>{numero(d.soma)}</td><td>{numero1(d.media)}</td></>
                          : colunas.map((c) => <td key={c}>{pctTxt(d.respostas.find((x) => x.texto === c)?.parte ?? (d.total ? 0 : null))}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="nota-base">{t('Versão da base', 'Data version')}: {geradoEm} · {t('processado em', 'processed on')} {processadoEm ?? '–'}</p>
        </>
      )}
    </>
  );
}

// ---------------- evolução entre edições ----------------

export function MunicEvolucao() {
  const { sp, pesquisa, definir } = useEscolhas();
  const { anos: anosMeta, geradoEm } = useMetaMunic(pesquisa);
  const [termo, setTermo] = useState(sp.get('q') ?? '');
  const busca = useApi<Linha[]>('munic_busca', { pesquisa, q: termo });
  const grupos = busca.dados ?? [];
  const grupo = grupos.find((g) => g.grupo === sp.get('grupo')) ?? grupos[0];
  const serie = useApi<Linha[]>(grupo ? 'munic_evolucao' : null, { pesquisa, grupo: texto(grupo?.grupo) });
  const [estat, setEstat] = useState<'media' | 'soma' | 'n'>('media');

  const linhasSerie = serie.dados ?? [];
  const anos = [...new Set(linhasSerie.map((r) => Number(r.ano)))].sort((a, b) => a - b);
  const numerica = grupo?.tipo === 'numerica';
  const porAno = useMemo(() => anos.map((a) => {
    const rs = linhasSerie.filter((r) => Number(r.ano) === a);
    const validas = rs.filter((r) => r.valida && r.valor_txt !== null);
    const total = validas.reduce((s, r) => s + Number(r.n), 0);
    const numericas = rs.filter((r) => r.valor_txt === null);
    const nNum = numericas.reduce((s, r) => s + Number(r.n), 0);
    const soma = numericas.reduce((s, r) => s + Number(r.soma ?? 0), 0);
    return { ano: a, total, validas, nNum, soma, media: nNum ? soma / nNum : null, perguntas: [...new Set(rs.map((r) => `${texto(r.var)} · ${texto(r.rotulo)}`))] };
  }), [linhasSerie]);  // eslint-disable-line react-hooks/exhaustive-deps
  const freq = new Map<string, number>();
  for (const r of linhasSerie) if (r.valida && r.valor_txt !== null) freq.set(texto(r.valor_txt), (freq.get(texto(r.valor_txt)) ?? 0) + Number(r.n));
  const respostas = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  const series = numerica
    ? [{ nome: estat === 'media' ? t('Média por território', 'Mean per territory') : estat === 'soma' ? t('Soma', 'Total') : t('Territórios com resposta', 'Territories with an answer'),
      valores: porAno.map((p) => (estat === 'media' ? p.media : estat === 'soma' ? p.soma : p.nNum)) }]
    : respostas.map((r) => ({ nome: r.slice(0, 50), valores: porAno.map((p) => (p.total ? (p.validas.find((v) => v.valor_txt === r)?.n as number | undefined ?? 0) / p.total : null)) }));
  const formato = numerica ? (v: number) => (estat === 'media' ? numero1(v) : numero(v)) : (v: number) => pctTxt(v);

  if (!anosMeta.length) return <><h2 className="titulo-pagina">{t('Evolução entre edições', 'Change across editions')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Evolução entre edições', 'Change across editions')}</h2>
      <p className="subtitulo">{nomePesquisa(pesquisa)} · {t('Brasil', 'Brazil')} <Dica rotulo={t('Fonte', 'Source')}>{fonteMunic()}</Dica></p>
      <p className="aviso" role="note">{avisoComparacao()}</p>
      <section className="cartao">
        <div className="filtros">
          <SeletorPesquisa pesquisa={pesquisa} mudar={(p) => { setTermo(''); definir({ pesq: p === 'munic' ? null : p, grupo: null, q: null }); }} />
          <div className="campo" style={{ flex: '1 1 260px' }}>
            <label htmlFor="e-q">{t('Buscar pergunta em várias edições', 'Search a question in several editions')}</label>
            <input id="e-q" value={termo} onChange={(e) => { setTermo(e.target.value); definir({ q: e.target.value || null, grupo: null }); }} placeholder={t('ex.: plano diretor, conselho, internet…', 'e.g. master plan, council, internet…')} />
          </div>
        </div>
        <div className="filtros">
          <div className="campo" style={{ flex: '1 1 100%' }}>
            <label htmlFor="e-g">{t(`Pergunta (${grupos.length}${grupos.length === 60 ? '+' : ''})`, `Question (${grupos.length}${grupos.length === 60 ? '+' : ''})`)}</label>
            <select id="e-g" value={texto(grupo?.grupo)} onChange={(e) => definir({ grupo: e.target.value })}>
              {grupos.map((g) => <option key={texto(g.grupo)} value={texto(g.grupo)}>{texto(g.rotulo).slice(0, 170)} ({num(g.edicoes)} {t('edições', 'editions')}, {num(g.de)}–{num(g.ate)})</option>)}
            </select>
          </div>
          {numerica && (
            <div className="campo">
              <label htmlFor="e-est">{t('Medida', 'Measure')}</label>
              <select id="e-est" value={estat} onChange={(e) => setEstat(e.target.value as 'media' | 'soma' | 'n')}>
                <option value="media">{t('Média por território', 'Mean per territory')}</option>
                <option value="soma">{t('Soma', 'Total')}</option>
                <option value="n">{t('Territórios com resposta', 'Territories with an answer')}</option>
              </select>
            </div>
          )}
        </div>
        <Estado carregando={busca.carregando} erro={busca.erro} tentarNovamente={busca.recarregar}
          vazio={!busca.carregando && !grupos.length && t('Nenhuma pergunta aparece em mais de uma edição com este trecho.', 'No question appears in more than one edition with this text.')} />
      </section>
      {grupo && (
        <>
          <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar} />
          {porAno.length > 0 && (
            <CartaoGrafico titulo={texto(grupo.rotulo).slice(0, 200)}
              desc={numerica ? t('Brasil, entre os territórios que responderam', 'Brazil, among territories that answered')
                : t('Participação de cada resposta entre as respostas válidas; só as quatro mais frequentes', 'Share of each answer among valid answers; only the four most frequent')}
              acoes={<BotoesExportar nome={`${pesquisa}_evolucao_${texto(grupo.grupo)}`} obter={() => ({
                colunas: [t('Edição', 'Edition'), t('Respostas válidas', 'Valid answers'), ...(numerica ? [t('Soma', 'Sum'), t('Média', 'Mean')] : respostas.map((r) => `${r} (%)`)), t('Pergunta na edição', 'Question in the edition')],
                linhas: porAno.map((p) => [p.ano, numerica ? p.nNum : p.total, ...(numerica ? [p.soma, p.media] : respostas.map((r) => (p.total ? (Number(p.validas.find((v) => v.valor_txt === r)?.n ?? 0) / p.total) : null))), p.perguntas.join(' | ')]),
                metadados: [[t('Pesquisa', 'Survey'), nomePesquisa(pesquisa)], [t('Recorte', 'Scope'), t('Brasil', 'Brazil')], [t('Aviso', 'Warning'), avisoComparacao()],
                  [t('Base do percentual', 'Percentage base'), notaSemResposta()], [t('Fonte', 'Source'), fonteMunic()], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]],
              })} />}
              tabela={<div className="rolagem"><table><thead><tr><th>{t('Edição', 'Edition')}</th><th>n</th>{numerica ? <><th>{t('Soma', 'Sum')}</th><th>{t('Média', 'Mean')}</th></> : respostas.map((r) => <th key={r}>{r.slice(0, 40)}</th>)}</tr></thead>
                <tbody>{porAno.map((p) => <tr key={p.ano}><td>{p.ano}</td><td>{numero(numerica ? p.nNum : p.total)}</td>
                  {numerica ? <><td>{numero(p.soma)}</td><td>{numero1(p.media)}</td></> : respostas.map((r) => <td key={r}>{pctTxt(p.total ? Number(p.validas.find((v) => v.valor_txt === r)?.n ?? 0) / p.total : null)}</td>)}</tr>)}</tbody></table></div>}>
              <Grafico nome={`${pesquisa}_evolucao`} opcao={linhas(anos, series, formato)} />
            </CartaoGrafico>
          )}
          {porAno.length > 0 && (
            <section className="cartao">
              <h3>{t('A pergunta em cada edição', 'The question in each edition')}</h3>
              <p className="desc">{t('Confira se o enunciado e o código mudaram. Edições sem linha aqui não fizeram a pergunta.', 'Check whether the wording and code changed. Editions with no row here did not ask the question.')}</p>
              <div className="rolagem"><table><thead><tr><th>{t('Edição', 'Edition')}</th><th style={{ textAlign: 'left' }}>{t('Código e enunciado', 'Code and wording')}</th></tr></thead>
                <tbody>{porAno.map((p) => <tr key={p.ano}><td>{p.ano}</td><td style={{ textAlign: 'left' }}>{p.perguntas.map((x) => <div key={x}>{x}</div>)}</td></tr>)}</tbody></table></div>
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------------- ficha do município ou do estado ----------------

export function MunicTerritorio() {
  const { sp, pesquisa, definir } = useEscolhas();
  const { anos: anosMeta, geradoEm } = useMetaMunic(pesquisa);
  const [filtro, setFiltro] = useState('');
  const anos = [...anosMeta].sort((a, b) => b - a);
  const ano = anos.includes(Number(sp.get('ano'))) ? Number(sp.get('ano')) : anos[0];
  const uf = UFS.includes(sp.get('uf') ?? '') ? sp.get('uf')! : '';
  const lugares = useApi<Linha[]>(ano ? 'munic_territorios' : null, { pesquisa, ano, uf: pesquisa === 'munic' ? uf : '' });
  const cod = Number(sp.get('cod')) || num(lugares.dados?.[0]?.cod);
  const lugar = (lugares.dados ?? []).find((r) => num(r.cod) === cod);
  const ficha = useApi<Linha[]>(ano && cod && lugar ? 'munic_ficha' : null, { pesquisa, ano, cod });
  const termo = semAcento(filtro.trim());
  const respostas = useMemo(() => (ficha.dados ?? [])
    .filter((r) => !termo || semAcento(`${texto(r.rotulo)} ${texto(r.valor_txt)}`).includes(termo))
    .sort((a, b) => texto(a.aba).localeCompare(texto(b.aba), 'pt-BR') || compararVar(texto(a.var), texto(b.var))), [ficha.dados, termo]);
  const resposta = (r: Linha) => (r.valor_txt !== null ? texto(r.valor_txt) : (num(r.valor_num) ?? 0).toLocaleString(local(), { maximumFractionDigits: 2 }));

  if (!anosMeta.length) return <><h2 className="titulo-pagina">{t('Ficha do território', 'Territory profile')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Ficha do território', 'Territory profile')}</h2>
      <p className="subtitulo">{nomePesquisa(pesquisa)} <Dica rotulo={t('Fonte', 'Source')}>{fonteMunic()}</Dica></p>
      <section className="cartao">
        <div className="filtros">
          <SeletorPesquisa pesquisa={pesquisa} mudar={(p) => definir({ pesq: p === 'munic' ? null : p, ano: null, uf: null, cod: null })} />
          <div className="campo">
            <label htmlFor="t-ano">{t('Edição', 'Edition')}</label>
            <select id="t-ano" value={ano ?? ''} onChange={(e) => definir({ ano: e.target.value, cod: null })}>{anos.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          {pesquisa === 'munic' && (
            <div className="campo">
              <label htmlFor="t-uf">UF</label>
              <select id="t-uf" value={uf} onChange={(e) => definir({ uf: e.target.value, cod: null })}>
                <option value="">{t('todas', 'all')}</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}
          <div className="campo">
            <label htmlFor="t-cod">{pesquisa === 'munic' ? t('Município', 'Municipality') : t('Estado', 'State')}</label>
            <select id="t-cod" value={cod ?? ''} onChange={(e) => definir({ cod: e.target.value })}>
              {(lugares.dados ?? []).map((r) => <option key={texto(r.cod)} value={texto(r.cod)}>{texto(r.nome)}{pesquisa === 'munic' && !uf ? ` (${texto(r.uf)})` : ''}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="t-f">{t('Filtrar respostas', 'Filter answers')}</label>
            <input id="t-f" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder={t('palavra da pergunta ou da resposta', 'word from the question or the answer')} />
          </div>
        </div>
        <Estado carregando={lugares.carregando} erro={lugares.erro} tentarNovamente={lugares.recarregar}
          vazio={!lugares.carregando && !(lugares.dados ?? []).length && t('Nenhum território nesta edição e UF.', 'No territory in this edition and state.')} />
      </section>
      {lugar && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{texto(lugar.nome)}{pesquisa === 'munic' ? ` (${texto(lugar.uf)})` : ''} · {ano}</h3>
              <p className="desc">{ficha.dados ? t(`${numero(respostas.length)} de ${numero(ficha.dados.length)} respostas`, `${numero(respostas.length)} of ${numero(ficha.dados.length)} answers`) : ''}
                {num(lugar.populacao) ? ` · ${t('população', 'population')} ${numero(num(lugar.populacao))}` : ''}{lugar.faixa ? ` · ${texto(lugar.faixa)}` : ''}. {t('Respostas "Não aplicável", "Não informou" e afins aparecem como estão; pergunta sem resposta não aparece.', 'Answers such as "Not applicable" and "Did not report" appear as given; unanswered questions do not appear.')}</p>
            </div>
            <BotoesExportar nome={`${pesquisa}_${ano}_${texto(lugar.nome)}`} obter={() => ({
              colunas: [t('Tema', 'Topic'), t('Código', 'Code'), t('Pergunta', 'Question'), t('Resposta', 'Answer'), t('Resposta válida', 'Valid answer')],
              linhas: respostas.map((r) => [texto(r.aba), texto(r.var), texto(r.rotulo), resposta(r), !!r.valida]),
              metadados: [[t('Pesquisa', 'Survey'), nomePesquisa(pesquisa)], [t('Território', 'Territory'), `${texto(lugar.nome)} (${texto(lugar.uf)})`], [t('Edição', 'Edition'), String(ano)],
                [t('Fonte', 'Source'), fonteMunic()], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]],
            })} />
          </div>
          <Estado carregando={ficha.carregando} erro={ficha.erro} tentarNovamente={ficha.recarregar} />
          {respostas.length > 0 && (
            <div className="rolagem">
              <table className="tabela-fixa">
                <thead><tr><th>{t('Tema', 'Topic')}</th><th>{t('Pergunta', 'Question')}</th><th>{t('Resposta', 'Answer')}</th></tr></thead>
                <tbody>{respostas.slice(0, 400).map((r) => (
                  <tr key={texto(r.var)}><td>{texto(r.aba)}</td><td>{texto(r.rotulo)} <small>({texto(r.var)})</small></td><td style={r.valida ? undefined : { opacity: 0.6 }}>{resposta(r)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {respostas.length > 400 && <p className="legenda-tabela">{t(`Mostrando 400 de ${numero(respostas.length)}: use o filtro ou exporte para ver todas.`, `Showing 400 of ${numero(respostas.length)}: use the filter or export to see all.`)}</p>}
        </section>
      )}
    </>
  );
}

// ---------------- metodologia ----------------

export function MunicMetodologia() {
  const { meta } = useDados();
  const munic = useMetaMunic('munic');
  const estadic = useMetaMunic('estadic');
  const faixa = (a: number[]) => (a.length ? `${a[0]}–${a.at(-1)} (${a.join(', ')})` : t('não publicada', 'not published'));
  const temas = useApi<Linha[]>(munic.anos.length ? 'munic_temas' : null, { pesquisa: 'munic' });
  const resumo = useMemo(() => {
    const m = new Map<number, { temas: number; perguntas: number }>();
    for (const r of temas.dados ?? []) {
      const x = m.get(Number(r.ano)) ?? { temas: 0, perguntas: 0 };
      x.temas += 1; x.perguntas += Number(r.perguntas);
      m.set(Number(r.ano), x);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [temas.dados]);
  return (
    <>
      <h2 className="titulo-pagina">{t('MUNIC e ESTADIC: fontes e metodologia', 'MUNIC and ESTADIC: sources and methodology')}</h2>
      <section className="cartao texto">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>MUNIC</strong>: {t('Pesquisa de Informações Básicas Municipais do IBGE, respondida pelas prefeituras. Edições com base por município', 'IBGE’s Survey of Basic Municipal Information, answered by city halls. Editions with municipal microdata')}: {faixa(munic.anos)}. {t('Não houve pesquisa em 2003, 2007, 2010, 2016 e 2022; as tabelas de 2001 e 2002 não trazem a base por município e ficam de fora.', 'There was no survey in 2003, 2007, 2010, 2016 and 2022; the 2001 and 2002 tables have no municipal data and are left out.')}</li>
          <li><strong>ESTADIC</strong>: {t('Pesquisa de Informações Básicas Estaduais, respondida pelos governos dos estados e do DF', 'Survey of Basic State Information, answered by the governments of the states and the Federal District')}: {faixa(estadic.anos)}. {t('A edição de assistência social de 2012 tem códigos próprios (prefixo AS).', 'The 2012 social assistance edition has its own codes (prefix AS).')}</li>
        </ul>
        <h3>{t('Como ler', 'How to read')}</h3>
        <ul>
          <li>{t('Só o bloco de recursos humanos se repete em todas as edições da MUNIC. Os demais temas (habitação, transporte, meio ambiente, saúde, educação, assistência social, segurança, direitos humanos, tecnologia…) rodam por edição e voltam a cada três a seis anos, às vezes reformulados. Por isso o painel mostra uma edição por vez e liga as perguntas entre edições só quando o enunciado é o mesmo.', 'Only the human resources block repeats in every MUNIC edition. The other topics (housing, transport, environment, health, education, social assistance, security, human rights, technology…) rotate by edition and return every three to six years, sometimes reworded. So the panel shows one edition at a time and links questions across editions only when the wording is the same.')}</li>
          <li>{t('São declarações dos gestores sobre a existência de estruturas, instrumentos e políticas, não medidas de resultado ou de qualidade. "Ter conselho" ou "ter plano" não diz se funciona.', 'These are managers’ declarations about the existence of structures, instruments and policies, not measures of outcome or quality. "Having a council" or "having a plan" does not say whether it works.')}</li>
          <li>{notaSemResposta()}</li>
          <li>{t('Os percentuais por UF e por faixa são a participação entre os municípios (ou estados) que responderam, não entre a população. A faixa de porte usa a população do ano da edição (estimativa da SVS/MS ou a população trazida na própria base, nas edições recentes), com as mesmas faixas em todas as edições.', 'Percentages by state and bracket are the share among municipalities (or states) that answered, not of the population. The size bracket uses the population of the edition year (SVS/MS estimate or the population given in the base itself, in recent editions), with the same brackets in every edition.')}</li>
          <li>{t('O enunciado completo de cada pergunta vem do dicionário de cada edição (tema, subtítulo e pergunta-mãe). A ligação entre edições é automática, pelo enunciado sem acentos, números de nota e pontuação, e deve ser conferida a cada uso.', 'The full wording of each question comes from the dictionary of each edition (topic, subtitle and parent question). The link across editions is automatic, by wording without accents, note numbers and punctuation, and should be checked each time.')}</li>
        </ul>
        <h3>{t('O que fica de fora, de propósito', 'What is left out on purpose')}</h3>
        <ul>
          <li>{t('Dados de pessoas identificáveis: a aba do prefeito (sexo, idade, escolaridade, partido) e a estrutura política das primeiras edições; nome, e-mail, telefone, endereço e site dos gestores; e o perfil (sexo, idade, cor ou raça, escolaridade) do titular de cada órgão estadual ou municipal.', 'Data on identifiable people: the mayor tab (sex, age, schooling, party) and the political structure of the early editions; names, e-mails, phones, addresses and websites of managers; and the profile (sex, age, race or colour, schooling) of the head of each state or municipal body.')}</li>
          <li>{t('Perguntas de resposta em texto livre (muitas respostas distintas): não há como agregá-las.', 'Free-text questions (many distinct answers): they cannot be aggregated.')}</li>
          <li>{t('As variáveis externas que o IBGE junta às bases (população, região): a faixa de porte é calculada aqui com uma regra única.', 'The external variables IBGE adds to the bases (population, region): the size bracket is computed here with a single rule.')}</li>
        </ul>
        {resumo.length > 0 && (
          <>
            <h3>{t('Perguntas publicadas por edição da MUNIC', 'Questions published by MUNIC edition')}</h3>
            <div className="rolagem">
              <table><thead><tr><th>{t('Edição', 'Edition')}</th><th>{t('Temas', 'Topics')}</th><th>{t('Perguntas', 'Questions')}</th></tr></thead>
                <tbody>{resumo.map(([a, x]) => <tr key={a}><td>{a}</td><td>{numero(x.temas)}</td><td>{numero(x.perguntas)}</td></tr>)}</tbody></table>
            </div>
          </>
        )}
        <p className="nota-base">{t('Versão da base', 'Data version')}: {meta.geradoEm} · {t('processado em', 'processed on')} {munic.processadoEm ?? '–'}</p>
      </section>
    </>
  );
}
