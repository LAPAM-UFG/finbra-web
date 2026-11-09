import { t } from '../idioma';
import { BotoesExportar, useMetadados } from './Exportar';

/** Período de uma primeira coluna de anos. Aceita anos marcados com nota ("2023 †", como as séries da RAIS); outros rótulos (grupos, competências) dão undefined. */
export const periodoDe = (anos: (number | string)[]) => {
  const n = anos.map((a) => (typeof a === 'number' ? a : /^(\d{4})(\s*†)?$/.exec(String(a).trim())?.[1] ?? NaN)).map(Number).filter((a) => Number.isFinite(a));
  return n.length === anos.length && n.length ? (n.length === 1 ? String(n[0]) : `${Math.min(...n)}–${Math.max(...n)}`) : undefined;
};

export type ColunaSerie = { titulo: string; valores: (number | string | null)[]; formato?: (v: number | null) => string };

/**
 * Tabela de série histórica: exibe os valores formatados e exporta os valores brutos (precisão
 * completa). `anos` é a primeira coluna.
 */
export function TabelaSerie({ nome, anos, colunas, metadados = [], primeiraColuna, conteudo, periodo, metadadosProprios, semAnoSelecionado, valoresReais }: {
  nome: string; anos: (number | string)[]; colunas: ColunaSerie[]; metadados?: [string, string][];
  /** rótulo da primeira coluna quando ela não é o ano (ex.: "Grupo SIGTAP"); então não há período a informar */
  primeiraColuna?: string;
  /** descrição do que o arquivo traz; o padrão é a série completa exibida no gráfico */
  conteudo?: string;
  /** período que o arquivo traz, quando a primeira coluna não é o ano (ex.: competências mensais, "01/2020–09/2026") */
  periodo?: string;
  /** os metadados informados já dizem fonte, recorte e unidade: não acrescenta o texto padrão de finanças */
  metadadosProprios?: boolean;
  /** a tabela já informa o ano que traz (ex.: grupos de um ano): o ano da navegação não entra nos metadados, mesmo sem um período de anos */
  semAnoSelecionado?: boolean;
  /** saúde: a tabela tem valores monetários corrigidos pelo IPCA (true) ou misturados com R$ correntes ('parcial'); sem isso, os metadados não citam preços */
  valoresReais?: boolean | 'parcial';
}) {
  const meta = useMetadados();
  const visiveis = colunas.filter((c) => c.titulo);
  const periodoEfetivo = periodo ?? (primeiraColuna ? undefined : periodoDe(anos));
  return (
    <>
      <div className="rolagem">
        <table>
          <thead><tr><th>{primeiraColuna ?? t('Ano', 'Year')}</th>{visiveis.map((c) => <th key={c.titulo}>{c.titulo}</th>)}</tr></thead>
          <tbody>
            {anos.map((ano, i) => (
              <tr key={String(ano)}>
                <td>{ano}</td>
                {visiveis.map((c) => {
                  const v = c.valores[i];
                  return <td key={c.titulo}>{typeof v === 'string' ? v : c.formato ? c.formato(v ?? null) : v ?? 'n.d.'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BotoesExportar
        nome={nome}
        obter={() => ({
          colunas: [primeiraColuna ?? t('Ano', 'Year'), ...visiveis.map((c) => c.titulo)],
          linhas: anos.map((ano, i) => [ano, ...visiveis.map((c) => c.valores[i] ?? null)]),
          // os metadados vêm dos dados exportados: numa série, o período do arquivo; fora dela, o ano que a tabela já informa
          metadados: meta(
            [[t('Conteúdo', 'Content'), conteudo ?? t('série completa exibida no gráfico', 'full series shown in the chart')], ...metadados],
            {
              // série de anos: o período real do arquivo; tabela por categoria (sem período): o ano da navegação continua valendo, salvo se a tabela já o informa
              anoSelecionado: semAnoSelecionado || periodoEfetivo !== undefined ? false : undefined,
              periodo: periodoEfetivo, proprios: metadadosProprios, precosReais: valoresReais,
            },
          ),
        })}
      />
    </>
  );
}
