import type { IndicadorSocial } from './assistencia_dados';

/** Conceitos estáveis; valores e limites de renda continuam no catálogo da fonte. */
export function conceitoSocial(i: IndicadorSocial, ingles = false): string {
  const texto = `${i.nome} ${i.id}`.toLowerCase();
  if (/^famílias|^families/.test(i.nome.toLowerCase()) || /familias|qtd_fam/.test(i.id)) return ingles
    ? 'In CadÚnico, a family is one or more people living in the same home who share income or household expenses. A person living alone is also a family. Registration does not mean receiving a benefit. In Bolsa Família, this indicator counts families on the MDS payroll for the stated month.'
    : 'No CadÚnico, família é uma ou mais pessoas que moram na mesma casa e compartilham renda ou despesas. Quem mora sozinho também pode formar uma família. Estar cadastrado não significa receber benefício. No Bolsa Família, o indicador conta as famílias da folha do MDS no mês informado.';
  if (i.id === 'bpc_beneficios') return ingles
    ? 'BPC is an individual assistance benefit for eligible older people and people with disabilities. This number counts distinct benefit numbers with a payment in the month; it is not a count of families or of all active benefits.'
    : 'O BPC é um benefício assistencial individual para idosos e pessoas com deficiência que atendem aos critérios. Aqui são contados números de benefício distintos com pagamento no mês; não são famílias nem todos os benefícios ativos.';
  if (i.id === 'pbf_cgu_responsaveis') return ingles
    ? 'The family representative is the person identified in the payment record. This is different from the number of family members. Municipal counts cannot be added to obtain unique people in a state or Brazil.'
    : 'Responsável é a pessoa identificada no registro do pagamento. Essa contagem difere do número de integrantes da família. Somar municípios não produz pessoas únicas no estado ou no Brasil.';
  if (i.unidade === 'moeda') return ingles
    ? (i.id.startsWith('pbf_') && !i.id.startsWith('pbf_cgu_')
      ? 'This amount comes from the MDS payroll and its benefit components. It is a different series from actual payments in the CGU Transparency Portal.'
      : 'Money actually paid during the stated month, including any retroactive instalments already in the total. It is not the number of people or families. IPCA-adjusted amounts are explicitly labelled.')
    : (i.id.startsWith('pbf_') && !i.id.startsWith('pbf_cgu_')
      ? 'Este valor vem da folha do MDS e dos componentes do benefício. É uma série diferente dos pagamentos efetivos do Portal da Transparência/CGU.'
      : 'Dinheiro efetivamente pago no mês informado, incluindo eventuais parcelas retroativas já presentes no total. Não é número de pessoas ou famílias. Valores corrigidos pelo IPCA têm indicação própria.');
  if (/parcelas|pagamentos/.test(texto)) return ingles
    ? 'An instalment is a payment record. The same benefit can have more than one instalment in the month, including payments for earlier months. Do not read instalments as unique beneficiaries.'
    : 'Parcela é um registro de pagamento. O mesmo benefício pode ter mais de uma parcela no mês, inclusive de referências anteriores. Parcelas não equivalem a beneficiários únicos.';
  if (/pessoas|people/.test(texto)) return ingles
    ? 'People are the individual members recorded in CadÚnico, including children and adults. This is not the number of families or proof that everyone receives a benefit. Different profiles can overlap.'
    : 'Pessoas são os integrantes registrados no CadÚnico, incluindo crianças e adultos. Não é quantidade de famílias nem comprovação de que todos recebem benefício. Os diferentes perfis podem se sobrepor.';
  return ingles
    ? 'Read this indicator using its stated unit and reference month. A blank or protected value is not zero. The definition below describes the source and calculation.'
    : 'Leia o indicador junto com a unidade e o mês de referência. Valor ausente ou protegido não significa zero. A definição abaixo informa a fonte e a forma de cálculo.';
}
