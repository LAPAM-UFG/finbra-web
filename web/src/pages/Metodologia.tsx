import { useApi } from '../api';
import { Estado } from '../components/Kpi';
import { useDados, type Alerta } from '../contexto';
import { numero, pct, reais } from '../format';

type Ipca = { ano: number; ipca_pct: number; completo: boolean; fator: number };
type Validacao = { teste: string; exercicio: number; anexo: string; casos: number; ok: number; pct_ok: number };

export function Deflatores() {
  const { meta } = useDados();
  const r = useApi<Ipca[]>('ipca');
  return (
    <>
      <h2 className="titulo-pagina">Deflatores</h2>
      <p className="subtitulo">
        Valores reais em R$ de {meta.baseIpca}: valor nominal × fator. IPCA de dezembro a dezembro (Banco Central, série SGS 433).
      </p>
      <section className="cartao">
        <Estado carregando={r.carregando} erro={r.erro} />
        <table>
          <thead><tr><th>Exercício</th><th>IPCA no ano</th><th>Fator para R$ de {meta.baseIpca}</th></tr></thead>
          <tbody>
            {(r.dados ?? []).map((l) => (
              <tr key={l.ano}>
                <td>{l.ano}{!l.completo && ' (parcial)'}</td>
                <td>{pct(l.ipca_pct / 100, 2)}</td>
                <td>{l.fator.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function Qualidade() {
  const r = useApi<Validacao[]>('validacao');
  const alertas = useApi<Alerta[]>('alertas');
  return (
    <>
      <h2 className="titulo-pagina">Qualidade dos dados e fontes</h2>
      <p className="subtitulo">Testes que o pipeline roda a cada atualização.</p>
      <section className="cartao">
        <h3>Fontes</h3>
        <ul>
          <li><strong>SICONFI / Tesouro Nacional</strong> — Declaração de Contas Anuais (DCA), anexos I-AB a I-HI, pela API pública
            <code> apidatalake.tesouro.gov.br/ords/siconfi/tt/dca</code>.</li>
          <li><strong>IBGE</strong> — PIB dos Municípios (tabela SIDRA 5938).</li>
          <li><strong>Banco Central</strong> — IPCA mensal (SGS 433).</li>
          <li><strong>Painel da pesquisa LAPAM</strong> — área, distância, Bolsa Família, benefícios do INSS (2013–2021, fixo).</li>
        </ul>
        <h3 style={{ marginTop: 14 }}>Como os valores são montados</h3>
        <ul>
          <li>Cada linha mostra o valor que o ente declarou naquela conta. Nada é obtido somando as contas do último nível,
            o que preserva contas redutoras e evita perder valores quando o ente detalha só parte de uma conta.</li>
          <li>A hierarquia segue os segmentos do código (o 5º segmento tem dois dígitos). Se um ente informa uma subconta mas
            não a conta-mãe, a mãe é criada com a soma das subcontas e marcada como “(soma)”.</li>
          <li>FPM, ICMS, IPVA, IPTU, ISS e ITBI mudaram de código em 2018 e 2022; são identificados pela descrição da conta.</li>
        </ul>
      </section>
      <section className="cartao">
        <h3>Testes automáticos</h3>
        <p className="desc">
          “Árvore × total”: as contas de primeiro nível somam o total que o próprio ente declarou. “Ativo = passivo + PL”:
          fechamento do balanço. As comparações com o painel de pesquisa são informativas: o painel soma receita bruta e deduções.
        </p>
        <Estado carregando={r.carregando} erro={r.erro} vazio={!r.carregando && !r.dados?.length} />
        <div className="rolagem">
          <table>
            <thead><tr><th>Teste</th><th>Exercício</th><th>Anexo</th><th>Casos</th><th>Conferem</th></tr></thead>
            <tbody>
              {(r.dados ?? []).map((l) => (
                <tr key={`${l.teste}-${l.exercicio}-${l.anexo}`}>
                  <td>{l.teste}</td><td>{l.exercicio}</td><td>{l.anexo}</td><td>{numero(l.casos)}</td>
                  <td className={l.ok === l.casos ? 'ok' : 'falha'}>{l.ok === l.casos ? '✓ ' : '✗ '}{pct(l.pct_ok / 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <h3>Declarações atípicas</h3>
        <p className="desc">
          Ente-anos cuja receita bruta ou despesa empenhada não foi declarada ou está mais de 5 vezes acima ou abaixo da
          mediana do próprio ente nos 13 anos (ex.: erro de digitação na declaração ao SICONFI). Ficam fora dos totais de UF,
          Brasil e rankings; ao escolher o ente, os valores aparecem como declarados, com aviso.
        </p>
        <div className="rolagem">
          <table>
            <thead><tr><th>Ente</th><th>UF</th><th>Exercício</th><th>Indicador</th><th>Declarado</th><th>Mediana do ente</th><th>Situação</th></tr></thead>
            <tbody>
              {(alertas.dados ?? []).map((a) => (
                <tr key={`${a.exercicio}-${a.cod_ibge}-${a.indicador}`}>
                  <td>{a.nome}</td><td>{a.uf}</td><td>{a.exercicio}</td>
                  <td>{a.indicador === 'receita_bruta' ? 'Receita bruta' : 'Despesa empenhada'}</td>
                  <td>{reais(a.valor)}</td><td>{reais(a.mediana)}</td><td>{a.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
