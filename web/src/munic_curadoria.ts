/**
 * Curadoria do painel automático de gestão pública (MUNIC e ESTADIC, IBGE): cada indicador aponta para pares exatos
 * pesquisa/edição/variável do catálogo, com o enunciado, a aba e o tema EXATOS do dicionário do IBGE (conferidos contra
 * gold/munic/catalogo.parquet e as respostas reais em testes/munic_painel.test.ts). Nenhum vínculo é inferido pelo código
 * da variável nem por texto parecido. Binários: só as respostas listadas em sim/nao entram na base (as demais válidas,
 * se houver, ficam à parte). Numéricos: soma e média das respostas numéricas válidas, com a cobertura.
 * Gerado a partir do catálogo real; títulos em linguagem comum são da curadoria.
 */
import type { IndicadorMunic } from './munic_painel';

export const CURADORIA: IndicadorMunic[] = [
 {
  "id": "m_rh_existe_indireta",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem administração indireta",
   "en": "Has indirect administration"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH02",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   },
   {
    "ano": 2023,
    "var": "MREH02",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   },
   {
    "ano": 2021,
    "var": "Mreh02",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_rh_concurso",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Fez concurso nos últimos 24 meses",
   "en": "Held a civil-service exam in the last 24 months"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH05",
    "aba": "Recursos humanos",
    "tema": "Identificação dos servidores por cor/raça e realização de concurso",
    "rotulo": "Houve nos últimos 24 meses concurso realizado pela administração direta para contratação de pessoal"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_rh_corraca",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Registra a cor/raça dos servidores da administração direta",
   "en": "Records the race/colour of direct-administration civil servants"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH04",
    "aba": "Recursos humanos",
    "tema": "Identificação dos servidores por cor/raça e realização de concurso",
    "rotulo": "Existe no quadro da administração direta, registro para identificar os servidores por cor/raça"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_rh_direta_16",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Total de servidores (administração direta)",
   "en": "Total staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH016",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total"
   },
   {
    "ano": 2023,
    "var": "MREH0116",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total"
   },
   {
    "ano": 2021,
    "var": "Mreh0116",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total¹"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_direta_11",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estatutários (administração direta)",
   "en": "Statutory staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH011",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   },
   {
    "ano": 2023,
    "var": "MREH0111",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   },
   {
    "ano": 2021,
    "var": "Mreh0111",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_direta_12",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Celetistas (administração direta)",
   "en": "CLT staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH012",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   },
   {
    "ano": 2023,
    "var": "MREH0112",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   },
   {
    "ano": 2021,
    "var": "Mreh0112",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_direta_13",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Somente comissionados (administração direta)",
   "en": "Appointed-only staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH013",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   },
   {
    "ano": 2023,
    "var": "MREH0113",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   },
   {
    "ano": 2021,
    "var": "Mreh0113",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_direta_14",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estagiários (administração direta)",
   "en": "Interns (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH014",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   },
   {
    "ano": 2023,
    "var": "MREH0114",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   },
   {
    "ano": 2021,
    "var": "Mreh0114",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_direta_15",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Sem vínculo permanente (administração direta)",
   "en": "No permanent tie (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH015",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   },
   {
    "ano": 2023,
    "var": "MREH0115",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   },
   {
    "ano": 2021,
    "var": "Mreh0115",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta (a própria prefeitura). A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration (the city hall itself). The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "m_rh_indireta_36",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Total de servidores (administração indireta)",
   "en": "Total staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH036",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Total"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_rh_indireta_31",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estatutários (administração indireta)",
   "en": "Statutory staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH031",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Estatutários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_rh_indireta_32",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Celetistas (administração indireta)",
   "en": "CLT staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH032",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Celetistas"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_rh_indireta_33",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Somente comissionados (administração indireta)",
   "en": "Appointed-only staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH033",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Somente comissionados"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_rh_indireta_34",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estagiários (administração indireta)",
   "en": "Interns (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH034",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Estagiários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_rh_indireta_35",
  "bloco": "pessoal",
  "pesquisa": "munic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Sem vínculo permanente (administração indireta)",
   "en": "No permanent tie (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MREH035",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Sem vínculo permanente"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "m_tr_lai",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei própria de acesso à informação",
   "en": "Has its own access-to-information law"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mgov01",
    "aba": "Governanca",
    "tema": "Acesso à informação",
    "rotulo": "Legislação municipal específica que estabeleça procedimentos e providências para garantir o direito de acesso à informação pública em conformidade com a Lei de Acesso à Informação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_controle",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem estrutura de controle interno",
   "en": "Has an internal-control structure"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mgov09",
    "aba": "Governanca",
    "tema": "Controle Interno",
    "rotulo": "Estrutura organizacional para a área responsável pelo controle interno - existência"
   }
  ],
  "sim": [
   "Sim, instituída por instrumento legal",
   "Sim, sem instrumento legal"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_conselho",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de transparência",
   "en": "Has a transparency council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mgov26",
    "aba": "Governanca",
    "tema": "Conselho de transparência",
    "rotulo": "Conselho Municipal de Transparência ou similar - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_lgpd_area",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem área ou responsável pela proteção de dados pessoais",
   "en": "Has a unit or person in charge of personal data protection"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mgov32",
    "aba": "Governanca",
    "tema": "Lei Geral de Proteção de Dados Pessoais (LGPD)",
    "rotulo": "Área ou pessoa responsável por procedimentos e políticas para a coleta, armazenamento e uso de dados pessoais ou pela implementação das diretrizes da LGPD - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_lgpd_lei",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem norma específica sobre a LGPD",
   "en": "Has a specific rule on the LGPD (data protection law)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mgov36",
    "aba": "Governanca",
    "tema": "Lei Geral de Proteção de Dados Pessoais (LGPD)",
    "rotulo": "Regulamentação ou lei municipal específica sobre a LGPD, que identifica os papéis e responsabilidades de áreas ou setores - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_tic",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem área de tecnologia da informação",
   "en": "Has an information technology unit"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtic06",
    "aba": "Informática e comunicação",
    "tema": "Estrutura em TI",
    "rotulo": "Estrutura organizacional para a área de Tecnologia da Informação e Comunicação (TIC) - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_site",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Atende pelo site",
   "en": "Offers service through a website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtic013",
    "aba": "Informática e comunicação",
    "tema": "Formas de atendimento à distância e tipo de conexão com a internet",
    "rotulo": "Disponibiliza formas de atendimento a distância: › Websites"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_whatsapp",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Atende por WhatsApp",
   "en": "Offers service through WhatsApp"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtic014",
    "aba": "Informática e comunicação",
    "tema": "Formas de atendimento à distância e tipo de conexão com a internet",
    "rotulo": "Disponibiliza formas de atendimento a distância: › WhatsApp"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_diario",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Publica o diário oficial no site",
   "en": "Publishes the official gazette on its website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtic12a4",
    "aba": "Informática e comunicação",
    "tema": "Características da página na internet e redes sociais",
    "rotulo": "Serviços informativos disponibilizados na página da internet › Diário oficial"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_tr_nfe",
  "bloco": "transparencia",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Emite nota fiscal eletrônica pelo site",
   "en": "Issues electronic invoices on its website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtic12b8",
    "aba": "Informática e comunicação",
    "tema": "Características da página na internet e redes sociais",
    "rotulo": "Serviços disponibilizados na página da internet › Emissão de Nota Fiscal Eletrônica"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_plano_diretor",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano diretor",
   "en": "Has a master plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mleg01",
    "aba": "Legislação e instr de planej",
    "tema": "LEGISLAÇÃO E INSTRUMENTO DE PLANEJAMENTO2",
    "rotulo": "Plano diretor - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_parcelamento",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem legislação de parcelamento do solo",
   "en": "Has land-subdivision legislation"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mleg05",
    "aba": "Legislação e instr de planej",
    "tema": "LEGISLAÇÃO E INSTRUMENTO DE PLANEJAMENTO2",
    "rotulo": "Demais instrumentos: › Legislação sobre parcelamento do solo - existência"
   }
  ],
  "sim": [
   "Sim, com legislação específica",
   "Sim, como parte integrante do Plano Diretor"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_zoneamento",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem legislação de zoneamento ou uso do solo",
   "en": "Has zoning or land-use legislation"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mleg06",
    "aba": "Legislação e instr de planej",
    "tema": "LEGISLAÇÃO E INSTRUMENTO DE PLANEJAMENTO2",
    "rotulo": "Demais instrumentos: › Legislação sobre zoneamento ou uso e ocupação do solo - existência"
   }
  ],
  "sim": [
   "Sim, com legislação específica",
   "Sim, como parte integrante do Plano Diretor"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_obras",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem código de obras",
   "en": "Has a building code"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mleg11",
    "aba": "Legislação e instr de planej",
    "tema": "LEGISLAÇÃO E INSTRUMENTO DE PLANEJAMENTO2",
    "rotulo": "Demais instrumentos: › Código de obras - existência"
   }
  ],
  "sim": [
   "Sim, com legislação específica",
   "Sim, como parte integrante do Plano Diretor"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_fundiaria",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem legislação de regularização fundiária",
   "en": "Has land-title regularization legislation"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mleg19",
    "aba": "Legislação e instr de planej",
    "tema": "LEGISLAÇÃO E INSTRUMENTO DE PLANEJAMENTO2",
    "rotulo": "Demais instrumentos: › Legislação sobre regularização fundiária"
   }
  ],
  "sim": [
   "Sim, com legislação específica",
   "Sim, como parte integrante do Plano Diretor"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_plano_educ",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano municipal de educação",
   "en": "Has a municipal education plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu14",
    "aba": "Educação",
    "tema": "Plano municipal de educação e Fórum Permanente de Educação",
    "rotulo": "Plano Municipal de Educação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_plano_saude",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano municipal de saúde",
   "en": "Has a municipal health plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau20",
    "aba": "Saúde",
    "tema": "Colegiado de Gestão Regional, Plano Municipal de Saúde e Política Nacional de Saúde Integral da População Negra",
    "rotulo": "Plano Municipal de Saúde - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_pl_cons_educ",
  "bloco": "planejamento",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de educação",
   "en": "Has an education council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu22",
    "aba": "Educação",
    "tema": "Conselhos municipais da área de educação",
    "rotulo": "Conselho de Educação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_plano",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano municipal de habitação",
   "en": "Has a municipal housing plan"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab07",
    "aba": "Habitacao",
    "tema": "Plano e conferência municipal de habitação",
    "rotulo": "Plano Municipal de Habitação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_conselho",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de habitação",
   "en": "Has a municipal housing council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab10",
    "aba": "Habitacao",
    "tema": "Conselho e Fundo municipal de habitação",
    "rotulo": "Conselho Municipal de Habitação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_cadastro",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem cadastro de famílias interessadas em programas habitacionais",
   "en": "Has a register of families interested in housing programmes"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab18",
    "aba": "Habitacao",
    "tema": "Cadastro de famílias interessadas em programas habitacionais",
    "rotulo": "Cadastro ou levantamento de famílias interessadas em programas habitacionais - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_construcao",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Fez construção de unidades habitacionais em 2022 ou 2023",
   "en": "Built housing units in 2022 or 2023"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab201",
    "aba": "Habitacao",
    "tema": "Programas ou ações na área de habitação",
    "rotulo": "Foram realizados pela prefeitura, no ano de 2022 e/ou 2023, programas ou ações de: › Construção de unidades habitacionais"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_urbanizacao",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Fez urbanização de assentamentos em 2022 ou 2023",
   "en": "Carried out settlement upgrading in 2022 or 2023"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab207",
    "aba": "Habitacao",
    "tema": "Programas ou ações na área de habitação",
    "rotulo": "Foram realizados pela prefeitura, no ano de 2022 e/ou 2023, programas ou ações de: › Urbanização de assentamentos"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_fundiaria",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Fez regularização fundiária em 2022 ou 2023",
   "en": "Carried out land-title regularization in 2022 or 2023"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mhab206",
    "aba": "Habitacao",
    "tema": "Programas ou ações na área de habitação",
    "rotulo": "Foram realizados pela prefeitura, no ano de 2022 e/ou 2023, programas ou ações de: › Regularização fundiária"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_cons_transp",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de transporte",
   "en": "Has a municipal transport council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtra10",
    "aba": "Transporte e mobilidade urbana",
    "tema": "Conselho e Fundo municipal de transporte",
    "rotulo": "Conselho Municipal de Transporte - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_hb_bicicletario",
  "bloco": "habitacao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem bicicletário público",
   "en": "Has a public bicycle parking facility"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mtra25",
    "aba": "Transporte e mobilidade urbana",
    "tema": "Transporte por bicicleta",
    "rotulo": "Existem no município › Bicicletário público no município - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_cons_assist",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de assistência social",
   "en": "Has a social assistance council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MASS16",
    "aba": "Assistência Social",
    "tema": "Conselho e Fundo Municipal de Assistência Social",
    "rotulo": "Conselho Municipal de Assistência Social - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_org_mulheres",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem órgão executivo de políticas para as mulheres",
   "en": "Has an executive body for women’s policies"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPPM01",
    "aba": "Política para Mulheres",
    "tema": "Organismo executivo de políticas para as mulheres e perfil do gestor",
    "rotulo": "Organismo executivo de políticas para as mulheres - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_cons_mulher",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de direitos da mulher",
   "en": "Has a women’s rights council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPPM13",
    "aba": "Política para Mulheres",
    "tema": "Conselho e fundo municipal de direitos da mulher",
    "rotulo": "Conselho municipal de direitos da mulher - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_cons_sanutri",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de segurança alimentar",
   "en": "Has a food security council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSAN05",
    "aba": "Segurança Alimentar",
    "tema": "Conselho, câmara ou instância governamental intersetorial e plano de segurança alimentar",
    "rotulo": "Conselho Municipal de Segurança Alimentar - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_cons_segpub",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de segurança pública",
   "en": "Has a public security council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG07",
    "aba": "Segurança Pública",
    "tema": "Conselho, conselho comunitário, fundo e plano municipal de segurança",
    "rotulo": "Conselho municipal de segurança pública - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_guarda",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem guarda municipal",
   "en": "Has a municipal guard"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG27",
    "aba": "Segurança Pública",
    "tema": "Guarda Municipal",
    "rotulo": "Guarda municipal - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_cons_racial",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de igualdade racial",
   "en": "Has a racial equality council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MIGR19",
    "aba": "Igualdade racial",
    "tema": "Conselhos Municipais",
    "rotulo": "Conselho Municipal de Igualdade Racial - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_denuncia_racial",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem órgão para denúncias de violação de direitos étnico-raciais",
   "en": "Has a body for reports of ethnic-racial rights violations"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "MIGR61",
    "aba": "Igualdade racial",
    "tema": "Denúncias de violação de direitos étnico-raciais",
    "rotulo": "Órgão responsável por receber, registrar e acompanhar denúncias de violação de direitos étnico-raciais - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "m_in_abrigo_imigrantes",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem abrigo para imigrantes",
   "en": "Has a shelter for immigrants"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Mmig05",
    "aba": "Gestão migratória",
    "tema": "Equipamentos",
    "rotulo": "Abrigo para o acolhimento de imigrantes(4) - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_rh_direta_16",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Total de servidores (administração direta)",
   "en": "Total staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH016",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total"
   },
   {
    "ano": 2023,
    "var": "EREH0116",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total"
   },
   {
    "ano": 2021,
    "var": "EREH0116",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Total¹"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_direta_11",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estatutários (administração direta)",
   "en": "Statutory staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH011",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   },
   {
    "ano": 2023,
    "var": "EREH0111",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   },
   {
    "ano": 2021,
    "var": "EREH0111",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estatutários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_direta_12",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Celetistas (administração direta)",
   "en": "CLT staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH012",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   },
   {
    "ano": 2023,
    "var": "EREH0112",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   },
   {
    "ano": 2021,
    "var": "EREH0112",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Celetistas"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_direta_13",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Somente comissionados (administração direta)",
   "en": "Appointed-only staff (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH013",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   },
   {
    "ano": 2023,
    "var": "EREH0113",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   },
   {
    "ano": 2021,
    "var": "EREH0113",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Somente comissionados"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_direta_14",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estagiários (administração direta)",
   "en": "Interns (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH014",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   },
   {
    "ano": 2023,
    "var": "EREH0114",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   },
   {
    "ano": 2021,
    "var": "EREH0114",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Estagiários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_direta_15",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Sem vínculo permanente (administração direta)",
   "en": "No permanent tie (direct administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH015",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   },
   {
    "ano": 2023,
    "var": "EREH0115",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   },
   {
    "ano": 2021,
    "var": "EREH0115",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração direta",
    "rotulo": "Sem vínculo permanente"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração direta do governo estadual. A administração indireta tem quadro próprio e não entra nesta soma.",
   "en": "Direct administration of the state government. The indirect administration has its own staff and is not part of this sum."
  }
 },
 {
  "id": "e_rh_indireta_36",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Total de servidores (administração indireta)",
   "en": "Total staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH036",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Total"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_indireta_31",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estatutários (administração indireta)",
   "en": "Statutory staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH031",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Estatutários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_indireta_32",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Celetistas (administração indireta)",
   "en": "CLT staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH032",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Celetistas"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_indireta_33",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Somente comissionados (administração indireta)",
   "en": "Appointed-only staff (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH033",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Somente comissionados"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_indireta_34",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Estagiários (administração indireta)",
   "en": "Interns (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH034",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Estagiários"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_indireta_35",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "numerico",
  "titulo": {
   "pt": "Sem vínculo permanente (administração indireta)",
   "en": "No permanent tie (indirect administration)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH035",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Sem vínculo permanente"
   }
  ],
  "unidade": {
   "pt": "servidores",
   "en": "staff"
  },
  "contexto": {
   "pt": "Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.",
   "en": "Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum."
  }
 },
 {
  "id": "e_rh_existe_indireta",
  "bloco": "pessoal",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem administração indireta",
   "en": "Has indirect administration"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "EREH02",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   },
   {
    "ano": 2023,
    "var": "EREH02",
    "aba": "Recursos Humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   },
   {
    "ano": 2021,
    "var": "EREH02",
    "aba": "Recursos humanos",
    "tema": "Composição do quadro de pessoal da administração indireta",
    "rotulo": "Administração indireta - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_lai",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei própria de acesso à informação",
   "en": "Has its own access-to-information law"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Egov01",
    "aba": "Governança",
    "tema": "Acesso à informação",
    "rotulo": "Legislação estadual específica que estabeleça procedimentos e providências para garantir o direito de acesso à informação pública em conformidade com a Lei de Acesso à Informação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_controle",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem estrutura de controle interno",
   "en": "Has an internal-control structure"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Egov09",
    "aba": "Governança",
    "tema": "Controle Interno",
    "rotulo": "Estrutura organizacional para a área responsável pelo controle interno - existência"
   }
  ],
  "sim": [
   "Sim, instituída por instrumento legal"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_conselho",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de transparência",
   "en": "Has a transparency council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Egov26",
    "aba": "Governança",
    "tema": "Conselho de transparência",
    "rotulo": "Conselho Estadual de Transparência ou similar - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_lgpd_area",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem área ou responsável pela proteção de dados pessoais",
   "en": "Has a unit or person in charge of personal data protection"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Egov32",
    "aba": "Governança",
    "tema": "Lei Geral de Proteção de Dados Pessoais (LGPD)",
    "rotulo": "Área ou pessoa responsável por procedimentos e políticas para a coleta, armazenamento e uso de dados pessoais ou pela implementação das diretrizes da LGPD - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_lgpd_lei",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem norma específica sobre a LGPD",
   "en": "Has a specific rule on the LGPD (data protection law)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Egov36",
    "aba": "Governança",
    "tema": "Lei Geral de Proteção de Dados Pessoais (LGPD)",
    "rotulo": "Regulamentação ou lei estadual específica sobre a LGPD, que identifica os papéis e responsabilidades de áreas ou setores do governo - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_site",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Atende pelo site",
   "en": "Offers service through a website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etic013",
    "aba": "Informática e comunicação",
    "tema": "Formas de atendimento à distância e tipo de conexão com a internet",
    "rotulo": "Disponibiliza formas de atendimento a distância: › Websites"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_whatsapp",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Atende por WhatsApp",
   "en": "Offers service through WhatsApp"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etic014",
    "aba": "Informática e comunicação",
    "tema": "Formas de atendimento à distância e tipo de conexão com a internet",
    "rotulo": "Disponibiliza formas de atendimento a distância: › WhatsApp"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_diario",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Publica o diário oficial no site",
   "en": "Publishes the official gazette on its website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etic12a4",
    "aba": "Informática e comunicação",
    "tema": "Características da página na internet e redes sociais",
    "rotulo": "Serviços informativos disponibilizados na página da internet › Diário oficial"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_nfe",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Emite nota fiscal eletrônica pelo site",
   "en": "Issues electronic invoices on its website"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etic12b7",
    "aba": "Informática e comunicação",
    "tema": "Características da página na internet e redes sociais",
    "rotulo": "Serviços disponibilizados na página da internet › Emissão de Nota Fiscal Eletrônica"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_tr_wifi",
  "bloco": "transparencia",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Oferece acesso por wi-fi",
   "en": "Offers wi-fi access"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etic20",
    "aba": "Informática e comunicação",
    "tema": "Acesso à internet para a população",
    "rotulo": "Disponibiliza acesso por conexão wi-fi"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_pl_plano_educ",
  "bloco": "planejamento",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano estadual de educação",
   "en": "Has a state education plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU14",
    "aba": "Educação",
    "tema": "Plano estadual de educação e Fórum Permanente de Educação",
    "rotulo": "Plano Estadual de Educação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_pl_plano_saude",
  "bloco": "planejamento",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano estadual de saúde",
   "en": "Has a state health plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ESAU23",
    "aba": "Saúde",
    "tema": "Plano Estadual de Saúde e Política Nacional de Saúde Integral da População Negra",
    "rotulo": "Plano Estadual de Saúde - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_hb_plano",
  "bloco": "habitacao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano estadual de habitação",
   "en": "Has a state housing plan"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Ehab07",
    "aba": "Habitação",
    "tema": "Plano e conferência estadual de habitação",
    "rotulo": "Plano Estadual de Habitação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_hb_conselho",
  "bloco": "habitacao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual de habitação",
   "en": "Has a state housing council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Ehab10",
    "aba": "Habitação",
    "tema": "Conselho e Fundo Estadual de Habitação",
    "rotulo": "Conselho Estadual de Habitação - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_hb_cadastro",
  "bloco": "habitacao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem cadastro de famílias interessadas em programas habitacionais",
   "en": "Has a register of families interested in housing programmes"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Ehab18",
    "aba": "Habitação",
    "tema": "Cadastro de famílias interessadas em programas habitacionais",
    "rotulo": "Cadastro ou levantamento de famílias interessadas em programas habitacionais - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_hb_intermunicipal",
  "bloco": "habitacao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem transporte coletivo por ônibus intermunicipal",
   "en": "Has intercity bus public transport"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Etra17",
    "aba": "Transporte",
    "tema": "Serviços de transporte",
    "rotulo": "Transporte coletivo por ônibus intermunicipal - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_in_cons_assist",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de assistência social",
   "en": "Has a social assistance council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EASS17",
    "aba": "Assistência Social",
    "tema": "Conselho Estadual de Assistência Social",
    "rotulo": "Conselho Estadual de Assistência Social - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_in_org_mulheres",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem órgão executivo de políticas para as mulheres",
   "en": "Has an executive body for women’s policies"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EPPM01",
    "aba": "Política para Mulheres",
    "tema": "Organismo executivo de políticas para as mulheres e perfil do gestor",
    "rotulo": "Organismo executivo de políticas para as mulheres - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_in_plano_mulheres",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano estadual de políticas para as mulheres",
   "en": "Has a state plan for women’s policies"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EPPM11",
    "aba": "Política para Mulheres",
    "tema": "Plano estadual de políticas para as mulheres e programa, projeto ou ação em cooperação",
    "rotulo": "Plano estadual de políticas para as mulheres - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_in_cons_mulher",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de direitos da mulher",
   "en": "Has a women’s rights council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EPPM14",
    "aba": "Política para Mulheres",
    "tema": "Conselho e fundo estadual de direitos da mulher",
    "rotulo": "Conselho estadual de direitos da mulher - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 },
 {
  "id": "e_in_lei_sanutri",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei de segurança alimentar",
   "en": "Has a food security law"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ESAN04",
    "aba": "Segurança Alimentar",
    "tema": "Lei de segurança alimentar",
    "rotulo": "Lei de segurança alimentar - existência"
   }
  ],
  "sim": [
   "Possui lei"
  ],
  "nao": [
   "Não possui"
  ]
 },
 {
  "id": "e_in_cons_sanutri",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de segurança alimentar",
   "en": "Has a food security council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ESAN05",
    "aba": "Segurança Alimentar",
    "tema": "Conselho, câmara ou instância governamental intersetorial e plano de segurança alimentar",
    "rotulo": "Conselho Estadual de Segurança Alimentar - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ]
 }
] as IndicadorMunic[];
