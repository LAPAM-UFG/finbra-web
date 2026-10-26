import { t } from '../idioma';
import { BotoesExportar, useMetadados } from './Exportar';

export type ColunaSerie = { titulo: string; valores: (number | string | null)[]; formato?: (v: number | null) => string };

/**
 * Tabela de série histórica: exibe os valores formatados e exporta os valores brutos (precisão
 * completa). `anos` é a primeira coluna.
 */
export function TabelaSerie({ nome, anos, colunas, metadados = [] }: {
  nome: string; anos: (number | string)[]; colunas: ColunaSerie[]; metadados?: [string, string][];
}) {
  const meta = useMetadados();
  const visiveis = colunas.filter((c) => c.titulo);
  return (
    <>
      <div className="rolagem">
        <table>
          <thead><tr><th>{t('Ano', 'Year')}</th>{visiveis.map((c) => <th key={c.titulo}>{c.titulo}</th>)}</tr></thead>
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
          colunas: [t('Ano', 'Year'), ...visiveis.map((c) => c.titulo)],
          linhas: anos.map((ano, i) => [ano, ...visiveis.map((c) => c.valores[i] ?? null)]),
          metadados: meta([[t('Conteúdo', 'Content'), t('série completa exibida no gráfico', 'full series shown in the chart')], ...metadados]),
        })}
      />
    </>
  );
}
