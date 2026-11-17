import { useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSocial } from "../assistencia_dados";
import { Estado } from "../components/Kpi";
import { Grafico, linhas } from "../components/Grafico";
import { exportar, type Tabela } from "../exportar";
import { idioma, local, t } from "../idioma";
import { UF_NOMES } from "../ufs";
import { indicadorCadunicoLocal, linkHistoricoCadunico } from '../cadunico_historico';
import {
  obterComparacoes,
  obterGeografiaComparacao,
  obterGrupoComparacao,
  obterListaComparacao,
  obterListaReferencias,
  enderecoDownloadHistorico,
  type AreaComparacao,
  type CatalogoComparacao,
  type DefComparacao,
  type GeografiaComparacao,
  type GrupoComparacao,
  type LinhaComparacao,
} from "../comparacoes_dados";
import {
  condicaoComparacao,
  efetivoComparacao,
  formatoComparacao,
  nomeTerritorioComparacao,
  normComparacao,
  periodoComparacao,
  ranquearComparacao,
  referenciasComparacao,
  serieEfetivaComparacao,
  textoComparacao,
  variacaoComparacao,
  periodosComparaveis,
  rupturaComparacao,
} from "../comparacoes_apresentacao";
import "../comparacoes.css";

export const RAIZES_COMPARACAO: Record<AreaComparacao, string> = {
  assistencia: "/assistencia",
  educacao: "/educacao",
  saude: "/datasus",
  trabalho: "/trabalho",
  saneamento: "/saneamento",
  financas: "",
  clima: "/clima",
  gestao: "/munic",
};
const titulos: Record<AreaComparacao, [string, string]> = {
  assistencia: ["Assistência social", "Social assistance"],
  educacao: ["Educação", "Education"],
  saude: ["Saúde", "Health"],
  trabalho: ["Mercado de trabalho", "Labour market"],
  saneamento: ["Saneamento", "Sanitation"],
  financas: ["Finanças públicas", "Public finances"],
  clima: ["Clima", "Climate"],
  gestao: ["Gestão pública", "Public management"],
};
const padroes: Record<AreaComparacao, string> = {
  assistencia: "cad_qtd_familias",
  educacao: "mat_total",
  saude: "mortalidade_infantil",
  trabalho: "por_mil",
  saneamento: "agua_cobertura_pct",
  financas: "fin_receita_liquida",
  clima: "chuva_mm",
  gestao: "m_rh_direta_16",
};
const numero = (v: number) => v.toLocaleString(local());
const nome = (i: DefComparacao) => textoComparacao(i, "nome");
const anterior = (pp: number[], fim: number) =>
  pp.filter((p) => p < fim && p <= fim - (fim > 10000 ? 100 : 5)).at(-1) ??
  pp.filter((p) => p < fim).at(-1) ??
  fim;

function BuscaMunicipio({
  g,
  atual,
  mudar,
}: {
  g: GeografiaComparacao;
  atual: string | null;
  mudar: (cod: string) => void;
}) {
  const id = useId(),
    [busca, setBusca] = useState<string | null>(null),
    [aberta, setAberta] = useState(false),
    [ativo, setAtivo] = useState(0);
  const opcoes = useMemo(() => {
    const q = normComparacao(busca?.trim() ?? "");
    if (q.length < 2) return [];
    return g.municipios
      .filter(
        (x) => normComparacao(x[1]).includes(q) || String(x[0]).startsWith(q),
      )
      .sort(
        (a, b) =>
          Number(normComparacao(b[1]).startsWith(q)) -
            Number(normComparacao(a[1]).startsWith(q)) ||
          a[1].localeCompare(b[1], "pt-BR"),
      )
      .slice(0, 12);
  }, [g, busca]);
  const escolher = (cod: string) => {
    mudar(cod);
    setBusca(null);
    setAberta(false);
    setAtivo(0);
  };
  return (
    <div className="cp-busca">
      <label htmlFor={id}>
        {t(
          "Município — busque em todo o Brasil",
          "Municipality — search across Brazil",
        )}
      </label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={aberta && opcoes.length > 0}
        aria-controls={`${id}-lista`}
        aria-activedescendant={
          aberta && opcoes[ativo] ? `${id}-${ativo}` : undefined
        }
        value={
          busca ??
          (atual && g.territorios[atual]
            ? nomeTerritorioComparacao(g, atual)
            : "")
        }
        placeholder={t(
          "Nome ou código IBGE; não precisa escolher estado",
          "Name or IBGE code; no state selection needed",
        )}
        onFocus={() => setAberta(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberta(true);
          setAtivo(0);
        }}
        onBlur={() => setAberta(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAberta(true);
            setAtivo((a) => Math.min(a + 1, opcoes.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
          }
          if (e.key === "Escape") {
            setAberta(false);
            setBusca(null);
          }
          if (e.key === "Enter" && aberta && opcoes[ativo]) {
            e.preventDefault();
            escolher(String(opcoes[ativo][0]));
          }
        }}
      />
      {aberta && busca !== null && (
        <div
          className="cp-opcoes"
          id={`${id}-lista`}
          role="listbox"
          aria-label={t("Municípios encontrados", "Municipality results")}
        >
          {opcoes.length ? (
            opcoes.map(([cod, n, uf], k) => (
              <button
                type="button"
                role="option"
                id={`${id}-${k}`}
                aria-selected={ativo === k}
                key={cod}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(String(cod))}
              >
                {n} ({uf}) · {cod}
              </button>
            ))
          ) : (
            <p>
              {t(
                "Digite ao menos duas letras; nenhum resultado nesta busca.",
                "Type at least two letters; no results for this search.",
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
function Baixar({
  tabela,
  nomeArquivo,
}: {
  tabela: Tabela;
  nomeArquivo: string;
}) {
  return (
    <div className="cp-acoes">
      {t("Baixar esta comparação:", "Download this comparison:")}
      <button
        className="botao-leve"
        onClick={() =>
          exportar(nomeArquivo, "csv", tabela, idioma() === "en" ? "." : ",")
        }
      >
        CSV
      </button>
      <button
        className="botao-leve"
        onClick={() =>
          exportar(nomeArquivo, "xlsx", tabela, idioma() === "en" ? "." : ",")
        }
      >
        XLSX
      </button>
    </div>
  );
}
export function Comparacoes({
  area,
  rankings = false,
}: {
  area: AreaComparacao;
  rankings?: boolean;
}) {
  const [sp, setSp] = useSearchParams();
  const [busca, setBusca] = useState("");
  const raiz = RAIZES_COMPARACAO[area];
  const rede =
    area === 'assistencia' && sp.get('conjunto') === 'cadunico_historico'
      ? 'cadunico_historico'
      : area === "educacao"
      ? (sp.get("rede") ?? "todas")
      : area === "gestao" && sp.get("pesq") === "estadic"
        ? "estadic"
        : "todas";
  const catalogo = useSocial(`cp:${area}:${rede}`, async () => {
    const m = await obterComparacoes(area, rede);
    return { m, g: await obterGeografiaComparacao(m) };
  });
  const mudar = (campos: Record<string, string | null>) =>
    setSp(
      (atual) => {
        const p = new URLSearchParams(atual);
        if ("cod" in campos) p.delete("ente");
        if (
          ["cod", "uf", "recorte"].some((k) => k in campos) &&
          !("coorte" in campos)
        )
          p.delete("coorte");
        if ("indicador" in campos && !("minimo" in campos)) p.delete("minimo");
        for (const [k, v] of Object.entries(campos))
          if (v === null || (v === "" && k !== "comparar")) p.delete(k);
          else p.set(k, v);
        return p;
      },
      { replace: true },
    );
  const vistaRanking = sp.get("vista")
    ? sp.get("vista") === "ranking"
    : rankings;
  const retorno = new URLSearchParams(
    Object.fromEntries(
      [...sp].filter(([k]) =>
        ["cod", "uf", "ano", "rede", "pesq", "lang"].includes(k),
      ),
    ),
  );
  if (["trabalho", "saude", "financas"].includes(area) && sp.get("cod"))
    retorno.set("ente", sp.get("cod") === "5300108" ? "53" : sp.get("cod")!);
  const nav = (vista: string) => ({
    pathname: `${raiz}/comparar`,
    search:
      "?" +
      new URLSearchParams({ ...Object.fromEntries(sp), vista }).toString(),
  });
  return (
    <>
      <h2 className="titulo-pagina">
        {t(...titulos[area])}:{" "}
        {t("comparações e evolução", "comparisons and trends")}
      </h2>
      <p className="cp-intro">
        {t(
          "Compare lugares de tamanhos diferentes com taxas, proporções ou valores por habitante. Veja a evolução no tempo e as referências da sua região. Os números já estão prontos.",
          "Compare places of different sizes using rates, shares or values per inhabitant. Explore changes over time and regional references. Figures are already prepared.",
        )}
      </p>
      <nav
        className="cp-nav"
        aria-label={t("Análises de comparação", "Comparison analyses")}
      >
        <Link
          to={nav("evolucao")}
          aria-current={!vistaRanking ? "page" : undefined}
        >
          {t("Comparar e acompanhar", "Compare and track")}
        </Link>
        <Link
          to={nav("ranking")}
          aria-current={vistaRanking ? "page" : undefined}
        >
          {t("Rankings relativos", "Relative rankings")}
        </Link>
        <Link
          to={{
            pathname: raiz || "/receitas",
            search: "?" + retorno.toString(),
          }}
        >
          {t("Voltar ao painel", "Back to dashboard")}
        </Link>
      </nav>
      {area === 'assistencia' && rede !== 'cadunico_historico' && <p className="cp-nota"><Link to={linkHistoricoCadunico(sp)}>{t('Histórico do CadÚnico: séries oficiais de SP, PA e MG e famílias no Brasil →', 'Cadastro Único history: official SP, PA and MG series and families in Brazil →')}</Link></p>}
      {catalogo.carregando && <Estado carregando />}
      {catalogo.erro && (
        <Estado erro={catalogo.erro} tentarNovamente={catalogo.recarregar} />
      )}
      {catalogo.dados && (
        <Conteudo
          key={`${area}:${rede}`}
          area={area}
          m={catalogo.dados.m}
          g={catalogo.dados.g}
          sp={sp}
          mudar={mudar}
          vistaRanking={vistaRanking}
          busca={busca}
          setBusca={setBusca}
        />
      )}
    </>
  );
}
type PropsConteudo = {
  area: AreaComparacao;
  m: CatalogoComparacao;
  g: GeografiaComparacao;
  sp: URLSearchParams;
  mudar: (p: Record<string, string | null>) => void;
  vistaRanking: boolean;
  busca: string;
  setBusca: (s: string) => void;
};
function Conteudo({
  area,
  m,
  g,
  sp,
  mudar,
  vistaRanking,
  busca,
  setBusca,
}: PropsConteudo) {
  const estadual = area === "gestao" && m.rede === "estadic";
  const historicoCadunico = area === 'assistencia' && m.rede === 'cadunico_historico';
  const codRaw = (sp.get("cod") ?? sp.get("ente"))?.trim().toUpperCase(),
    cod = codRaw === "53" && !estadual ? "5300108" : codRaw;
  const codValido =
    cod && /^\d{7}$/.test(cod) && g.territorios[cod]?.nivel === "M"
      ? cod
      : null;
  const ufPedida = sp.get("uf")?.trim().toUpperCase();
  const ufCodigo =
    cod && Object.hasOwn(UF_NOMES, cod)
      ? cod
      : g.governos.find((x) => x[0] === `E:${cod}`)?.[2];
  const estado =
    cod === "BR"
      ? "BR"
      : codValido
        ? g.territorios[codValido].uf!
        : (ufCodigo ??
          (Object.hasOwn(UF_NOMES, ufPedida ?? "") ? ufPedida! : "BR"));
  const estadoGoverno = g.governos.find((x) => x[2] === estado)?.[0];
  const recorte = sp.get("recorte"),
    grupo = estadual
      ? (estadoGoverno ?? "E:BR")
      : recorte && m.quantidades[recorte]
        ? recorte
        : (codValido ?? estado);
  const legadoTrabalho: Record<string, string> = {
    empregos: "empregos",
    empregos_por_mil: "por_mil",
    remuneracao_media: "rem_media",
    var_empregos: "variacao_pct",
    saldo_caged: "caged_saldo",
    pct_mulheres: "mulheres",
    pct_superior: "superior",
    pct_adm_publica: "setor_adm_publica",
  };
  const idPedido =
    sp.get("indicador") ??
    sp.get("ind") ??
    (area === "trabalho"
      ? legadoTrabalho[(sp.get("rord") ?? "").split(":")[0]]
      : null);
  const baseInd =
    m.indicadores.find((i) => i.id === idPedido) ??
    (historicoCadunico ? m.indicadores.find(i => i.id === indicadorCadunicoLocal(estado)) : null) ??
    m.indicadores.find(
      (i) => i.id === (estadual ? "e_rh_direta_16" : padroes[area]),
    ) ??
    (area === "gestao" ? m.indicadores.find((i) => !i.binario) : null) ??
    m.indicadores[0];
  const i = baseInd,
    idx = m.indicadores.indexOf(i),
    pp = i.periodos_com_valor ?? i.periodos;
  const periodoRaw = Number(
    sp.get("periodo") ?? sp.get("mes") ?? sp.get("ano"),
  );
  const pedido =
    periodoRaw > 0 && i.frequencia === "mensal" && periodoRaw < 10000
      ? periodoRaw * 100 + 12
      : periodoRaw;
  const fim = pedido > 0 ? pedido : (pp.at(-1) ?? 0);
  const inicioPedido = Number(sp.get("inicio")),
    inicio = inicioPedido > 0 ? inicioPedido : anterior(pp, fim);
  const ressalvas = sp.get("ressalvas") === "1";
  const refs = referenciasComparacao(g, grupo).filter((k) => m.quantidades[k]);
  const escolhidos = sp.has("comparar")
    ? sp
        .get("comparar")!
        .split(",")
        .filter((k) => refs.includes(k))
    : refs;
  const grupos = [grupo, ...escolhidos];
  const series = useSocial(
    `series:${area}:${m.rede}:${m.indices.referencias?.sha256}:${grupos.join(",")}`,
    async () =>
      Object.fromEntries(
        await Promise.all(
          grupos.map(
            async (k) => [k, await obterGrupoComparacao(m, g, k)] as const,
          ),
        ),
      ),
  );
  const opcoes = m.indicadores.filter(
    (x) =>
      (x.periodos_com_valor ?? x.periodos).length > 0 &&
      normComparacao(`${x.nome} ${x.nome_en} ${x.tema} ${x.id}`).includes(
        normComparacao(busca),
      ),
  );
  const itensRegiao = codValido
    ? [
        codValido,
        g.territorios[codValido].imediata!,
        g.territorios[codValido].intermediaria!,
      ]
    : grupo.startsWith("I:") || grupo.startsWith("T:")
      ? [grupo]
      : [];
  const configuracao = [
    m.geografia.sha256,
    area,
    m.rede,
    i.id,
    grupo,
    inicio,
    fim,
    ressalvas,
  ].join(":");
  const invalidos =
    (!!idPedido && idPedido !== i.id) ||
    (!!ufPedida &&
      (!Object.hasOwn(UF_NOMES, ufPedida) || (!!cod && estado !== ufPedida))) ||
    (!!recorte && !m.quantidades[recorte]) ||
    (!!cod &&
      !codValido &&
      cod !== "BR" &&
      !Object.hasOwn(UF_NOMES, cod) &&
      !ufCodigo);
  return (
    <>
      <section className="cartao">
        {area === 'assistencia' && <div className="cp-filtros"><div>
          <label htmlFor="cp-conjunto">{t('Conjunto de dados', 'Dataset')}</label>
          <select id="cp-conjunto" value={historicoCadunico ? 'cadunico_historico' : 'todas'} onChange={e => {
            setBusca('');
            mudar({ conjunto: e.target.value === 'todas' ? null : e.target.value, indicador: null, ind: null, inicio: null, periodo: null, ano: null, mes: null, minimo: null, coorte: null, comparar: null });
          }}>
            <option value="todas">{t('Todos os indicadores: retrato atual e pagamentos', 'All indicators: current snapshot and payments')}</option>
            <option value="cadunico_historico">{t('CadÚnico: históricos oficiais (SP, PA e MG)', 'Cadastro Único: official history (SP, PA and MG)')}</option>
          </select>
        </div></div>}
        {historicoCadunico && <aside className="cp-aviso" aria-label={t('Abrangência do histórico', 'Historical coverage')}>
          <strong>{t(i.cobertura_titulo ?? 'São Paulo: 645 municípios, 01/2018 a 08/2026; Brasil: famílias.', i.cobertura_titulo_en ?? 'São Paulo: 645 municipalities, Jan/2018 to Aug/2026; Brazil: families.')}</strong>
          <p>{t('Escolha o indicador: SP tem famílias e pessoas mensais; PA, famílias por ano (2013–2024); MG, percentual da população por ano (2014–2024). As fontes e frequências permanecem separadas. Outros estados ainda não têm histórico recuperado.', 'Choose a measure: SP has monthly families and people; PA, families by year (2013–2024); MG, population percentage by year (2014–2024). Sources and frequencies stay separate. Other states still have no recovered history.')}</p>
          {i.frequencia === 'anual'
            ? <p>{t(i.cobertura_nota ?? i.alerta ?? '', i.cobertura_nota_en ?? i.alerta_en ?? '')}</p>
            : <p>{t('04/2025 fica sem valor por divergência de referência entre as fontes. Esta série não é emendada ao retrato de 10/2026. Cadastros não equivalem a benefícios recebidos.', 'Apr/2025 stays missing due to a reference-month discrepancy between sources. This series is not spliced with the Oct/2026 snapshot. Registrations are not benefits received.')}</p>}
          {i.ufs_historico && estado !== 'BR' && !i.ufs_historico.includes(estado) && <p>
            {t('O indicador escolhido não cobre este estado.', 'The chosen measure does not cover this state.')} {' '}
            {['PA', 'MG', 'SP'].includes(estado) && <button className="botao-leve" onClick={() => mudar({indicador: indicadorCadunicoLocal(estado), inicio: null, periodo: null, ano: null, mes: null})}>{t('Ver histórico disponível neste estado', 'View available history for this state')}</button>}
          </p>}
        </aside>}
        <div className="cp-filtros">
          <div>
            <label htmlFor="cp-estado">
              {estadual
                ? t("Governo estadual", "State government")
                : t("Brasil ou estado", "Brazil or state")}
            </label>
            <select
              id="cp-estado"
              value={estado}
              onChange={(e) =>
                mudar({
                  uf: e.target.value === "BR" ? null : e.target.value,
                  cod: null,
                  recorte: null,
                  comparar: null,
                })
              }
            >
              <option value="BR">
                {estadual
                  ? t("Todos os governos estaduais", "All state governments")
                  : t("Brasil · todos os estados", "Brazil · all states")}
              </option>
              {Object.entries(UF_NOMES).map(([uf, [n]]) => (
                <option key={uf} value={uf}>
                  {n} ({uf})
                </option>
              ))}
            </select>
          </div>
          {!estadual && (
            <BuscaMunicipio
              g={g}
              atual={codValido}
              mudar={(c) =>
                mudar({
                  cod: c,
                  uf: g.territorios[c].uf,
                  recorte: null,
                  comparar: null,
                })
              }
            />
          )}
          {!estadual && itensRegiao.length > 0 && (
            <div>
              <label htmlFor="cp-recorte">
                {t("Lugar em foco", "Focus area")}
              </label>
              <select
                id="cp-recorte"
                value={grupo}
                onChange={(e) =>
                  mudar({
                    recorte:
                      e.target.value === codValido ? null : e.target.value,
                    comparar: null,
                  })
                }
              >
                {itensRegiao.map((k) => (
                  <option key={k} value={k}>
                    {nomeTerritorioComparacao(g, k)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {area === "gestao" && (
            <div>
              <label htmlFor="cp-pesquisa">{t("Pesquisa", "Survey")}</label>
              <select
                id="cp-pesquisa"
                value={m.rede}
                onChange={(e) =>
                  mudar({
                    pesq: e.target.value === "estadic" ? "estadic" : "munic",
                    recorte: null,
                    indicador: null,
                    inicio: null,
                    periodo: null,
                    ano: null,
                    mes: null,
                    comparar: null,
                  })
                }
              >
                <option value="todas">
                  MUNIC · {t("prefeituras", "city governments")}
                </option>
                <option value="estadic">
                  ESTADIC · {t("governos estaduais", "state governments")}
                </option>
              </select>
            </div>
          )}
          {area === "educacao" && (
            <div>
              <label htmlFor="cp-rede">
                {t("Rede de ensino", "School sector")}
              </label>
              <select
                id="cp-rede"
                value={m.rede}
                onChange={(e) => mudar({ rede: e.target.value })}
              >
                {[
                  ["todas", t("Todas as redes", "All school sectors")],
                  ["publica", t("Pública", "Public")],
                  ["municipal", t("Municipal", "Municipal")],
                  ["estadual", t("Estadual", "State")],
                  ["federal", t("Federal", "Federal")],
                  ["privada", t("Privada", "Private")],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <p className="cp-recorte-atual">
          {nomeTerritorioComparacao(g, grupo)}{" "}
          <button
            className="botao-leve"
            onClick={() => mudar({ cod: null, recorte: null, comparar: null })}
          >
            {t("Limpar município", "Clear municipality")}
          </button>
        </p>
        <div className="cp-filtros">
          <div>
            <label htmlFor="cp-busca-ind">
              {t("Buscar indicador", "Find an indicator")}
            </label>
            <input
              id="cp-busca-ind"
              type="search"
              value={busca}
              placeholder={t(
                "Nome, tema ou variável",
                "Name, topic or variable",
              )}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="cp-ind">
              {t("Indicador", "Indicator")} ({opcoes.length})
            </label>
            <select
              id="cp-ind"
              value={i.id}
              onChange={(e) =>
                mudar({
                  indicador: e.target.value,
                  periodo: null,
                  inicio: null,
                  ano: null,
                  mes: null,
                })
              }
            >
              {!opcoes.some((x) => x.id === i.id) && (
                <option value={i.id}>{nome(i)}</option>
              )}
              {[...new Set(opcoes.map((x) => textoComparacao(x, "tema")))].map(
                (tema) => (
                  <optgroup key={tema} label={tema}>
                    {opcoes
                      .filter((x) => textoComparacao(x, "tema") === tema)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {nome(x)}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>
        </div>
        {invalidos && (
          <p className="cp-aviso" role="status">
            {t(
              "O endereço contém indicador ou território fora deste catálogo. A seleção exibida acima foi usada; escolha o desejado.",
              "The link contains an indicator or territory outside this catalogue. The selection shown above was used; choose the one you need.",
            )}
          </p>
        )}
        <div className="cp-controles">
          <div className="cp-campo">
            <label htmlFor="cp-inicio">
              {t("Comparar com", "Compare with")}
            </label>
            <select
              id="cp-inicio"
              value={inicio}
              onChange={(e) => mudar({ inicio: e.target.value })}
            >
              {!pp.includes(inicio) && (
                <option value={inicio}>
                  {periodoComparacao(inicio)} ·{" "}
                  {t("fora da cobertura", "outside coverage")}
                </option>
              )}
              {pp.map((p) => (
                <option key={p} value={p}>
                  {periodoComparacao(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="cp-campo">
            <label htmlFor="cp-fim">
              {t("Período em foco", "Focus period")}
            </label>
            <select
              id="cp-fim"
              value={fim}
              onChange={(e) =>
                mudar({ periodo: e.target.value, ano: null, mes: null })
              }
            >
              {!pp.includes(fim) && (
                <option value={fim}>
                  {periodoComparacao(fim)} ·{" "}
                  {t("fora da cobertura", "outside coverage")}
                </option>
              )}
              {pp.map((p) => (
                <option key={p} value={p}>
                  {periodoComparacao(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {refs.length > 0 && (
          <fieldset>
            <legend>{t("Comparar com", "Compare with")}</legend>
            <div className="cp-checkboxes">
              {refs.map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={escolhidos.includes(k)}
                    onChange={(e) =>
                      mudar({
                        comparar: (e.target.checked
                          ? [...escolhidos, k]
                          : escolhidos.filter((x) => x !== k)
                        ).join(","),
                      })
                    }
                  />
                  {nomeTerritorioComparacao(g, k)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </section>
      <section className="cartao">
        <h3>{nome(i)}</h3>
        <p>{textoComparacao(i, "descricao")}</p>
        <p className="cp-nota">
          <strong>{textoComparacao(i, "unidade")}</strong>
          {i.base_ipca
            ? ` · ${t("preços de dezembro de", "December prices of")} ${i.base_ipca} (IPCA)`
            : ""}{" "}
          · {textoComparacao(i, "normalizacao")}
        </p>
        {i.metodo_referencia === "mediana" && (
          <p className="cp-aviso">
            {t(
              "As referências são medianas dos resultados municipais disponíveis. Não são taxas, proficiências ou índices oficiais agregados do estado ou do Brasil.",
              "References are medians of available municipal results. They are not official aggregate rates, proficiency scores or state/Brazil indices.",
            )}
          </p>
        )}
        {area === "saneamento" && (
          <p className="cp-aviso">
            {t(
              "SNIS até 2022; SINISA a partir de 2023. Mudaram o sistema e algumas definições. A linha é interrompida nessa transição; a diferença entre períodos não isola uma mudança real do serviço.",
              "SNIS through 2022; SINISA from 2023. The system and some definitions changed. The line breaks at this transition; a period difference does not isolate a real service change.",
            )}
          </p>
        )}
        {area === "gestao" && (
          <p className="cp-nota">
            {estadual
              ? t(
                  "ESTADIC descreve o próprio governo estadual. Não se reparte o quadro de servidores por municípios ou regiões; a comparação é entre governos estaduais.",
                  "ESTADIC describes the state government itself. Staff are not allocated across municipalities or regions; comparisons are between state governments.",
                )
              : t(
                  "As regiões reúnem respostas das prefeituras. São características declaradas, sem nota composta ou classificação de qualidade da gestão.",
                  "Regions combine city-government answers. These are reported characteristics, without a composite management-quality score.",
                )}
          </p>
        )}
        {i.alerta && !historicoCadunico && <p className="cp-aviso">{textoComparacao(i, "alerta")}</p>}
        {i.id === "aps_potencial" && (
          <p className="cp-nota">
            {t(
              "Pode superar 100%: representa a capacidade das equipes em relação à população de referência, e não pessoas efetivamente atendidas.",
              "Can exceed 100%: this measures team capacity relative to the reference population, not people actually served.",
            )}
          </p>
        )}
        {pp.length === 0 && (
          <p className="cp-aviso">
            {t(
              "Esta medida não tem série municipal nesta rede. Escolha outra medida ou rede; as informações originais continuam nas tabelas detalhadas.",
              "This measure has no municipal time series for this school sector. Choose another measure or sector; the original information remains in the detailed tables.",
            )}
          </p>
        )}
        {pp.length === 1 && (
          <p className="cp-aviso">
            {t(
              `Retrato único: ${periodoComparacao(pp[0])}. Ainda não há série temporal deste indicador nesta edição.`,
              `Single snapshot: ${periodoComparacao(pp[0])}. This edition does not yet contain a time series for this indicator.`,
            )}
          </p>
        )}
        {pp.length > 0 &&
          (!pp.includes(inicio) || !pp.includes(fim) || inicio > fim) && (
            <p className="cp-aviso" role="status">
              {t(
                "Selecione dois períodos disponíveis, do mais antigo para o mais recente. Valores fora da cobertura permanecem sem dado.",
                "Select two available periods, from earlier to later. Periods outside coverage remain missing.",
              )}
            </p>
          )}
        {["saude", "educacao", "financas"].includes(area) && (
          <div className="cp-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={ressalvas}
                onChange={(e) =>
                  mudar({ ressalvas: e.target.checked ? "1" : null })
                }
              />
              {t(
                "Incluir resultados com ressalva de qualidade nas comparações",
                "Include results flagged for data quality in comparisons",
              )}
            </label>
          </div>
        )}
        {i.notas_anos?.[String(fim)] && (
          <p className="cp-aviso">
            {i.notas_anos[String(fim)][idioma() === "en" ? 1 : 0]}
          </p>
        )}
        {series.carregando && <Estado carregando />}
        {series.erro && (
          <Estado erro={series.erro} tentarNovamente={series.recarregar} />
        )}
        {series.dados && pp.length > 0 && (
          <Serie
            area={area}
            m={m}
            g={g}
            i={i}
            idx={idx}
            grupos={grupos}
            dados={series.dados}
            inicio={inicio}
            fim={fim}
            ressalvas={ressalvas}
            grupo={grupo}
            configuracao={configuracao}
          />
        )}
        <details className="cp-detalhes">
          <summary>
            {t(
              "Definição, cobertura e dados originais",
              "Definition, coverage and original data",
            )}
          </summary>
          {historicoCadunico && <p className="cp-nota">{textoComparacao(i, 'alerta')}</p>}
          <p className="cp-nota">
            {t(
              "As razões usam os numeradores e denominadores dos mesmos municípios com dados. A cobertura pode mudar entre períodos. Ausência, proteção da fonte e denominador zero permanecem sem valor; zero registrado continua zero.",
              "Ratios use numerators and denominators from the same municipalities with data. Coverage may change across periods. Missing data, source protections and zero denominators remain missing; recorded zero stays zero.",
            )}
          </p>
          {i.anos_base_demografica && (
            <p className="cp-nota">
              {t("Ano da população usada", "Reference population year")}:{" "}
              {periodoComparacao(fim)} →{" "}
              {i.anos_base_demografica[String(fim)] ??
                t("indisponível", "unavailable")}
              .{" "}
              {t(
                "Em 2023, usa-se o Censo de 2022, explicitamente. Famílias por 1.000 pessoas não é percentual de famílias atendidas.",
                "For 2023, the 2022 Census is used explicitly. Families per 1,000 people is not the percentage of families served.",
              )}
            </p>
          )}
          <p className="cp-nota">
            {t(
              "Regiões do IBGE: divisão de 2017, associação atual aplicada à série. Não se reconstruíram limites municipais históricos.",
              "IBGE regions: 2017 division, current association applied to the time series. Historical municipal boundaries were not reconstructed.",
            )}
          </p>
          <p className="cp-nota">
            {i.fontes.map((f, k) => (
              <span key={k}>
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.nome}
                </a>
                {" · "}
              </span>
            ))}
            <a href={g.fonte} target="_blank" rel="noreferrer">
              {t("Geografia IBGE", "IBGE geography")}
            </a>
          </p>
          {!historicoCadunico && <Link
            to={{
              pathname: "/downloads",
              search: `?area=${area}${estado !== "BR" ? "&uf=" + estado : ""}${codValido ? "&cod=" + codValido : ""}`,
            }}
          >
            {t(
              "Tabelas originais, dicionário e API para R e Stata",
              "Original tables, dictionary and API for R and Stata",
            )}
          </Link>}
          {area === "assistencia" && !historicoCadunico && (
            <p>
              <Link
                to={{
                  pathname: "/assistencia/serie",
                  search:
                    "?" +
                    new URLSearchParams({
                      ...Object.fromEntries(sp),
                      indicador: i.id,
                    }).toString(),
                }}
              >
                {t(
                  "Série original e acumulados anuais, com meses parciais identificados",
                  "Original time series and annual totals, with partial months identified",
                )}
              </Link>
            </p>
          )}
          {historicoCadunico && <div className="cp-acoes">
            <span>{t('Base histórica completa (séries mensais e anuais):', 'Complete historical dataset (monthly and yearly series):')}</span>
            {m.downloads_historico?.map(a => <a key={a.formato} href={enderecoDownloadHistorico(a)} download>{a.formato === 'dta' ? 'Stata (.dta)' : a.formato.toUpperCase()}</a>)}
            {m.dicionario_historico && <a href={enderecoDownloadHistorico(m.dicionario_historico)} download>{t('Dicionário sucinto (JSON)', 'Concise dictionary (JSON)')}</a>}
          </div>}
          {area === "educacao" && (
            <p>
              <Link
                to={{
                  pathname: "/educacao/serie",
                  search:
                    "?" +
                    new URLSearchParams({
                      ...Object.fromEntries(sp),
                      ind: i.id,
                    }).toString(),
                }}
              >
                {t(
                  "Série original e situação de cada edição do Inep",
                  "Original time series and status of each Inep edition",
                )}
              </Link>
            </p>
          )}
          {area === "trabalho" && (
            <p>
              <Link
                to={{
                  pathname: "/trabalho/rankings-detalhados",
                  search:
                    "?" +
                    new URLSearchParams({
                      ...Object.fromEntries(sp),
                      ...(codValido ? { ente: codValido } : {}),
                    }).toString(),
                }}
              >
                {t(
                  "Rankings detalhados da RAIS e evolução de posições",
                  "Detailed RAIS rankings and rank trends",
                )}
              </Link>
            </p>
          )}
        </details>
      </section>
      {vistaRanking && (
        <Lista
          key={`${i.id}:${m.rede}`}
          m={m}
          g={g}
          i={i}
          grupo={grupo}
          estado={estado}
          inicio={inicio}
          fim={fim}
          ressalvas={ressalvas}
          sp={sp}
          mudar={mudar}
        />
      )}
    </>
  );
}

function Serie({
  area,
  m,
  g,
  i,
  idx,
  grupos,
  dados,
  inicio,
  fim,
  ressalvas,
  grupo,
}: {
  area: AreaComparacao;
  m: CatalogoComparacao;
  g: GeografiaComparacao;
  i: DefComparacao;
  idx: number;
  grupos: string[];
  dados: Record<string, GrupoComparacao>;
  inicio: number;
  fim: number;
  ressalvas: boolean;
  grupo: string;
  configuracao: string;
}) {
  const pp = i.periodos,
    p1 = inicio <= fim ? pp.indexOf(inicio) : -1,
    p2 = pp.indexOf(fim),
    janela = pp.filter((p) => p >= inicio && p <= fim);
  const linhasSerie = grupos.map((k) => ({
    chave: k,
    nome: nomeTerritorioComparacao(g, k),
    municipio: ["M", "E"].includes(g.territorios[k].nivel),
    s: serieEfetivaComparacao(dados[k].dados[idx], ressalvas),
    total: dados[k].quantidade,
  }));
  const pares = linhasSerie
    .map((l) => ({
      ...l,
      a: p1 < 0 ? null : l.s.v[p1],
      b: p2 < 0 ? null : l.s.v[p2],
    }))
    .map((l) => ({
      ...l,
      delta: variacaoComparacao(
        i,
        l.a,
        l.b,
        l.municipio,
        periodosComparaveis(i, inicio, fim, l.s.c[p1], l.s.c[p2]),
      ),
    }));
  const grafico = () => {
    const eixos: (number | string)[] = [],
      indices: (number | null)[] = [];
    for (const [j, p] of janela.entries()) {
      const antes = janela[j - 1];
      const parcial = linhasSerie.some(
        (l) =>
          l.s.c[pp.indexOf(p)] === 11 ||
          (j > 0 && l.s.c[pp.indexOf(antes)] === 11),
      );
      const ruptura =
        j > 0 ? rupturaComparacao(area, i, antes, p, parcial) : null;
      if (ruptura) {
        eixos.push(
          (ruptura === "parcial"
            ? t("Período parcial", "Partial period")
            : t("Mudança de metodologia", "Methodology change")) + ` ${p}`,
        );
        indices.push(null);
      }
      eixos.push(periodoComparacao(p));
      indices.push(pp.indexOf(p));
    }
    const ss = linhasSerie
      .filter((l) => !i.binario || !l.municipio)
      .map((l) => ({
        nome: l.nome,
        valores: indices.map((k) => (k === null ? null : l.s.v[k])),
      }));
    return (
      <Grafico
        nome={`${m.area}_${i.id}_${grupo}`}
        descricao={t(
          "Evolução na unidade do indicador; lacunas não são preenchidas. Anos parciais e mudanças de método interrompem a linha. Todos os valores estão na tabela da série.",
          "Trends in the indicator unit; gaps are not filled. Partial years and methodology changes break the line. All values are in the series table.",
        )}
        altura={340}
        opcao={(cores) => {
          const paleta = [...cores.series, ...cores.comparacao];
          const op = linhas(
            eixos,
            ss,
            (v) => formatoComparacao(i, v),
            [],
            true,
          )(cores);
          return {
            ...op,
            tooltip: { ...(op.tooltip as object), confine: true },
            grid: {
              left: 8,
              right: 16,
              top: 48,
              bottom: 8,
              containLabel: true,
            },
            legend: {
              type: "scroll",
              top: 0,
              left: 0,
              right: 0,
              textStyle: { color: cores.tinta2 },
            },
            color: paleta,
            series: ss.map((s, k) => ({
              name: s.nome,
              type: "line",
              data: s.valores,
              connectNulls: false,
              symbolSize: 5,
              itemStyle: { color: paleta[k] },
              lineStyle: { color: paleta[k], width: 2 },
            })),
          };
        }}
      />
    );
  };
  const metadata: [string, string][] = [
    [t("Indicador", "Indicator"), nome(i)],
    [t("Unidade", "Unit"), textoComparacao(i, "unidade")],
    [t("Método", "Method"), textoComparacao(i, "normalizacao")],
    [
      t("Cobertura", "Coverage"),
      t(
        "Municípios incluídos na base / total do recorte; pode mudar entre períodos.",
        "Municipalities included in the calculation / total in scope; may change across periods.",
      ),
    ],
    [t("Regiões", "Regions"), g.observacao],
    [t("Preços", "Prices"), i.base_ipca ? `IPCA dezembro/${i.base_ipca}` : "—"],
    [t("Fonte", "Source"), i.fonte_nome],
    [t("Endereço", "Address"), location.href],
  ];
  const tabela: Tabela = {
    colunas: [
      "territorio",
      "periodo",
      "valor_comparavel",
      "unidade",
      "numerador",
      "denominador",
      "condicao",
      "municipios_na_base",
      "municipios_recorte",
      "valor_original",
      "unidade_original",
      "ano_populacao",
    ],
    linhas: linhasSerie.flatMap((l) =>
      janela.map((p) => {
        const k = pp.indexOf(p);
        return [
          l.nome,
          p,
          i.binario && l.municipio && l.s.v[k] !== null
            ? formatoComparacao(i, l.s.v[k], true)
            : l.s.v[k],
          i.binario && l.municipio
            ? t("resposta", "answer")
            : textoComparacao(i, "unidade"),
          l.s.n[k],
          l.s.d[k],
          condicaoComparacao(l.s.c[k]),
          l.s.c[k] === 22 ? null : l.s.q[k],
          l.s.c[k] === 22 ? null : l.total,
          i.binario && l.municipio && l.s.r?.[k] != null
            ? formatoComparacao(i, l.s.r[k], true)
            : l.s.r?.[k],
          i.binario && l.municipio
            ? t("resposta", "answer")
            : i.unidade_original,
          i.anos_base_demografica?.[String(p)],
        ];
      }),
    ),
    metadados: metadata,
  };
  return (
    <>
      <div className="cp-resumos">
        {pares.map((l) => (
          <article key={l.chave} className="cp-resumo">
            <h4>{l.nome}</h4>
            <strong>{formatoComparacao(i, l.b, l.municipio)}</strong>
            <p>
              {periodoComparacao(fim)} ·{" "}
              {i.binario && l.municipio
                ? t("resposta do governo", "government answer")
                : textoComparacao(i, "unidade")}
              {i.metodo_referencia === "mediana" && !l.municipio
                ? ` · ${t("mediana municipal", "municipal median")}`
                : ""}
            </p>
            {inicio !== fim && (
              <p>
                {l.delta.texto}
                {l.delta.relativa !== null
                  ? ` (${l.delta.relativa > 0 ? "+" : ""}${numero(l.delta.relativa)}%)`
                  : ""}
                {inicio !== fim
                  ? ` · ${t("desde", "since")} ${periodoComparacao(inicio)}`
                  : ""}
              </p>
            )}
            <p>
              {p2 >= 0
                ? i.binario && l.municipio && [0, 1].includes(l.s.c[p2])
                  ? t("Resposta registrada", "Recorded answer")
                  : condicaoComparacao(l.s.c[p2])
                : t("Fora da cobertura", "Outside coverage")}
              {!l.municipio && p2 >= 0 && l.s.c[p2] !== 22
                ? ` · ${numero(l.s.q[p2])}/${numero(l.total)} ${m.rede === "estadic" ? t("governos", "governments") : t("municípios", "municipalities")}`
                : ""}
            </p>
            {i.minimo &&
            p2 >= 0 &&
            l.s.d[p2] !== null &&
            l.s.d[p2]! < i.minimo ? (
              <p className="cp-aviso">
                {t(
                  "Base pequena: taxa instável.",
                  "Small denominator: unstable rate.",
                )}
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {janela.length > 1 &&
        (!i.binario || linhasSerie.some((l) => !l.municipio)) &&
        grafico()}
      {i.binario && (
        <p className="cp-nota">
          {t(
            "A resposta individual aparece nos cartões e na tabela. As linhas mostram somente os percentuais de respostas nas referências.",
            "Individual answers appear in the cards and table. Lines show only the shares of answers in reference areas.",
          )}
        </p>
      )}
      <details className="cp-detalhes">
        <summary>
          {t("Tabela da série e exportação", "Time-series table and export")}
        </summary>
        <Baixar tabela={tabela} nomeArquivo={`${m.area}_${i.id}_comparacao`} />
        <div className="cp-tabela">
          <table>
            <caption>
              {nome(i)} · {textoComparacao(i, "unidade")}
            </caption>
            <thead>
              <tr>
                <th>{t("Período", "Period")}</th>
                {linhasSerie.map((l) => (
                  <th key={l.chave}>
                    {l.nome}
                    {i.metodo_referencia === "mediana" && !l.municipio && (
                      <small>
                        {t("Mediana municipal", "Municipal median")}
                      </small>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {janela.map((p) => {
                const k = pp.indexOf(p);
                return (
                  <tr key={p}>
                    <th>{periodoComparacao(p)}</th>
                    {linhasSerie.map((l) => (
                      <td key={l.chave}>
                        {formatoComparacao(i, l.s.v[k], l.municipio)}
                        <small>
                          {condicaoComparacao(l.s.c[k])}
                          {!l.municipio && l.s.c[k] !== 22 ? ` · ${l.s.q[k]}/${l.total}` : ""}
                        </small>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Lista({
  m,
  g,
  i,
  grupo,
  estado,
  inicio,
  fim,
  ressalvas,
  sp,
  mudar,
}: {
  m: CatalogoComparacao;
  g: GeografiaComparacao;
  i: DefComparacao;
  grupo: string;
  estado: string;
  inicio: number;
  fim: number;
  ressalvas: boolean;
  sp: URLSearchParams;
  mudar: PropsConteudo["mudar"];
}) {
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(50);
  const nivelRaw = sp.get("nivel"),
    nivel: "M" | "UF" | "imediata" | "intermediaria" =
      nivelRaw === "UF" ||
      nivelRaw === "imediata" ||
      nivelRaw === "intermediaria"
        ? nivelRaw
        : "M";
  const coortePedido = sp.get("coorte"),
    coorte =
      nivel === "UF"
        ? "BR"
        : nivel !== "M"
          ? coortePedido && Object.hasOwn(UF_NOMES, coortePedido)
            ? coortePedido
            : estado
          : coortePedido &&
              g.territorios[coortePedido] &&
              g.territorios[coortePedido].nivel !== "M"
            ? coortePedido
            : grupo.startsWith("I:") || grupo.startsWith("T:")
              ? grupo
              : estado;
  const coortes =
    nivel === "UF"
      ? ["BR"]
      : nivel !== "M"
        ? [...(estado !== "BR" ? [estado] : []), "BR"]
        : [
            ...new Set(
              [grupo, ...referenciasComparacao(g, grupo)].filter(
                (k) => g.territorios[k]?.nivel !== "M",
              ),
            ),
          ];
  const uf = coorte === "BR" ? "BR" : (g.territorios[coorte].uf ?? coorte);
  const minimoRaw = Number(sp.get("minimo") ?? i.minimo ?? 0);
  const minimo =
    Number.isFinite(minimoRaw) && minimoRaw >= 0 ? minimoRaw : (i.minimo ?? 0);
  const ordem = sp.get("ordem") === "menor" ? "menor" : "maior";
  const disponivel = !!i.indice_lista && i.ranking && i.periodos.includes(fim);
  const lista = useSocial(
    disponivel
      ? `lista:${i.indice_lista!.sha256}:${inicio}:${fim}:${uf}:${nivel}:${ressalvas}`
      : null,
    async () => {
      const obter = (p: number) =>
        nivel === "M"
          ? obterListaComparacao(m, i, p, uf)
          : obterListaReferencias(m, i, p, nivel, ressalvas);
      const [b, a] = await Promise.all([
        obter(fim),
        i.periodos.includes(inicio) && inicio <= fim
          ? obter(inicio)
          : Promise.resolve([]),
      ]);
      return { a, b };
    },
  );
  const doRecorte = (x: LinhaComparacao) =>
    coorte === "BR" ||
    x.uf === coorte ||
    x.imediata === coorte ||
    x.intermediaria === coorte;
  const atual = lista.dados
    ? ranquearComparacao(
        lista.dados.b.filter(doRecorte),
        ordem,
        ressalvas,
        minimo,
      )
    : null;
  const antiga = lista.dados
    ? ranquearComparacao(
        lista.dados.a.filter(doRecorte),
        ordem,
        ressalvas,
        minimo,
      )
    : null;
  const mapaAntes = new Map(
    inicio < fim ? antiga?.com.map((x) => [x.cod, x]) : [],
  );
  const filtro = normComparacao(busca),
    filtradas =
      atual?.com.filter(
        (x) =>
          normComparacao(x.nome).includes(filtro) ||
          String(x.cod).includes(filtro),
      ) ?? [];
  const tabela: Tabela = {
    colunas: [
      "posicao",
      "cod_ibge",
      "territorio",
      "uf",
      "periodo",
      "valor",
      "unidade",
      "periodo_anterior",
      "valor_anterior",
      "posicao_anterior",
      "diferenca",
      "condicao",
      "numerador",
      "denominador",
      "valor_original",
    ],
    linhas: [...(atual?.com ?? []), ...(atual?.sem ?? [])].map((x) => {
      const a = mapaAntes.get(x.cod);
      return [
        "posicao" in x ? (x.posicao as number) : null,
        x.cod,
        x.nome,
        x.uf,
        fim,
        efetivoComparacao(x.v, x.c, ressalvas),
        textoComparacao(i, "unidade"),
        inicio < fim ? inicio : null,
        a?.v ?? null,
        a?.posicao ?? null,
        variacaoComparacao(
          i,
          a?.v ?? null,
          x.v,
          false,
          periodosComparaveis(i, inicio, fim, a?.c, x.c),
        ).diferenca,
        condicaoComparacao(x.c),
        x.n,
        x.d,
        x.r,
      ];
    }),
    metadados: [
      [t("Indicador", "Indicator"), nome(i)],
      [t("Recorte", "Scope"), nomeTerritorioComparacao(g, coorte)],
      [t("Ordenação", "Order"), ordem],
      [t("Base mínima", "Minimum denominator"), String(minimo)],
      [t("Método", "Method"), textoComparacao(i, "normalizacao")],
      [
        t("Aviso", "Note"),
        t(
          "Posição não é avaliação de qualidade; universo e cobertura podem mudar entre períodos. Exportação inclui todos, inclusive sem valor.",
          "Rank is not a quality assessment; universe and coverage may change across periods. Export includes all records, including missing values.",
        ),
      ],
      [t("Endereço", "Address"), location.href],
    ],
  };
  return (
    <section className="cartao">
      <h3>
        {t(
          "Rankings relativos e mudança no tempo",
          "Relative rankings and change over time",
        )}
      </h3>
      <p className="cp-nota">
        {t(
          "A posição ordena este indicador; não diz se um município está melhor ou pior. Não se ordenam totais absolutos. Empates recebem a mesma posição. Ausências e bases abaixo do mínimo ficam fora da ordem e continuam no download.",
          "Ranks order this indicator; they do not say whether a municipality is better or worse. Absolute totals are not ranked. Ties share a rank. Missing values and denominators below the minimum are outside the ranking and remain in the download.",
        )}
      </p>
      {!i.indice_lista || !i.ranking ? (
        <p className="cp-aviso">
          {t(
            "Este indicador descreve respostas ou outro universo, sem ranking municipal. Use a comparação e a série acima.",
            "This indicator describes answers or a different universe, without a municipal ranking. Use the comparison and time series above.",
          )}
        </p>
      ) : (
        <>
          <div className="cp-filtros">
            <div>
              <label htmlFor="cp-nivel">{t("Comparar", "Compare")}</label>
              <select
                id="cp-nivel"
                value={nivel}
                onChange={(e) => mudar({ nivel: e.target.value, coorte: null })}
              >
                <option value="M">{t("Municípios", "Municipalities")}</option>
                <option value="UF">
                  {t("Estados e DF", "States and Federal District")}
                </option>
                <option value="imediata">
                  {t("Regiões imediatas", "Immediate regions")}
                </option>
                <option value="intermediaria">
                  {t("Regiões intermediárias", "Intermediate regions")}
                </option>
              </select>
            </div>
            <div>
              <label htmlFor="cp-coorte">{t("Dentro de", "Within")}</label>
              <select
                id="cp-coorte"
                value={coorte}
                onChange={(e) => mudar({ coorte: e.target.value })}
              >
                {!coortes.includes(coorte) && (
                  <option value={coorte}>
                    {nomeTerritorioComparacao(g, coorte)}
                  </option>
                )}
                {coortes.map((k) => (
                  <option key={k} value={k}>
                    {nomeTerritorioComparacao(g, k)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cp-ordem">{t("Ordem", "Order")}</label>
              <select
                id="cp-ordem"
                value={ordem}
                onChange={(e) => mudar({ ordem: e.target.value })}
              >
                <option value="maior">
                  {t("Maior para menor", "Highest to lowest")}
                </option>
                <option value="menor">
                  {t("Menor para maior", "Lowest to highest")}
                </option>
              </select>
            </div>
            {i.metodo_referencia === "razao" && (
              <div>
                <label htmlFor="cp-minimo">
                  {t("Denominador mínimo", "Minimum denominator")}
                </label>
                <input
                  id="cp-minimo"
                  type="number"
                  min="0"
                  value={minimo}
                  onChange={(e) =>
                    mudar({
                      minimo: String(Math.max(0, Number(e.target.value))),
                    })
                  }
                />
              </div>
            )}
          </div>
          {lista.carregando && <Estado carregando />}
          {lista.erro && (
            <Estado erro={lista.erro} tentarNovamente={lista.recarregar} />
          )}
          {atual && (
            <>
              <p role="status" className="cp-nota">
                {atual.com.length}{" "}
                {t("com valor na ordem", "with ranked values")} ·{" "}
                {atual.sem.length} {t("fora da ordem", "outside ranking")} ·{" "}
                {nomeTerritorioComparacao(g, coorte)} · {periodoComparacao(fim)}
                {inicio !== fim ? ` / ${periodoComparacao(inicio)}` : ""}.{" "}
                {t(
                  "As posições de cada período usam os registros válidos daquele período; consulte a cobertura antes de interpretar movimentos.",
                  "Each period’s positions use that period’s valid records; check coverage before interpreting rank movements.",
                )}
              </p>
              <div className="cp-controles">
                <div className="cp-campo">
                  <label htmlFor="cp-encontrar">
                    {t("Encontrar na lista", "Find in list")}
                  </label>
                  <input
                    type="search"
                    id="cp-encontrar"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder={t("Nome ou código IBGE", "Name or IBGE code")}
                  />
                </div>
                <div className="cp-campo">
                  <label htmlFor="cp-limite">{t("Mostrar", "Show")}</label>
                  <select
                    id="cp-limite"
                    value={limite}
                    onChange={(e) => setLimite(Number(e.target.value))}
                  >
                    <option value="50">50</option>
                    <option value="200">200</option>
                    <option value="6000">{t("Todos", "All")}</option>
                  </select>
                </div>
                <Baixar
                  tabela={tabela}
                  nomeArquivo={`${m.area}_${i.id}_ranking_relativo`}
                />
              </div>
              <div className="cp-tabela">
                <table>
                  <caption>
                    {nome(i)} · {textoComparacao(i, "unidade")}
                  </caption>
                  <thead>
                    <tr>
                      <th>{t("Posição", "Rank")}</th>
                      <th>{t("Território", "Territory")}</th>
                      <th>{periodoComparacao(fim)}</th>
                      {inicio !== fim && (
                        <>
                          <th>{periodoComparacao(inicio)}</th>
                          <th>{t("Diferença", "Difference")}</th>
                          <th>{t("Posição anterior", "Earlier rank")}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.slice(0, limite).map((x) => {
                      const a = mapaAntes.get(x.cod),
                        delta = variacaoComparacao(
                          i,
                          a?.v ?? null,
                          x.v,
                          false,
                          periodosComparaveis(i, inicio, fim, a?.c, x.c),
                        );
                      return (
                        <tr
                          key={x.cod}
                          aria-current={
                            String(x.cod) === grupo ? "true" : undefined
                          }
                        >
                          <td>{x.posicao}º</td>
                          <th>
                            <Link
                              to={{
                                pathname: `${RAIZES_COMPARACAO[m.area]}/comparar`,
                                search:
                                  "?" +
                                  new URLSearchParams({
                                    ...Object.fromEntries(sp),
                                    cod: x.nivel ? "" : String(x.cod),
                                    uf: x.uf,
                                    recorte: x.grupo ?? "",
                                    comparar: "",
                                    vista: "evolucao",
                                  }).toString(),
                              }}
                            >
                              {x.nivel === "UF"
                                ? (UF_NOMES[x.uf]?.[0] ?? x.nome)
                                : x.nome}{" "}
                              ({x.uf})
                            </Link>
                            <small>
                              {condicaoComparacao(x.c)}
                              {x.q !== undefined
                                ? ` · ${x.q}/${x.total} ${m.rede === "estadic" ? t("governos", "governments") : t("municípios", "municipalities")}`
                                : ""}
                              {x.d !== null
                                ? ` · ${t("base", "denominator")}: ${numero(x.d)}`
                                : ""}
                            </small>
                          </th>
                          <td>{formatoComparacao(i, x.v)}</td>
                          {inicio !== fim && (
                            <>
                              <td>{formatoComparacao(i, a?.v ?? null)}</td>
                              <td>{delta.texto}</td>
                              <td>{a?.posicao ?? "—"}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtradas.length === 0 && (
                <p>
                  {t(
                    "Nenhum município corresponde à busca.",
                    "No municipality matches the search.",
                  )}
                </p>
              )}
              <details className="cp-detalhes">
                <summary>
                  {t(
                    "Fora da ordem — ausência, ressalva ou base pequena",
                    "Outside ranking — missing data, flag or small denominator",
                  )}{" "}
                  ({atual.sem.length})
                </summary>
                <div className="cp-tabela">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Território", "Territory")}</th>
                        <th>{t("Condição", "Status")}</th>
                        <th>{t("Valor original", "Original value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atual.sem
                        .filter(
                          (x) =>
                            normComparacao(x.nome).includes(filtro) ||
                            String(x.cod).includes(filtro),
                        )
                        .slice(0, limite)
                        .map((x) => (
                          <tr key={x.cod}>
                            <th>
                              {x.nome} ({x.uf})
                            </th>
                            <td>
                              {condicaoComparacao(x.c)}
                              {x.d !== null && x.d < minimo
                                ? " · " +
                                  t(
                                    "base abaixo do mínimo",
                                    "denominator below minimum",
                                  )
                                : minimo > 0 && x.d === null && x.v !== null
                                  ? " · " +
                                    t(
                                      "base não publicada; mínimo não verificável",
                                      "denominator not published; minimum cannot be checked",
                                    )
                                  : ""}
                            </td>
                            <td>{x.r === null ? "—" : numero(x.r)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
