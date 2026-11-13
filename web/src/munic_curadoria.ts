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
 },
 {
  "id": "m_ed_carreira",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano de carreira para o magistério",
   "en": "Has a career plan for public-school teachers"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu16",
    "aba": "Educação",
    "tema": "Plano de Carreira para o Magistério e para não docentes, vencimento básico inicial dos(as) professores(as) com jornada de trabalho de 40 horas semanais",
    "rotulo": "Plano de Carreira para o Magistério - existência"
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
  "id": "m_ed_cons_fundeb",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de acompanhamento do Fundeb",
   "en": "Has a Fundeb oversight council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu30",
    "aba": "Educação",
    "tema": "Conselhos municipais da área de educação",
    "rotulo": "Composição do Conselho: › Conselho de controle e acompanhamento social do FUNDEB - existência"
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
  "id": "m_ed_cons_alimentacao",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de alimentação escolar",
   "en": "Has a school-feeding council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu35",
    "aba": "Educação",
    "tema": "Conselhos municipais da área de educação",
    "rotulo": "Realiza capacitação para os membros: › Conselho de alimentação escolar - existência"
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
  "id": "m_ed_cons_transporte",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de transporte escolar",
   "en": "Has a school-transport council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu41",
    "aba": "Educação",
    "tema": "Conselhos municipais da área de educação",
    "rotulo": "Realiza capacitação para os membros: › Conselho de transporte escolar - existência"
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
  "id": "m_ed_creche",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem creche de responsabilidade do poder público municipal",
   "en": "Has a daycare centre run by the municipal government"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu52",
    "aba": "Educação",
    "tema": "Levantamento de demanda da população em idade escolar",
    "rotulo": "O município realiza levantamento de demanda da população em idade escolar que não esteja sendo atendida: › Creche de responsabilidade do poder público municipal - existência"
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
  "id": "m_ed_consulta_creche",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem mecanismo de consulta pública da demanda por creches",
   "en": "Has a public-consultation mechanism on daycare demand"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Medu51",
    "aba": "Educação",
    "tema": "Levantamento de demanda da população em idade escolar",
    "rotulo": "O município realiza levantamento de demanda da população em idade escolar que não esteja sendo atendida: › Há no município mecanismos de consulta pública da demanda das famílias por creches"
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
  "id": "m_sa_conselho",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de saúde",
   "en": "Has a municipal health council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau10",
    "aba": "Saúde",
    "tema": "Conselho, fundo, conferência municipal de saúde",
    "rotulo": "Conselho Municipal de Saúde - existência"
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
  "id": "m_sa_fundo",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem fundo municipal de saúde",
   "en": "Has a municipal health fund"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau17",
    "aba": "Saúde",
    "tema": "Conselho, fundo, conferência municipal de saúde",
    "rotulo": "Realiza capacitação para os membros: › Fundo Municipal de Saúde - existência"
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
  "id": "m_sa_conferencia",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conferência municipal de saúde",
   "en": "Has a municipal health conference"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau18",
    "aba": "Saúde",
    "tema": "Conselho, fundo, conferência municipal de saúde",
    "rotulo": "Realiza capacitação para os membros: › Conferência Municipal de Saúde - existência"
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
  "id": "m_sa_acs",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa de agentes comunitários de saúde",
   "en": "Has a community health agents programme"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau28",
    "aba": "Saúde",
    "tema": "Programa de Agentes Comunitários de Saúde, Programa de Saúde da Família",
    "rotulo": "Programa de Agentes Comunitários de Saúde - existência"
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
  "id": "m_sa_vacina",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem posto ou serviço regular de vacinação",
   "en": "Has a regular vaccination post or service"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau33",
    "aba": "Saúde",
    "tema": "Serviço regular de vacinação, outros programas ou ações e Planejamento Familiar ou Reprodutivo",
    "rotulo": "Posto ou serviço regular de vacinação - existência"
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
  "id": "m_sa_planejamento_familiar",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa de planejamento familiar ou reprodutivo",
   "en": "Has a family or reproductive planning programme"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau39",
    "aba": "Saúde",
    "tema": "Serviço regular de vacinação, outros programas ou ações e Planejamento Familiar ou Reprodutivo",
    "rotulo": "Existe no município política, programa ou ações de: › Programa de Planejamento Familiar ou Reprodutivo - existência"
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
  "id": "m_sa_drogas",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem instituição de atendimento a usuários de drogas ilícitas",
   "en": "Has an institution serving illicit-drug users"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau50",
    "aba": "Saúde",
    "tema": "Unidades de saúde existentes no município",
    "rotulo": "Instituição que faça atendimento específico a usuários de drogas ilícitas"
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
  "id": "m_sa_busca_registro",
  "bloco": "educacao_saude",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Faz busca ativa de nascidos vivos sem registro",
   "en": "Actively searches for live births not yet registered"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Msau53",
    "aba": "Saúde",
    "tema": "Busca ativa",
    "rotulo": "Gestão municipal realiza a busca ativa dos casos de nascidos vivos não registrados para promover o registro civil de nascimento"
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
  "id": "m_cu_conselho",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de cultura",
   "en": "Has a municipal culture council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul19",
    "aba": "Cultura",
    "tema": "Conselhos e fundo municipal de cultura",
    "rotulo": "Conselho Municipal de Cultura - existência"
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
  "id": "m_cu_fundo",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem fundo municipal de cultura",
   "en": "Has a municipal culture fund"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul33",
    "aba": "Cultura",
    "tema": "Conselhos e fundo municipal de cultura",
    "rotulo": "Realiza capacitação para os membros: › Fundo Municipal de Cultura - exixtência"
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
  "id": "m_cu_patrimonio_lei",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei municipal de proteção ao patrimônio cultural",
   "en": "Has a municipal law protecting cultural heritage"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul15",
    "aba": "Cultura",
    "tema": "Patrimônio cultural",
    "rotulo": "Legislação municipal de proteção ao patrimônio cultural - existência"
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
  "id": "m_cu_ponto",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem Ponto de Cultura",
   "en": "Has a Ponto de Cultura (community culture hub)"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul40",
    "aba": "Cultura",
    "tema": "Equipamentos",
    "rotulo": "Ponto de Cultura4 - existência"
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
  "id": "m_cu_aldir",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Distribuiu recursos da Lei Aldir Blanc",
   "en": "Distributed Aldir Blanc Law funds"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul42",
    "aba": "Cultura",
    "tema": "Lei Aldir Blanc",
    "rotulo": "O município distribuiu recursos da Lei Aldir Blanc"
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
  "id": "m_cu_biblioteca",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem biblioteca pública",
   "en": "Has a public library"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul3901",
    "aba": "Cultura",
    "tema": "Equipamentos",
    "rotulo": "Bibliotecas públicas"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ],
  "contexto": {
   "pt": "Indica a existência no município; esta resposta não diz se o equipamento pertence à prefeitura.",
   "en": "Reports presence in the municipality; this answer does not indicate whether the facility belongs to the city government."
  }
 },
 {
  "id": "m_cu_museu",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem museu",
   "en": "Has a museum"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul3902",
    "aba": "Cultura",
    "tema": "Equipamentos",
    "rotulo": "Museus"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ],
  "contexto": {
   "pt": "Indica a existência no município; esta resposta não diz se o equipamento pertence à prefeitura.",
   "en": "Reports presence in the municipality; this answer does not indicate whether the facility belongs to the city government."
  }
 },
 {
  "id": "m_cu_cinema",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem cinema",
   "en": "Has a cinema"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mcul3909",
    "aba": "Cultura",
    "tema": "Equipamentos",
    "rotulo": "Cinema - existência"
   }
  ],
  "sim": [
   "Sim"
  ],
  "nao": [
   "Não"
  ],
  "contexto": {
   "pt": "Indica a existência no município; esta resposta não diz se o equipamento pertence à prefeitura.",
   "en": "Reports presence in the municipality; this answer does not indicate whether the facility belongs to the city government."
  }
 },
 {
  "id": "m_es_sistema",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Instituiu o sistema municipal de esporte",
   "en": "Has set up a municipal sports system"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mesp07",
    "aba": "Esporte",
    "tema": "Sistema Municipal de Esporte",
    "rotulo": "Município instituiu o Sistema Municipal de Esporte"
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
  "id": "m_es_conselho",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de esporte",
   "en": "Has a municipal sports council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mesp10",
    "aba": "Esporte",
    "tema": "Conselho Municipal de Esporte",
    "rotulo": "Conselho Municipal de Esporte - existência"
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
  "id": "m_es_instalacao",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem instalação esportiva municipal",
   "en": "Has a municipal sports facility"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mesp22",
    "aba": "Esporte",
    "tema": "Instalações esportivas",
    "rotulo": "Instalação esportiva municipal - existência"
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
  "id": "m_es_inclusao",
  "bloco": "cultura_esporte",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Executou ações de inclusão social pelo esporte nos últimos 24 meses",
   "en": "Ran social-inclusion-through-sport actions in the last 24 months"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "Mesp17",
    "aba": "Esporte",
    "tema": "Ações, projetos e programas",
    "rotulo": "O município executou, nos últimos 24 meses, ações, projetos e programas na área do esporte: › O município executou, nos últimos 24 meses, ações, projetos e programas permanentes de inclusão social através do esporte"
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
  "id": "m_di_cons_dh",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de direitos humanos",
   "en": "Has a municipal human rights council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU12",
    "aba": "Direitos Humanos",
    "tema": "Conselhos municipais",
    "rotulo": "Conselho Municipal de Direitos Humanos - existência"
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
  "id": "m_di_cons_crianca",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal dos direitos da criança e do adolescente",
   "en": "Has a municipal council for the rights of children and adolescents"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU18",
    "aba": "Direitos Humanos",
    "tema": "Conselhos municipais",
    "rotulo": "Capacitação dos membros: › Conselho Municipal de Direitos da Criança e do Adolescente - existência"
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
  "id": "m_di_cons_idoso",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal dos direitos da pessoa idosa",
   "en": "Has a municipal council for the rights of older persons"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU24",
    "aba": "Direitos Humanos",
    "tema": "Conselhos municipais",
    "rotulo": "Capacitação dos membros: › Conselho Municipal de Direitos da Pessoa Idosa - existência"
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
  "id": "m_di_cons_deficiencia",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal dos direitos da pessoa com deficiência",
   "en": "Has a municipal council for the rights of persons with disabilities"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU30",
    "aba": "Direitos Humanos",
    "tema": "Conselhos municipais",
    "rotulo": "Capacitação dos membros: › Conselho Municipal de Direitos da Pessoa com Deficiência - existência"
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
  "id": "m_di_cons_tutelar",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho tutelar",
   "en": "Has a guardianship council (Conselho Tutelar)"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU61",
    "aba": "Direitos Humanos",
    "tema": "Direitos das crianças e adolescentes",
    "rotulo": "Ações ou medidas da política ou programa de defesa dos direitos das crianças e adolescentes: › Conselho Tutelar - existência"
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
  "id": "m_di_pol_idoso",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem política ou programa de direitos da pessoa idosa",
   "en": "Has a policy or programme for the rights of older persons"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU67",
    "aba": "Direitos Humanos",
    "tema": "Direitos da pessoa idosa",
    "rotulo": "Existência de política ou programa de promoção de direitos da pessoa idosa"
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
  "id": "m_di_pol_deficiencia",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem política ou programa de direitos da pessoa com deficiência",
   "en": "Has a policy or programme for the rights of persons with disabilities"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MDHU64",
    "aba": "Direitos Humanos",
    "tema": "Direitos das pessoas com deficiência",
    "rotulo": "Existência de política ou programa de promoção de direitos da pessoa com deficiência"
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
  "id": "m_pi_comite",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem comitê intersetorial de políticas para a primeira infância",
   "en": "Has an intersectoral early-childhood policy committee"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPRI02",
    "aba": "Primeira Infância",
    "tema": "Comitê Intersetorial de Políticas Públicas para a Primeira Infância",
    "rotulo": "Comitê Intersetorial de Políticas Públicas para a Primeira Infância - existência"
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
  "id": "m_pi_politica",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem política ou programa voltado à primeira infância",
   "en": "Has an early-childhood policy or programme"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPRI05",
    "aba": "Primeira Infância",
    "tema": "Política ou programa especificamente direcionados à promoção e defesa de direitos das crianças de 0 a 6 anos",
    "rotulo": "Gestão municipal desenvolve política ou programa especificamente direcionados à promoção e defesa de direitos das crianças de 0 a 6 anos"
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
  "id": "m_pi_auxilio_creche",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Oferece auxílio creche a famílias",
   "en": "Offers a daycare allowance to families"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPRI07",
    "aba": "Primeira Infância",
    "tema": "Creche para famílias com crianças na educação infantil e regulamentação de espaços públicos voltados à primeira infância (0 a 6 anos)",
    "rotulo": "Município oferece algum tipo de auxílio creche para famílias com crianças na educação infantil"
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
  "id": "m_pi_licenca",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem extensão da licença maternidade ou paternidade para servidores",
   "en": "Has extended maternity or paternity leave for public employees"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPRI10",
    "aba": "Primeira Infância",
    "tema": "Legislação municipal específica",
    "rotulo": "Extensão da licença maternidade e/ou paternidade para os servidores e servidoras da gestão municipal - existência"
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
  "id": "m_pi_sistema_ensino",
  "bloco": "infancia_direitos",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem sistema próprio de ensino da educação infantil",
   "en": "Has its own early-childhood education system"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MPRI11",
    "aba": "Primeira Infância",
    "tema": "Legislação municipal específica",
    "rotulo": "Instituição de sistema próprio de ensino da educação/infantil - existência"
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
  "id": "m_ag_conselho",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho municipal de desenvolvimento rural",
   "en": "Has a municipal rural development council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Magr07",
    "aba": "Agropecuária",
    "tema": "Conselho Municipal de Desenvolvimento Rural",
    "rotulo": "Conselho Municipal de Desenvolvimento Rural - existência"
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
  "id": "m_ag_agroindustria",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa ou ação de estímulo à agroindústria",
   "en": "Has a programme or action to encourage agro-industry"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Magr16",
    "aba": "Agropecuária",
    "tema": "Programas para agroindústria e promoção e apoio a festividades e premiação",
    "rotulo": "A prefeitura desenvolve programa ou ação para estimular a agroindústria"
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
  "id": "m_ag_clima",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa ou ação de prevenção de problemas climáticos para a agropecuária",
   "en": "Has a programme or action preventing climate problems for farming"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Magr18",
    "aba": "Agropecuária",
    "tema": "Programas para agroindústria e promoção e apoio a festividades e premiação",
    "rotulo": "A prefeitura promove ou apoia: › A prefeitura desenvolve programa ou ação de prevenção contra problemas climáticos para o setor agropecuário"
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
  "id": "m_ag_sim",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem Serviço de Inspeção Municipal (SIM)",
   "en": "Has a Municipal Inspection Service (SIM)"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Magr28",
    "aba": "Agropecuária",
    "tema": "Programa ou ação de aquisição de produtos e vacinação de rebanho, Serviço de Inspeção Municipal (SIM) e abatedouros",
    "rotulo": "São relativos a: › O município possui o Serviço de Inspeção Municipal (SIM) implementado, de modo a controlar a qualidade dos produtos de origem animal"
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
  "id": "m_ag_abatedouro",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem abatedouro municipal",
   "en": "Has a municipal slaughterhouse"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Magr29",
    "aba": "Agropecuária",
    "tema": "Programa ou ação de aquisição de produtos e vacinação de rebanho, Serviço de Inspeção Municipal (SIM) e abatedouros",
    "rotulo": "Abrangência do serviço: › A prefeitura possui abatedouro municipal"
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
  "id": "m_tb_inclusao",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de inclusão produtiva para geração de trabalho e renda",
   "en": "Has productive-inclusion actions to create jobs and income"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP03",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de inclusão produtiva para a geração de trabalho e renda",
    "rotulo": "O município desenvolve ações, programas ou projetos de inclusão produtiva para a geração de trabalho e renda"
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
  "id": "m_tb_rural",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de inclusão produtiva rural",
   "en": "Has rural productive-inclusion actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP05",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de inclusão produtiva rural",
    "rotulo": "O município desenvolve ações, programas ou projetos de inclusão produtiva rural"
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
  "id": "m_tb_qualificacao",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de qualificação profissional",
   "en": "Has professional-training actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP07",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de qualificação profissional e intermediação de mão de obra",
    "rotulo": "O município desenvolve ações, programas ou projetos de qualificação profissional e intermediação de mão de obra"
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
  "id": "m_tb_urbano",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações para empreendimentos urbanos",
   "en": "Has actions for urban enterprises"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP09",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos para empreendimentos urbanos",
    "rotulo": "O município desenvolve ações, programas ou projetos para empreendimentos urbanos"
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
  "id": "m_tb_credito",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de crédito, microcrédito e seguro",
   "en": "Has credit, microcredit and insurance actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP11",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de crédito, microcrédito e seguro",
    "rotulo": "O município desenvolve ações, programas ou projetos de crédito, microcrédito e seguro"
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
  "id": "m_tb_trabalho_renda",
  "bloco": "rural_trabalho",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de geração de trabalho e renda",
   "en": "Has job and income generation actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MTIP13",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de geração de trabalho e renda",
    "rotulo": "O município desenvolve ações, programas ou projetos de geração de trabalho e renda"
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
  "id": "m_in_seg_cons_comunitario",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho comunitário de segurança pública",
   "en": "Has a community public-security council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG13",
    "aba": "Segurança Pública",
    "tema": "Conselho, conselho comunitário, fundo e plano municipal de segurança",
    "rotulo": "Capacitação dos membros: › Conselho comunitário de segurança pública - Existência"
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
  "id": "m_in_seg_fundo",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem fundo municipal de segurança pública",
   "en": "Has a municipal public-security fund"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG14",
    "aba": "Segurança Pública",
    "tema": "Conselho, conselho comunitário, fundo e plano municipal de segurança",
    "rotulo": "Capacitação dos membros: › Fundo municipal de segurança pública - Existência"
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
  "id": "m_in_seg_plano",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano municipal de segurança pública",
   "en": "Has a municipal public-security plan"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG15",
    "aba": "Segurança Pública",
    "tema": "Conselho, conselho comunitário, fundo e plano municipal de segurança",
    "rotulo": "Capacitação dos membros: › Plano municipal de segurança pública - Existência"
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
  "id": "m_in_seg_iml",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem Instituto Médico Legal no município",
   "en": "Has a Forensic Medical Institute in the municipality"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG17",
    "aba": "Segurança Pública",
    "tema": "Estrutura existente",
    "rotulo": "Existe no município: › Instituto Médico Legal"
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
  "id": "m_in_seg_bombeiros",
  "bloco": "inclusao",
  "pesquisa": "munic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem unidade do Corpo de Bombeiros no município",
   "en": "Has a Fire Brigade unit in the municipality"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "MSEG19",
    "aba": "Segurança Pública",
    "tema": "Estrutura existente",
    "rotulo": "Existe no município: › Unidade do Corpo de Bombeiros"
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
  "id": "e_ed_cons_transporte",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de transporte escolar",
   "en": "Has a school-transport council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU41",
    "aba": "Educação",
    "tema": "Conselhos estaduais da área de educação",
    "rotulo": "Realiza capacitação para os membros: › Conselho de transporte escolar - existência"
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
  "id": "e_ed_piso",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem piso salarial do magistério definido em lei estadual",
   "en": "Has a teacher salary floor set by state law"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU20",
    "aba": "Educação",
    "tema": "Plano de Carreira para o Magistério e para não docentes, vencimento básico inicial dos(as) professores(as) com jornada de trabalho de 40 horas semanais",
    "rotulo": "Critérios de progressão/promoção/ascensão são utilizados no plano de carreira do magistério: › Piso salarial da carreira do magistério público está definido em lei estadual"
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
  "id": "e_ed_carreira_apoio",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano de carreira para profissionais da educação não docentes",
   "en": "Has a career plan for non-teaching education staff"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU21",
    "aba": "Educação",
    "tema": "Plano de Carreira para o Magistério e para não docentes, vencimento básico inicial dos(as) professores(as) com jornada de trabalho de 40 horas semanais",
    "rotulo": "Critérios de progressão/promoção/ascensão são utilizados no plano de carreira do magistério: › Plano de Carreira vigente para os profissionais da educação não docentes"
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
  "id": "e_ed_cons_fundeb",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho de acompanhamento do Fundeb",
   "en": "Has a Fundeb oversight council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU30",
    "aba": "Educação",
    "tema": "Conselhos estaduais da área de educação",
    "rotulo": "Composição do Conselho: › Conselho de controle e acompanhamento social do FUNDEB - existência"
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
  "id": "e_ed_lei_cons_escolares",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei estadual de criação de conselhos escolares",
   "en": "Has a state law creating school councils"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EEDU47",
    "aba": "Educação",
    "tema": "Conselhos estaduais da área de educação",
    "rotulo": "Realiza capacitação para os membros: › Lei estadual que estabelece a criação de conselhos escolares"
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
  "id": "e_sa_pdr",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem Plano Diretor de Regionalização da saúde",
   "en": "Has a Health Regionalisation Master Plan"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ESAU22",
    "aba": "Saúde",
    "tema": "- Desenho de regionalização",
    "rotulo": "O estado possui Plano Diretor de Regionalização (PDR)"
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
  "id": "e_sa_hospital_ensino",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem hospital de ensino e pesquisa sob gestão estadual",
   "en": "Has a state-run teaching and research hospital"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ESAU29",
    "aba": "Saúde",
    "tema": "Unidades de saúde existente",
    "rotulo": "Hospital de ensino e pesquisa de responsabilidade da gestão estadual credenciado pelo Ministério da Saúde e da Educação3"
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
  "id": "e_sa_drogas",
  "bloco": "educacao_saude",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem instituição estadual de atendimento a usuários de drogas ilícitas",
   "en": "Has a state institution serving illicit-drug users"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ESAU30",
    "aba": "Saúde",
    "tema": "Unidades de saúde existente",
    "rotulo": "Quantidade › Instituição de responsabilidade da gestão estadual que faça atendimento específico a usuários de drogas ilícitas"
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
  "id": "e_cu_cons_patrimonio",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual de preservação do patrimônio",
   "en": "Has a state heritage preservation council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ECUL26",
    "aba": "Cultura",
    "tema": "Conselhos e fundo municipal de cultura",
    "rotulo": "Realiza capacitação para os membros: › Conselho Estadual de Preservação do Patrimônio - existência"
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
  "id": "e_cu_fundo",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem fundo estadual de cultura",
   "en": "Has a state culture fund"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "ECUL33",
    "aba": "Cultura",
    "tema": "Conselhos e fundo municipal de cultura",
    "rotulo": "Realiza capacitação para os membros: › Fundo Estadual de Cultura - exixtência"
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
  "id": "e_es_sistema",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Instituiu o sistema estadual de esporte",
   "en": "Has set up a state sports system"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EESP07",
    "aba": "Esporte",
    "tema": "Sistema Estadual de Esporte",
    "rotulo": "O estado instituiu o Sistema Estadual de Esporte"
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
  "id": "e_es_conselho",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual de esporte",
   "en": "Has a state sports council"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EESP10",
    "aba": "Esporte",
    "tema": "Conselho Estadual de Esporte",
    "rotulo": "Conselho Estadual de Esporte - existência"
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
  "id": "e_es_instalacao",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem instalação esportiva estadual",
   "en": "Has a state sports facility"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EESP22",
    "aba": "Esporte",
    "tema": "Instalações esportivas",
    "rotulo": "Instalação esportiva estadual - existência"
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
  "id": "e_es_inclusao",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Executou ações de inclusão social pelo esporte nos últimos 24 meses",
   "en": "Ran social-inclusion-through-sport actions in the last 24 months"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EESP17",
    "aba": "Esporte",
    "tema": "Ações, projetos e programas",
    "rotulo": "O estado executou, nos últimos 24 meses, ações, projetos e programas na área do esporte: › O estado executou, nos últimos 24 meses, ações, projetos e programas permanentes de inclusão social através do esporte"
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
  "id": "e_es_calendario",
  "bloco": "cultura_esporte",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Elabora anualmente calendário de eventos esportivos",
   "en": "Draws up an annual sports events calendar"
  },
  "fontes": [
   {
    "ano": 2021,
    "var": "EESP20",
    "aba": "Esporte",
    "tema": "Eventos esportivos",
    "rotulo": "Abrangência do(s) evento(s): › O estado elabora anualmente um calendário de evento(s) esportivo(s)"
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
  "id": "e_di_cons_dh",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual de direitos humanos",
   "en": "Has a state human rights council"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU12",
    "aba": "Direitos Humanos",
    "tema": "Conselhos Estaduais",
    "rotulo": "Conselho Estadual de Direitos Humanos - existência"
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
  "id": "e_di_cons_povos",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual dos povos e comunidades tradicionais",
   "en": "Has a state council for traditional peoples and communities"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU48",
    "aba": "Direitos Humanos",
    "tema": "Conselhos Estaduais",
    "rotulo": "Capacitação dos membros: › Conselho Estadual dos Povos e Comunidades Tradicionais - existência"
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
  "id": "e_di_pol_deficiencia",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem política ou programa de direitos da pessoa com deficiência",
   "en": "Has a policy or programme for the rights of persons with disabilities"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU62",
    "aba": "Direitos Humanos",
    "tema": "Direitos das pessoas com deficiência",
    "rotulo": "Existência de política ou programa de promoção de direitos da pessoa com deficiência"
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
  "id": "e_di_pol_rua",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem política ou programa de direitos da população em situação de rua",
   "en": "Has a policy or programme for the rights of people living on the street"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU67",
    "aba": "Direitos Humanos",
    "tema": "Direitos da pessoa em situação de rua",
    "rotulo": "Existência de política ou programa de promoção de direitos da pessoa em situação de rua"
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
  "id": "e_di_protocolo_consulta",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem protocolo de consulta livre, prévia e informada a povos tradicionais",
   "en": "Has a free, prior and informed consultation protocol for traditional peoples"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU69",
    "aba": "Direitos Humanos",
    "tema": "Comunidades tradicionais",
    "rotulo": "Existência de protocolo que defina os procedimentos para a consulta livre, prévia e esclarecida aos povos e comunidades tradicionais"
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
  "id": "e_di_comite_rua",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem comitê gestor da política para a população em situação de rua",
   "en": "Has a steering committee for the street-homeless policy"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EDHU544",
    "aba": "Direitos Humanos",
    "tema": "Comitês e comissões",
    "rotulo": "Comitê Gestor da política para a População em Situação de Rua - existência"
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
  "id": "e_pi_comite",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem comitê intersetorial de políticas para a primeira infância",
   "en": "Has an intersectoral early-childhood policy committee"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EPRI02",
    "aba": "Primeira Infância",
    "tema": "Comitê Intersetorial de Políticas Públicas para a Primeira Infância",
    "rotulo": "Comitê Intersetorial de Políticas Públicas para a Primeira Infância - existência"
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
  "id": "e_pi_licenca",
  "bloco": "infancia_direitos",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem lei sobre extensão da licença maternidade ou paternidade",
   "en": "Has a law extending maternity or paternity leave"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "EPRI07",
    "aba": "Primeira Infância",
    "tema": "- Legislação estadual específica sobre extensão da licença maternidade e/ou paternidade",
    "rotulo": "Legislação estadual específica sobre extensão da licença maternidade e/ou paternidade para os servidores e servidoras da gestão estadual - existência"
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
  "id": "e_ag_conselho",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem conselho estadual de desenvolvimento rural",
   "en": "Has a state rural development council"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Eagr07",
    "aba": "Agropecuária",
    "tema": "Conselho Estadual de Desenvolvimento Rural",
    "rotulo": "Conselho Estadual de Desenvolvimento Rural - existência"
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
  "id": "e_ag_agroindustria",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa ou ação de estímulo à agroindústria",
   "en": "Has a programme or action to encourage agro-industry"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Eagr16",
    "aba": "Agropecuária",
    "tema": "Programas para agroindústria e promoção e apoio a festividades e premiação",
    "rotulo": "O estado desenvolve programa ou ação para estimular a agroindústria"
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
  "id": "e_ag_clima",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem programa ou ação de prevenção de problemas climáticos para a agropecuária",
   "en": "Has a programme or action preventing climate problems for farming"
  },
  "fontes": [
   {
    "ano": 2024,
    "var": "Eagr18",
    "aba": "Agropecuária",
    "tema": "Programas para agroindústria e promoção e apoio a festividades e premiação",
    "rotulo": "O estado promove ou apoia: › O estado desenvolve programa ou ação de prevenção contra problemas climáticos para o setor agropecuário"
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
  "id": "e_tb_rural",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de inclusão produtiva rural",
   "en": "Has rural productive-inclusion actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ETIP05",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de inclusão produtiva rural",
    "rotulo": "O estado desenvolve ações, programas ou projetos de inclusão produtiva rural"
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
  "id": "e_tb_urbano",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de inclusão produtiva urbana",
   "en": "Has urban productive-inclusion actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ETIP09",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de inclusão produtiva urbana",
    "rotulo": "O estado desenvolve ações, programas ou projetos de inclusão produtiva urbana"
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
  "id": "e_tb_credito",
  "bloco": "rural_trabalho",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem ações de crédito, microcrédito e seguro",
   "en": "Has credit, microcredit and insurance actions"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ETIP11",
    "aba": "Trabalho e Inclusão Produtiva",
    "tema": "Ações, programas ou projetos de crédito, microcrédito e seguro",
    "rotulo": "O estado desenvolve ações, programas ou projetos de crédito, microcrédito e seguro"
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
  "id": "e_in_seg_plano",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano estadual de segurança pública",
   "en": "Has a state public-security plan"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ESEG24",
    "aba": "Segurança Pública",
    "tema": "Conselho, fundo, plano estadual de segurança e Programa/Projeto/Ação Estadual de Redução e/ou Prevenção de Homicídios",
    "rotulo": "O estado realiza capacitação dos membros: › Plano estadual de segurança pública - existência"
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
  "id": "e_in_seg_efetivo",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano de distribuição regional do efetivo policial",
   "en": "Has a plan for regional distribution of police personnel"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ESEG28",
    "aba": "Segurança Pública",
    "tema": "Polícia Militar",
    "rotulo": "Efetivo existente em 31 de dezembro de 2022: › Plano de distribuição regional do efetivo - existência"
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
  "id": "e_in_seg_carreira",
  "bloco": "inclusao",
  "pesquisa": "estadic",
  "tipo": "binario",
  "titulo": {
   "pt": "Tem plano de carreira para policiais civis",
   "en": "Has a career plan for civil police officers"
  },
  "fontes": [
   {
    "ano": 2023,
    "var": "ESEG60",
    "aba": "Segurança Pública",
    "tema": "Polícia civil",
    "rotulo": "Temas da capacitação em 2022: › Existe plano de carreira para os policiais civis"
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
